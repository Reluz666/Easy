"""Upload validation tests — these don't need Redis or gs."""
from __future__ import annotations

import io

import pytest
from fastapi import HTTPException
from fastapi import UploadFile

from app.services.uploads import save_pdf_upload


class _FakeUpload:
    """Minimal UploadFile stand-in: .file is a SpooledTemporaryFile-like."""

    def __init__(self, data: bytes, filename: str = "doc.pdf", content_type: str = "application/pdf"):
        self._buf = io.BytesIO(data)
        self.filename = filename
        self.content_type = content_type

    @property
    def file(self):
        return self._buf


def test_save_pdf_upload_writes_file_and_returns_metadata(tmp_path, settings):
    payload = b"%PDF-1.4\n...lots of bytes..." + b"x" * 100
    upload = UploadFile(
        filename="input.pdf",
        file=io.BytesIO(payload),
        headers={"content-type": "application/pdf"},  # type: ignore[arg-type]
    )

    saved = save_pdf_upload(upload, job_id="01TEST")

    assert saved.path.is_file()
    assert saved.size == len(payload)
    assert saved.safe_name == "input.pdf"


def test_save_pdf_upload_rejects_wrong_magic_bytes(tmp_path, settings):
    upload = UploadFile(
        filename="fake.pdf",
        file=io.BytesIO(b"NOT A PDF, just text"),
        headers={"content-type": "application/pdf"},  # type: ignore[arg-type]
    )
    with pytest.raises(HTTPException) as exc:
        save_pdf_upload(upload, job_id="01BAD")
    assert exc.value.status_code == 400
    assert exc.value.detail["errorCode"] == "FILE_NOT_PDF"


def test_save_pdf_upload_rejects_oversize(tmp_path, settings, monkeypatch):
    # Cap at 1 KB so we can blow past it cheaply.
    monkeypatch.setattr(settings, "max_upload_bytes", 1024)
    payload = b"%PDF-" + b"x" * 2048
    upload = UploadFile(
        filename="big.pdf",
        file=io.BytesIO(payload),
        headers={"content-type": "application/pdf"},  # type: ignore[arg-type]
    )
    with pytest.raises(HTTPException) as exc:
        save_pdf_upload(upload, job_id="01OVER")
    assert exc.value.status_code == 400
    assert exc.value.detail["errorCode"] == "FILE_TOO_LARGE"
    # Cleanup ran (no partial file left behind).
    assert not (settings.inputs_dir / "01OVER" / "input.pdf").exists()


def test_save_pdf_upload_strips_path_traversal(tmp_path, settings):
    payload = b"%PDF-1.4 ok"
    upload = UploadFile(
        filename="../../etc/passwd.pdf",
        file=io.BytesIO(payload),
        headers={"content-type": "application/pdf"},  # type: ignore[arg-type]
    )
    saved = save_pdf_upload(upload, job_id="01PATH")
    # We only check the basename landed somewhere safe; full path stays
    # server-controlled regardless.
    assert ".." not in saved.path.name
    assert saved.path.is_file()


def test_save_pdf_upload_rejects_non_pdf_extension(tmp_path, settings):
    payload = b"%PDF-1.4 ok"
    upload = UploadFile(
        filename="virus.exe",
        file=io.BytesIO(payload),
        headers={"content-type": "application/pdf"},  # type: ignore[arg-type]
    )
    with pytest.raises(HTTPException) as exc:
        save_pdf_upload(upload, job_id="01EXT")
    assert exc.value.detail["errorCode"] == "FILE_NOT_PDF"
