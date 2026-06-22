"""End-to-end tests for POST /api/jobs/ocr.

Same inline-runner pattern as `test_jobs_compress.py`: we patch
`Queue.enqueue` so the task runs synchronously inside the test, exercising
the real API surface and the real Redis state transitions.

Error contract under test:

* Synchronous failures (rejected before the worker runs):
  - Invalid language -> 422 from FastAPI's Literal check
  - Non-PDF bytes / wrong content-type -> 400 FILE_NOT_PDF
  - Oversize upload -> 400 FILE_TOO_LARGE

* Asynchronous failures (live in the job state, surfaced by GET):
  - Worker raises OCRmyPDFError(OCR_TIMEOUT) -> status="failed",
    errorCode="OCR_TIMEOUT", Spanish errorMessage
  - Worker raises OCRmyPDFError(OCR_FAILED) -> status="failed",
    errorCode="OCR_FAILED", Spanish errorMessage
  - Worker raises bare Exception -> status="failed",
    errorCode="INTERNAL", generic Spanish errorMessage
"""
from __future__ import annotations

import io
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.errors import ErrorCode, message_for
from app.services.ocr import OCRmyPDFError


pytestmark = pytest.mark.skipif(
    shutil.which("ocrmypdf") is None,
    reason="ocrmypdf not installed",
)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _run_inline(job_id: str, lang: str) -> None:
    """Stand-in for `rq.Queue.enqueue` — calls the task synchronously."""
    from app.tasks.ocr import run_ocr

    run_ocr(job_id, lang)


def test_ocr_endpoint_creates_job_and_runs_inline(
    client: TestClient, settings, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Patch ocr_pdf to a no-op that writes a valid-looking output. The
    # real subprocess is exercised by test_ocr.py; here we only need the
    # API + state-machine path.
    output = tmp_path / "output.pdf"
    output.write_bytes(minimal_pdf_bytes)

    def fake_ocr_pdf(input_path, output_path, lang, *, optimize_level=2, timeout_seconds=None):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(minimal_pdf_bytes)

    monkeypatch.setattr("app.tasks.ocr.ocr_service.ocr_pdf", fake_ocr_pdf)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lang, **kw: _run_inline(jid, lang)
        resp = client.post(
            "/api/jobs/ocr",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"lang": "spa+eng"},
        )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    job_id = body["jobId"]

    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "done"
    assert info["op"] == "ocr"
    assert info["params"]["lang"] == "spa+eng"
    assert info["output_bytes"] is not None and info["output_bytes"] > 0
    assert info["duration_ms"] is not None and info["duration_ms"] >= 0
    # Equal-sized fake output => both metrics are 0.
    assert info["reduction_pct"] == 0.0


def test_ocr_endpoint_default_lang_is_spa_eng(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def fake_ocr_pdf(input_path, output_path, lang, *, optimize_level=2, timeout_seconds=None):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(minimal_pdf_bytes)

    monkeypatch.setattr("app.tasks.ocr.ocr_service.ocr_pdf", fake_ocr_pdf)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lang, **kw: _run_inline(jid, lang)
        resp = client.post(
            "/api/jobs/ocr",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["params"]["lang"] == "spa+eng"


def test_ocr_endpoint_rejects_invalid_lang(client: TestClient, minimal_pdf_bytes: bytes) -> None:
    resp = client.post(
        "/api/jobs/ocr",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"lang": "fra"},
    )
    # FastAPI's Literal[...] check rejects with 422 before our code runs.
    assert resp.status_code == 422


def test_ocr_endpoint_rejects_non_pdf(client: TestClient) -> None:
    resp = client.post(
        "/api/jobs/ocr",
        files={"file": ("test.pdf", io.BytesIO(b"not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_NOT_PDF"


def test_ocr_endpoint_rejects_wrong_content_type(client: TestClient, minimal_pdf_bytes: bytes) -> None:
    resp = client.post(
        "/api/jobs/ocr",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "text/plain")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_NOT_PDF"


def test_ocr_endpoint_rejects_oversize(
    client: TestClient, settings, monkeypatch, minimal_pdf_bytes: bytes
) -> None:
    monkeypatch.setattr(settings, "max_upload_bytes", 50)
    resp = client.post(
        "/api/jobs/ocr",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_TOO_LARGE"


def test_ocr_get_status_returns_job_with_op_ocr(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def fake_ocr_pdf(input_path, output_path, lang, *, optimize_level=2, timeout_seconds=None):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(minimal_pdf_bytes)

    monkeypatch.setattr("app.tasks.ocr.ocr_service.ocr_pdf", fake_ocr_pdf)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lang, **kw: _run_inline(jid, lang)
        resp = client.post(
            "/api/jobs/ocr",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"lang": "spa"},
        )
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["op"] == "ocr"
    assert info["params"]["lang"] == "spa"


def test_ocr_records_signed_size_change_pct(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When OCR grows the file (text layer + metadata > image savings),
    JobInfo.reduction_pct must be negative — the frontend uses that sign
    to display the 'PDF creció un X%' message."""
    bigger_output = minimal_pdf_bytes + b"\n%OCR-added text layer payload\n" * 50

    def fake_ocr_pdf(input_path, output_path, lang, *, optimize_level=2, timeout_seconds=None):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(bigger_output)

    monkeypatch.setattr("app.tasks.ocr.ocr_service.ocr_pdf", fake_ocr_pdf)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lang, **kw: _run_inline(jid, lang)
        resp = client.post(
            "/api/jobs/ocr",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"lang": "spa+eng"},
        )
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "done"
    # The fake "output" is larger than the input: net grew => reduction_pct < 0.
    assert info["reduction_pct"] < 0


# ---------------------------------------------------------------------------
# Worker-failure → job-state tests
# ---------------------------------------------------------------------------
def test_ocr_status_reports_ocr_timeout_as_failed_with_spanish_message(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The POST must NOT bubble the worker error as a 4xx/5xx. The worker
    is the system of record for processing failures; the POST only
    validates inputs. After the inline run, GET /api/jobs/{id} returns
    status=failed with errorCode=OCR_TIMEOUT and the Spanish message."""
    def fake_ocr_pdf(input_path, output_path, lang, *, optimize_level=2, timeout_seconds=None):
        raise OCRmyPDFError(ErrorCode.OCR_TIMEOUT, "OCRmyPDF excedió el timeout de 1s y fue cancelado.")

    monkeypatch.setattr("app.tasks.ocr.ocr_service.ocr_pdf", fake_ocr_pdf)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lang, **kw: _run_inline(jid, lang)
        resp = client.post(
            "/api/jobs/ocr",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"lang": "spa+eng"},
        )

    # POST returns 202 — the worker owns the eventual outcome.
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["jobId"]

    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.OCR_TIMEOUT.value
    assert info["error_message"] == message_for(ErrorCode.OCR_TIMEOUT)


def test_ocr_status_reports_ocr_failed_as_failed_with_spanish_message(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_ocr_pdf(input_path, output_path, lang, *, optimize_level=2, timeout_seconds=None):
        raise OCRmyPDFError(
            ErrorCode.OCR_FAILED,
            "ocrmypdf salió con código 6: prior page OCR text exists",
        )

    monkeypatch.setattr("app.tasks.ocr.ocr_service.ocr_pdf", fake_ocr_pdf)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lang, **kw: _run_inline(jid, lang)
        resp = client.post(
            "/api/jobs/ocr",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"lang": "spa+eng"},
        )

    assert resp.status_code == 202
    job_id = resp.json()["jobId"]

    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.OCR_FAILED.value
    assert info["error_message"] == message_for(ErrorCode.OCR_FAILED)


def test_ocr_status_reports_internal_error_on_unexpected_exception(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_ocr_pdf(input_path, output_path, lang, *, optimize_level=2, timeout_seconds=None):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr("app.tasks.ocr.ocr_service.ocr_pdf", fake_ocr_pdf)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lang, **kw: _run_inline(jid, lang)
        resp = client.post(
            "/api/jobs/ocr",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"lang": "spa+eng"},
        )

    assert resp.status_code == 202
    job_id = resp.json()["jobId"]

    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.INTERNAL.value
    assert info["error_message"] == message_for(ErrorCode.INTERNAL)
