"""Chunked upload writer.

We never load the whole PDF into Python memory: `UploadFile.file` is a
SpooledTemporaryFile that already spills to disk past 1 MB, but we still
copy it ourselves so we can:

1. Enforce a hard byte cap *during* the write (kill the request at the
   exact threshold, not after we've read 500 MB to discover the limit).
2. Validate the PDF magic bytes (`%PDF-`) on the first chunk before we
   commit disk space.
3. Drop the file at a server-controlled path (no reliance on client names).

The whole stream is 1 MB chunks: large enough to keep syscall overhead
low, small enough that an attacker can't blow past the limit by 999 MB.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings
from app.schemas.errors import ErrorCode, message_for

PDF_MAGIC = b"%PDF-"
# Conservative: letters, digits, spaces, dots, dashes, underscores, parens.
SAFE_NAME = re.compile(r"[^A-Za-z0-9._\-\s()]")

CHUNK_BYTES = 1 * 1024 * 1024


@dataclass(frozen=True)
class SavedUpload:
    path: Path
    size: int
    safe_name: str


def save_pdf_upload(file: UploadFile, job_id: str) -> SavedUpload:
    """Stream `file` to `<inputs>/<job_id>/input.pdf` after validation.

    Raises `HTTPException` (400) on validation failures. The caller catches
    nothing — these errors are user-facing.
    """
    return _stream_pdf(file, job_id, settings_dir=get_settings().inputs_dir, filename="input.pdf")


def save_extra_pdf_upload(file: UploadFile, job_id: str) -> SavedUpload:
    """Stream the secondary PDF to `<extra-inputs>/<job_id>/extra.pdf`.

    Used by `/api/jobs/pages` for the `from_pdf: "extra"` insert op. Same
    validation as the main upload, but the file lands in a separate
    directory so the worker reads it via a different path.
    """
    return _stream_pdf(file, job_id, settings_dir=get_settings().extra_inputs_dir, filename="extra.pdf")


def _stream_pdf(
    file: UploadFile,
    job_id: str,
    *,
    settings_dir: Path,
    filename: str,
) -> SavedUpload:
    """Shared chunked-writer used by save_*_upload.

    Writes to `<settings_dir>/<job_id>/<filename>`, enforcing the same
    PDF magic + size cap as the public helpers.
    """
    settings = get_settings()
    settings_dir.mkdir(parents=True, exist_ok=True)
    job_dir = settings_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    if file.content_type and file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "errorCode": ErrorCode.FILE_NOT_PDF.value,
                "message": message_for(ErrorCode.FILE_NOT_PDF),
            },
        )

    safe_name = _safe_basename(file.filename or "documento.pdf")
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "errorCode": ErrorCode.FILE_NOT_PDF.value,
                "message": message_for(ErrorCode.FILE_NOT_PDF),
            },
        )

    target = job_dir / filename
    total = 0
    magic_checked = False
    with target.open("wb") as fout:
        while True:
            chunk = file.file.read(CHUNK_BYTES)
            if not chunk:
                break
            if not magic_checked:
                if not chunk.startswith(PDF_MAGIC):
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "errorCode": ErrorCode.FILE_NOT_PDF.value,
                            "message": message_for(ErrorCode.FILE_NOT_PDF),
                        },
                    )
                magic_checked = True
            total += len(chunk)
            if total > settings.max_upload_bytes:
                fout.close()
                target.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "errorCode": ErrorCode.FILE_TOO_LARGE.value,
                        "message": message_for(
                            ErrorCode.FILE_TOO_LARGE,
                            size_mb=round(settings.max_upload_bytes / (1024 * 1024), 1),
                            limit_mb=round(settings.max_upload_bytes / (1024 * 1024), 1),
                        ),
                    },
                )
            fout.write(chunk)

    if not magic_checked:
        target.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "errorCode": ErrorCode.FILE_NOT_PDF.value,
                "message": message_for(ErrorCode.FILE_NOT_PDF),
            },
        )

    return SavedUpload(path=target, size=total, safe_name=safe_name)


def _safe_basename(raw: str) -> str:
    """Strip path components and characters that could trip downstream tools."""
    # Take only the last segment (no path traversal).
    name = raw.replace("\\", "/").rsplit("/", 1)[-1]
    # Replace any disallowed chars with underscore.
    name = SAFE_NAME.sub("_", name).strip().strip(".")
    if not name:
        name = "documento.pdf"
    return name[:200]
