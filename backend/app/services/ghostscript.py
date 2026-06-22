"""Ghostscript wrapper.

Why this lives in `services/` (not `tasks/`):
- The RQ task is a thin coordinator that owns job state + logging.
- The service is a pure function: `gs(input_path, output_path, level) -> None`.
  That's what we test. RQ, Redis, and the HTTP layer can change freely.

Why file-to-file and not stdout-to-disk:
- `gs -sOutputFile=output.pdf` writes directly. We never round-trip the
  PDF through Python — important for the 100 MB cap because the process
  working set stays close to gs's internal memory, not Python's.

Why we use `start_new_session=True` + a process-group kill:
- gs can spawn helper threads/processes on some platforms. Killing only
  the parent can leave them orphaned holding FDs. Setting a new session
  means `proc.terminate()` / `proc.kill()` reach every descendant.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.errors import ErrorCode

log = get_logger("ghostscript")

# Three presets, explicit DPI. The named -dPDFSETTINGS already implies a
# DPI, but spelling it out keeps the contract stable across gs versions.
GS_PRESETS: dict[str, list[str]] = {
    "baja": [
        "-dPDFSETTINGS=/printer",
        "-dColorImageResolution=150",
        "-dGrayImageResolution=150",
        "-dMonoImageResolution=300",
    ],
    "media": [
        "-dPDFSETTINGS=/ebook",
        "-dColorImageResolution=100",
        "-dGrayImageResolution=100",
        "-dMonoImageResolution=300",
    ],
    "alta": [
        "-dPDFSETTINGS=/screen",
        "-dColorImageResolution=72",
        "-dGrayImageResolution=72",
        "-dMonoImageResolution=150",
    ],
}

VALID_LEVELS = frozenset(GS_PRESETS.keys())


class GhostscriptError(Exception):
    """Raised when gs exits non-zero. Carries the errorCode for the API."""

    def __init__(self, error_code: ErrorCode, message: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


def compress_pdf(
    input_path: Path,
    output_path: Path,
    level: str,
    *,
    timeout_seconds: int | None = None,
) -> None:
    """Compress `input_path` -> `output_path` at the given preset.

    Raises:
        GhostscriptError: gs failed or produced an empty file.
        TimeoutError: gs exceeded the timeout and was killed.
    """
    if level not in VALID_LEVELS:
        raise GhostscriptError(
            ErrorCode.INTERNAL,
            f"Nivel de compresión inválido: {level!r}.",
        )
    if not input_path.is_file():
        raise GhostscriptError(
            ErrorCode.FILE_CORRUPT,
            "El PDF de entrada no existe o no es accesible.",
        )
    settings = get_settings()
    timeout = timeout_seconds if timeout_seconds is not None else settings.gs_timeout_seconds

    # Ensure parent exists; gs creates the file but not the directory.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # If a stale output exists, gs may append or error; remove to be safe.
    if output_path.exists():
        output_path.unlink()

    args: list[str] = [
        "gs",
        "-sDEVICE=pdfwrite",
        "-dNOPAUSE",
        "-dBATCH",
        "-dQUIET",
        *GS_PRESETS[level],
        f"-sOutputFile={output_path}",
        str(input_path),
    ]

    log.info(
        "gs.start",
        level=level,
        input=str(input_path),
        output=str(output_path),
        input_bytes=input_path.stat().st_size,
        timeout_seconds=timeout,
        args=gs_arg_summary(args),
    )

    with subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        start_new_session=True,
    ) as proc:
        try:
            _, stderr_bytes = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_process_group(proc)
            raise GhostscriptError(
                ErrorCode.GS_TIMEOUT,
                f"Ghostscript excedió el timeout de {timeout}s y fue cancelado.",
            )

        if proc.returncode != 0:
            stderr = (stderr_bytes or b"").decode(errors="replace").strip()
            log.error(
                "gs.failed",
                returncode=proc.returncode,
                stderr=stderr[:500],
            )
            raise GhostscriptError(
                ErrorCode.GS_FAILED,
                f"gs salió con código {proc.returncode}" + (f": {stderr[:200]}" if stderr else ""),
            )

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise GhostscriptError(
            ErrorCode.GS_FAILED,
            "gs terminó OK pero no produjo un archivo de salida.",
        )


def _kill_process_group(proc: subprocess.Popen[bytes]) -> None:
    """SIGTERM, wait 5 s, then SIGKILL. Reaches every descendant."""
    try:
        os.killpg(proc.pid, subprocess.signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        proc.kill()
        proc.wait()
        return
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, subprocess.signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            proc.kill()
        proc.wait()


def gs_arg_summary(args: list[str]) -> dict[str, str | None]:
    """Extract just the user-relevant flags for logging — keeps secrets/path noise out."""
    out: dict[str, str | None] = {}
    for a in args:
        if a.startswith("-d") and "=" in a:
            k, _, v = a[2:].partition("=")
            if k in {"PDFSETTINGS", "ColorImageResolution", "GrayImageResolution"}:
                out[k] = v
        elif a == "gs":
            out["binary"] = "gs"
    return out
