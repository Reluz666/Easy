"""End-to-end tests for POST /api/jobs/foliate.

Same inline-runner pattern as `test_jobs_compress.py` / `test_jobs_ocr.py`:
we patch `Queue.enqueue` so the task runs synchronously inside the test,
exercising the real API surface and the real Redis state transitions.

Error contract under test:

* Synchronous failures (rejected before the worker runs):
  - Invalid position / range_mode / font_size / initial_number -> 422 from
    FastAPI's Literal / Pydantic constraints
  - Non-PDF bytes / wrong content-type -> 400 FILE_NOT_PDF
  - Oversize upload -> 400 FILE_TOO_LARGE
  - range_mode == "from-to" without from/to_page or with from > to
    -> 400 INVALID_PAGE_RANGE ("El rango de páginas no es válido.")

* Asynchronous failures (live in the job state, surfaced by GET):
  - Worker raises FoliateError(INVALID_PAGE_RANGE) -> status="failed",
    errorCode="INVALID_PAGE_RANGE", Spanish errorMessage
  - Worker raises FoliateError(FOLIATE_FAILED) -> status="failed",
    errorCode="FOLIATE_FAILED", Spanish errorMessage
  - Worker raises FoliateError(FILE_CORRUPT) -> status="failed",
    errorCode="FILE_CORRUPT", Spanish errorMessage
  - Worker raises FoliateError(FILE_ENCRYPTED) -> status="failed",
    errorCode="FILE_ENCRYPTED", Spanish errorMessage
  - Worker raises bare Exception -> status="failed", errorCode="INTERNAL",
    generic Spanish errorMessage
"""
from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.errors import ErrorCode, message_for
from app.services.foliate import FoliateError


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _run_inline(
    job_id: str,
    initial_number: int,
    prefix: str,
    position: str,
    font_size: int,
    range_mode: str,
    from_page: int | None,
    to_page: int | None,
) -> None:
    """Stand-in for `rq.Queue.enqueue` — calls the task synchronously."""
    from app.tasks.foliate import run_foliate

    run_foliate(job_id, initial_number, prefix, position, font_size, range_mode, from_page, to_page)


def _enqueue_side_effect():
    return lambda fn, jid, initial_number, prefix, position, font_size, range_mode, from_page, to_page, **kw: _run_inline(
        jid, initial_number, prefix, position, font_size, range_mode, from_page, to_page
    )


# ---------------------------------------------------------------------------
# Happy path + synchronous validation
# ---------------------------------------------------------------------------
def test_foliate_endpoint_creates_job_and_runs_inline(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(minimal_pdf_bytes)
        return 1

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"position": "bottom-right", "prefix": "Folio "},
        )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    job_id = body["jobId"]

    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "done"
    assert info["op"] == "foliate"
    assert info["params"]["position"] == "bottom-right"
    assert info["params"]["prefix"] == "Folio "
    assert info["params"]["range_mode"] == "all"
    assert info["output_bytes"] is not None and info["output_bytes"] > 0
    assert info["duration_ms"] is not None and info["duration_ms"] >= 0


def test_foliate_endpoint_default_values(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(minimal_pdf_bytes)
        return 1

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["params"]["initial_number"] == 1
    assert info["params"]["prefix"] == ""
    assert info["params"]["position"] == "bottom-center"
    assert info["params"]["font_size"] == 12
    assert info["params"]["range_mode"] == "all"
    assert info["params"]["from_page"] is None
    assert info["params"]["to_page"] is None


def test_foliate_endpoint_from_to_range(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(minimal_pdf_bytes)
        return 5

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"range_mode": "from-to", "from_page": "2", "to_page": "6"},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["params"]["range_mode"] == "from-to"
    assert info["params"]["from_page"] == 2
    assert info["params"]["to_page"] == 6


def test_foliate_endpoint_rejects_invalid_position(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"position": "middle-center"},
    )
    assert resp.status_code == 422


def test_foliate_endpoint_rejects_invalid_range_mode(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"range_mode": "random"},
    )
    assert resp.status_code == 422


def test_foliate_endpoint_rejects_oversize_font(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"font_size": "200"},
    )
    assert resp.status_code == 422


def test_foliate_endpoint_rejects_zero_initial_number(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"initial_number": "0"},
    )
    assert resp.status_code == 422


def test_foliate_endpoint_rejects_non_pdf(client: TestClient) -> None:
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(b"not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_NOT_PDF"


def test_foliate_endpoint_rejects_oversize(
    client: TestClient, settings, monkeypatch, minimal_pdf_bytes: bytes
) -> None:
    monkeypatch.setattr(settings, "max_upload_bytes", 50)
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_TOO_LARGE"


def test_foliate_endpoint_from_to_without_bounds_returns_400(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    """range_mode=from-to with missing bounds is a malformed request —
    we reject synchronously with INVALID_PAGE_RANGE rather than enqueuing
    a job we know will fail."""
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"range_mode": "from-to"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "INVALID_PAGE_RANGE"
    assert resp.json()["detail"]["message"] == message_for(ErrorCode.INVALID_PAGE_RANGE)


def test_foliate_endpoint_from_to_with_inverted_bounds_returns_400(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    resp = client.post(
        "/api/jobs/foliate",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"range_mode": "from-to", "from_page": "5", "to_page": "2"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "INVALID_PAGE_RANGE"


def test_foliate_get_status_returns_job_with_op_foliate(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(minimal_pdf_bytes)
        return 1

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"prefix": "Pág. ", "initial_number": "10", "font_size": "16"},
        )
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["op"] == "foliate"
    assert info["params"]["prefix"] == "Pág. "
    assert info["params"]["initial_number"] == 10
    assert info["params"]["font_size"] == 16


# ---------------------------------------------------------------------------
# Worker-failure → job-state tests
# ---------------------------------------------------------------------------
def test_foliate_status_reports_pages_failed_when_range_out_of_bounds(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If from_page > total_pages, the worker writes status=failed with
    errorCode=INVALID_PAGE_RANGE. The POST is 202 — async failures are not
    surfaced via the POST body, only via GET /api/jobs/{jobId}."""

    def fake_foliate(input_path, output_path, params):
        raise FoliateError(ErrorCode.INVALID_PAGE_RANGE, "El rango de páginas no es válido.")

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"range_mode": "from-to", "from_page": "1", "to_page": "99"},
        )

    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.INVALID_PAGE_RANGE.value
    assert info["error_message"] == message_for(ErrorCode.INVALID_PAGE_RANGE)


def test_foliate_status_reports_foliate_failed(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        raise FoliateError(ErrorCode.FOLIATE_FAILED, "PyMuPDF no pudo insertar texto.")

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.FOLIATE_FAILED.value
    assert info["error_message"] == message_for(ErrorCode.FOLIATE_FAILED)


def test_foliate_status_reports_file_corrupt(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        raise FoliateError(ErrorCode.FILE_CORRUPT, "El PDF puede estar dañado o protegido.")

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.FILE_CORRUPT.value
    assert info["error_message"] == message_for(ErrorCode.FILE_CORRUPT)


def test_foliate_status_reports_file_encrypted(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        raise FoliateError(ErrorCode.FILE_ENCRYPTED, "El PDF está protegido con contraseña.")

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.FILE_ENCRYPTED.value
    assert info["error_message"] == message_for(ErrorCode.FILE_ENCRYPTED)


def test_foliate_status_reports_internal_error_on_unexpected_exception(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_foliate(input_path, output_path, params):
        raise RuntimeError("PyMuPDF crashed")

    monkeypatch.setattr("app.tasks.foliate.foliate_service.foliate_pdf", fake_foliate)

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/foliate",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.INTERNAL.value
    assert info["error_message"] == message_for(ErrorCode.INTERNAL)
