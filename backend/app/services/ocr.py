"""OCRmyPDF wrapper.

Why this mirrors `ghostscript.py` rather than wrapping the Python API:
- The Python API hides subprocesses we still need to kill on timeout.
- Calling the CLI gives us one place where the process tree is visible:
  ocrmypdf spawns tesseract and qpdf as children, and we must kill the
  whole group if it overruns the budget. `subprocess.Popen` +
  `start_new_session=True` + `os.killpg` is the same recipe used for gs.

Why `--invalidate-digital-signatures`:
- A signed PDF cannot be modified without breaking the signature. The user
  opts in to OCR explicitly, so we let OCRmyPDF proceed and surface the
  warning in the UI rather than hard-rejecting signed inputs. If a user
  cares about the signature, they should not choose the OCR mode.

Why `--optimize 2`:
- Aggressive enough to noticeably shrink scanned PDFs without becoming
  visibly lossy on text. Requires `pngquant` in the container image.
- We do NOT enable `--jbig2-lossy` here, so `jbig2enc` is intentionally
  absent from the Dockerfile.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.errors import ErrorCode

log = get_logger("ocr")

VALID_LANGS = frozenset({"spa+eng", "spa", "eng"})


class OCRmyPDFError(Exception):
    """Raised when ocrmypdf exits non-zero. Carries the errorCode for the API."""

    def __init__(self, error_code: ErrorCode, message: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


def ocr_pdf(
    input_path: Path,
    output_path: Path,
    lang: str = "spa+eng",
    *,
    optimize_level: int = 2,
    timeout_seconds: int | None = None,
) -> None:
    """Run ocrmypdf on `input_path`, writing the optimized+OCR'd PDF to `output_path`.

    Raises:
        OCRmyPDFError: ocrmypdf failed, the output is missing, or the
        input language is not supported.
    """
    if lang not in VALID_LANGS:
        raise OCRmyPDFError(
            ErrorCode.OCR_FAILED,
            f"Idioma OCR no soportado: {lang!r}. Usá spa+eng, spa o eng.",
        )
    if not input_path.is_file():
        raise OCRmyPDFError(
            ErrorCode.FILE_CORRUPT,
            "El PDF de entrada no existe o no es accesible.",
        )
    settings = get_settings()
    timeout = timeout_seconds if timeout_seconds is not None else settings.ocr_timeout_seconds

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    args: list[str] = [
        "ocrmypdf",
        "--optimize", str(optimize_level),
        "--skip-text",
        "--output-type", "pdf",
        "-l", lang,
        "--invalidate-digital-signatures",
        "--quiet",
        str(input_path),
        str(output_path),
    ]

    log.info(
        "ocr.start",
        lang=lang,
        optimize_level=optimize_level,
        input=str(input_path),
        output=str(output_path),
        input_bytes=input_path.stat().st_size,
        timeout_seconds=timeout,
    )

    with subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    ) as proc:
        try:
            _, stderr_bytes = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_process_group(proc)
            raise OCRmyPDFError(
                ErrorCode.OCR_TIMEOUT,
                f"OCRmyPDF excedió el timeout de {timeout}s y fue cancelado.",
            )

        if proc.returncode != 0:
            stderr = (stderr_bytes or b"").decode(errors="replace").strip()
            log.error(
                "ocr.failed",
                returncode=proc.returncode,
                stderr=stderr[:500],
            )
            raise OCRmyPDFError(
                ErrorCode.OCR_FAILED,
                f"ocrmypdf salió con código {proc.returncode}"
                + (f": {stderr[:200]}" if stderr else ""),
            )

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise OCRmyPDFError(
            ErrorCode.OCR_FAILED,
            "ocrmypdf terminó OK pero no produjo un archivo de salida.",
        )


def _kill_process_group(proc: subprocess.Popen[bytes]) -> None:
    """SIGTERM, wait 5 s, then SIGKILL. Reaches every descendant
    (ocrmypdf → tesseract, qpdf, etc.)."""
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