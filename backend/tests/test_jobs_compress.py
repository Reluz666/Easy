"""End-to-end tests for POST /api/jobs/compress.

We register a fake worker (RQ sync mode) by patching `Queue.enqueue` so
the test runs the task inline. That keeps these tests hermetic — no
separate worker process needed, but the API surface and Redis state
transitions are exercised exactly as in production.
"""
from __future__ import annotations

import io
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.job import JobStatus


pytestmark = pytest.mark.skipif(
    shutil.which("gs") is None,
    reason="ghostscript not installed",
)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _run_inline(job_id: str, level: str) -> None:
    """Stand-in for `rq.Queue.enqueue` — calls the task synchronously."""
    from app.tasks.compress import run_compress

    run_compress(job_id, level)


def test_compress_endpoint_creates_job_and_runs_inline(client: TestClient, settings, minimal_pdf_bytes: bytes) -> None:
    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_queue = mock_get_queue.return_value
        mock_queue.enqueue.side_effect = lambda fn, job_id, level, **kw: _run_inline(job_id, level)

        resp = client.post(
            "/api/jobs/compress",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"level": "media"},
        )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    job_id = body["jobId"]

    # Job state should be DONE after the inline run.
    status_resp = client.get(f"/api/jobs/{job_id}")
    assert status_resp.status_code == 200
    info = status_resp.json()
    assert info["status"] == "done"
    assert info["op"] == "compress"
    assert info["params"]["level"] == "media"
    assert info["output_bytes"] is not None and info["output_bytes"] > 0
    assert info["duration_ms"] is not None and info["duration_ms"] >= 0


def test_compress_endpoint_default_level_is_media(client: TestClient, settings, minimal_pdf_bytes: bytes) -> None:
    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lvl, **kw: _run_inline(jid, lvl)
        resp = client.post(
            "/api/jobs/compress",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["params"]["level"] == "media"


def test_compress_endpoint_rejects_invalid_level(client: TestClient, minimal_pdf_bytes: bytes) -> None:
    resp = client.post(
        "/api/jobs/compress",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"level": "extreme"},
    )
    # FastAPI's Literal[...] check rejects with 422 before our code runs.
    assert resp.status_code == 422


def test_compress_endpoint_rejects_non_pdf(client: TestClient) -> None:
    resp = client.post(
        "/api/jobs/compress",
        files={"file": ("test.pdf", io.BytesIO(b"not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_NOT_PDF"


def test_compress_endpoint_rejects_wrong_content_type(client: TestClient, minimal_pdf_bytes: bytes) -> None:
    resp = client.post(
        "/api/jobs/compress",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "text/plain")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_NOT_PDF"


def test_compress_endpoint_rejects_oversize(client: TestClient, settings, monkeypatch, minimal_pdf_bytes: bytes) -> None:
    monkeypatch.setattr(settings, "max_upload_bytes", 50)
    resp = client.post(
        "/api/jobs/compress",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_TOO_LARGE"


def test_download_streams_pdf_bytes(client: TestClient, settings, minimal_pdf_bytes: bytes) -> None:
    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = lambda fn, jid, lvl, **kw: _run_inline(jid, lvl)
        create = client.post(
            "/api/jobs/compress",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"level": "baja"},
        )
    job_id = create.json()["jobId"]

    resp = client.get(f"/api/jobs/{job_id}/download")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    body = resp.content
    assert body.startswith(b"%PDF-")
    assert b"%%EOF" in body or body.endswith(b"\n%%EOF\n")


def test_download_returns_404_for_unknown_job(client: TestClient) -> None:
    resp = client.get("/api/jobs/01NOPE/download")
    assert resp.status_code == 404
    assert resp.json()["detail"]["errorCode"] == "JOB_NOT_FOUND"


def test_get_status_returns_404_for_unknown_job(client: TestClient) -> None:
    resp = client.get("/api/jobs/01NOPE")
    assert resp.status_code == 404


def test_delete_is_idempotent(client: TestClient) -> None:
    resp = client.delete("/api/jobs/01NOPE")
    assert resp.status_code == 204
