"""End-to-end tests for POST /api/jobs/pages.

Same inline-runner pattern as `test_jobs_compress.py` / `test_jobs_foliate.py`:
we patch `Queue.enqueue` so the task runs synchronously inside the test,
exercising the real API surface and the real Redis state transitions.

Error contract under test:

* Synchronous failures (rejected before the worker runs):
  - Malformed ops JSON or invalid op shape -> 400 INVALID_OPERATION
  - Insert references `from_pdf: "extra"` but no `extra_file` -> 400
    INVALID_OPERATION
  - Non-PDF bytes on either upload -> 400 FILE_NOT_PDF
  - Oversize on either upload -> 400 FILE_TOO_LARGE

* Asynchronous failures (live in the job state, surfaced by GET):
  - Worker raises PagesError(INVALID_PAGE_RANGE) -> status="failed",
    errorCode="INVALID_PAGE_RANGE", Spanish errorMessage
  - Worker raises PagesError(INVALID_OPERATION) -> status="failed",
    errorCode="INVALID_OPERATION", Spanish errorMessage
  - Worker raises PagesError(PAGES_FAILED) -> status="failed",
    errorCode="PAGES_FAILED", Spanish errorMessage
  - Worker raises PagesError(FILE_CORRUPT) -> status="failed",
    errorCode="FILE_CORRUPT", Spanish errorMessage
  - Worker raises PagesError(FILE_ENCRYPTED) -> status="failed",
    errorCode="FILE_ENCRYPTED", Spanish errorMessage
  - Worker raises bare Exception -> status="failed", errorCode="INTERNAL",
    generic Spanish errorMessage
"""
from __future__ import annotations

import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.errors import ErrorCode, message_for
from app.services.pages import PagesError


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _run_inline(job_id: str, ops_json: str, has_extra: bool) -> None:
    """Stand-in for `rq.Queue.enqueue` — calls the task synchronously."""
    from app.tasks.pages import run_pages

    run_pages(job_id, ops_json, has_extra)


def _enqueue_side_effect():
    return lambda fn, jid, ops_json, has_extra, **kw: _run_inline(jid, ops_json, has_extra)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _ops(*dicts: dict) -> str:
    return json.dumps(list(dicts))


def _ok_fake_edit(input_path, output_path, ops, extra_path):
    """Drop a tiny PDF at output_path so the worker's "output_path exists"
    checks pass and the job ends in DONE."""
    from app.services.pages import EditStats

    output_path.parent.mkdir(parents=True, exist_ok=True)
    import pikepdf

    pdf = pikepdf.Pdf.new()
    pdf.pages.append(pikepdf.Page(pikepdf.Dictionary(
        Type=pikepdf.Name.Page,
        MediaBox=[0, 0, 612, 792],
    )))
    pdf.save(str(output_path))
    pdf.close()
    return EditStats(
        pages_in=1,
        pages_out=1,
        delete_count=0,
        insert_count=0,
        rotate_count=0,
        reorder_count=0,
    )


# ---------------------------------------------------------------------------
# Happy path + sync validation
# ---------------------------------------------------------------------------
def test_pages_endpoint_creates_job_and_runs_inline(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.tasks.pages.pages_service.edit_pages", _ok_fake_edit)

    ops = _ops({"op": "delete", "pages": [2]})

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/pages",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"ops": ops},
        )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    job_id = body["jobId"]

    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "done"
    assert info["op"] == "pages"
    assert info["params"]["has_extra"] is False
    assert info["params"]["ops"][0]["op"] == "delete"
    assert info["params"]["ops"][0]["pages"] == [2]


def test_pages_endpoint_accepts_extra_file(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.tasks.pages.pages_service.edit_pages", _ok_fake_edit)

    ops = _ops({
        "op": "insert",
        "after_page": 1,
        "from_pdf": "extra",
        "pages": [1],
    })

    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/pages",
            files=[
                ("file", ("main.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")),
                ("extra_file", ("extra.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")),
            ],
            data={"ops": ops},
        )

    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["status"] == "done"
    assert info["params"]["has_extra"] is True


def test_pages_endpoint_rejects_insert_extra_without_upload(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    ops = _ops({
        "op": "insert",
        "after_page": 1,
        "from_pdf": "extra",
        "pages": [1],
    })
    resp = client.post(
        "/api/jobs/pages",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": ops},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["errorCode"] == "INVALID_OPERATION"


def test_pages_endpoint_rejects_malformed_ops_json(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    resp = client.post(
        "/api/jobs/pages",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": "this is not json"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "INVALID_OPERATION"


def test_pages_endpoint_rejects_ops_not_a_list(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    resp = client.post(
        "/api/jobs/pages",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": json.dumps({"op": "delete", "pages": [1]})},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "INVALID_OPERATION"


def test_pages_endpoint_rejects_unknown_op_kind(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    ops = _ops({"op": "explode", "pages": [1]})
    resp = client.post(
        "/api/jobs/pages",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": ops},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "INVALID_OPERATION"


def test_pages_endpoint_rejects_invalid_rotate_degree(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    """Discriminated union: an invalid `degrees` literal is rejected by
    Pydantic, so the response is INVALID_OPERATION (mapped by us)."""
    ops = _ops({"op": "rotate", "pages": [1], "degrees": 45})
    resp = client.post(
        "/api/jobs/pages",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": ops},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "INVALID_OPERATION"


def test_pages_endpoint_rejects_non_pdf_main(
    client: TestClient
) -> None:
    ops = _ops({"op": "delete", "pages": [1]})
    resp = client.post(
        "/api/jobs/pages",
        files={"file": ("test.pdf", io.BytesIO(b"not a pdf"), "application/pdf")},
        data={"ops": ops},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_NOT_PDF"


def test_pages_endpoint_rejects_non_pdf_extra(
    client: TestClient, minimal_pdf_bytes: bytes
) -> None:
    ops = _ops({
        "op": "insert",
        "after_page": 1,
        "from_pdf": "extra",
        "pages": [1],
    })
    resp = client.post(
        "/api/jobs/pages",
        files=[
            ("file", ("main.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")),
            ("extra_file", ("extra.pdf", io.BytesIO(b"not a pdf"), "application/pdf")),
        ],
        data={"ops": ops},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_NOT_PDF"


def test_pages_endpoint_rejects_oversize_main(
    client: TestClient, settings, monkeypatch, minimal_pdf_bytes: bytes
) -> None:
    monkeypatch.setattr(settings, "max_upload_bytes", 50)
    ops = _ops({"op": "delete", "pages": [1]})
    resp = client.post(
        "/api/jobs/pages",
        files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": ops},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["errorCode"] == "FILE_TOO_LARGE"


def test_pages_get_status_returns_job_with_op_pages(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.tasks.pages.pages_service.edit_pages", _ok_fake_edit)

    ops = _ops({"op": "rotate", "pages": [1, 2], "degrees": 180})
    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/pages",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"ops": ops},
        )
    job_id = resp.json()["jobId"]
    info = client.get(f"/api/jobs/{job_id}").json()
    assert info["op"] == "pages"
    assert info["params"]["ops"][0] == {
        "op": "rotate",
        "pages": [1, 2],
        "degrees": 180,
    }


# ---------------------------------------------------------------------------
# Worker-failure → job-state tests
# ---------------------------------------------------------------------------
def _post_and_get_status(
    client: TestClient,
    *,
    minimal_pdf_bytes: bytes,
    monkeypatch: pytest.MonkeyPatch,
    ops: str,
    fake_edit,
):
    monkeypatch.setattr("app.tasks.pages.pages_service.edit_pages", fake_edit)
    with patch("app.api.jobs.get_queue") as mock_get_queue:
        mock_get_queue.return_value.enqueue.side_effect = _enqueue_side_effect()
        resp = client.post(
            "/api/jobs/pages",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            data={"ops": ops},
        )
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    return client.get(f"/api/jobs/{job_id}").json()


def test_pages_status_reports_invalid_page_range(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_edit(input_path, output_path, ops, extra_path):
        raise PagesError(ErrorCode.INVALID_PAGE_RANGE, "El rango de páginas no es válido.")

    info = _post_and_get_status(
        client,
        minimal_pdf_bytes=minimal_pdf_bytes,
        monkeypatch=monkeypatch,
        ops=_ops({"op": "delete", "pages": [99]}),
        fake_edit=fake_edit,
    )
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.INVALID_PAGE_RANGE.value
    assert info["error_message"] == message_for(ErrorCode.INVALID_PAGE_RANGE)


def test_pages_status_reports_invalid_operation(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_edit(input_path, output_path, ops, extra_path):
        raise PagesError(ErrorCode.INVALID_OPERATION, "Operación inválida.")

    info = _post_and_get_status(
        client,
        minimal_pdf_bytes=minimal_pdf_bytes,
        monkeypatch=monkeypatch,
        ops=_ops({"op": "delete", "pages": [1]}),
        fake_edit=fake_edit,
    )
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.INVALID_OPERATION.value
    assert info["error_message"] == message_for(ErrorCode.INVALID_OPERATION)


def test_pages_status_reports_pages_failed(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_edit(input_path, output_path, ops, extra_path):
        raise PagesError(ErrorCode.PAGES_FAILED, "No se pudo editar las páginas del PDF.")

    info = _post_and_get_status(
        client,
        minimal_pdf_bytes=minimal_pdf_bytes,
        monkeypatch=monkeypatch,
        ops=_ops({"op": "delete", "pages": [1]}),
        fake_edit=fake_edit,
    )
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.PAGES_FAILED.value
    assert info["error_message"] == message_for(ErrorCode.PAGES_FAILED)


def test_pages_status_reports_file_corrupt(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_edit(input_path, output_path, ops, extra_path):
        raise PagesError(ErrorCode.FILE_CORRUPT, "El PDF puede estar dañado o protegido.")

    info = _post_and_get_status(
        client,
        minimal_pdf_bytes=minimal_pdf_bytes,
        monkeypatch=monkeypatch,
        ops=_ops({"op": "delete", "pages": [1]}),
        fake_edit=fake_edit,
    )
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.FILE_CORRUPT.value
    assert info["error_message"] == message_for(ErrorCode.FILE_CORRUPT)


def test_pages_status_reports_file_encrypted(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_edit(input_path, output_path, ops, extra_path):
        raise PagesError(ErrorCode.FILE_ENCRYPTED, "El PDF está protegido con contraseña.")

    info = _post_and_get_status(
        client,
        minimal_pdf_bytes=minimal_pdf_bytes,
        monkeypatch=monkeypatch,
        ops=_ops({"op": "delete", "pages": [1]}),
        fake_edit=fake_edit,
    )
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.FILE_ENCRYPTED.value
    assert info["error_message"] == message_for(ErrorCode.FILE_ENCRYPTED)


def test_pages_status_reports_internal_error_on_unexpected_exception(
    client: TestClient, minimal_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_edit(input_path, output_path, ops, extra_path):
        raise RuntimeError("pikepdf exploded")

    info = _post_and_get_status(
        client,
        minimal_pdf_bytes=minimal_pdf_bytes,
        monkeypatch=monkeypatch,
        ops=_ops({"op": "delete", "pages": [1]}),
        fake_edit=fake_edit,
    )
    assert info["status"] == "failed"
    assert info["error_code"] == ErrorCode.INTERNAL.value
    assert info["error_message"] == message_for(ErrorCode.INTERNAL)
