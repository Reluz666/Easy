"""RQ task: edit a PDF's pages via pikepdf.

Mirrors `run_foliate` / `run_compress` / `run_ocr`: thin wrapper that owns
the job-state transitions and the structured logs. All PDF work lives in
`app.services.pages`.

The task receives the operation list as a JSON string (the same bytes the
endpoint got on the wire). We re-parse it here so the worker doesn't
have to trust a pre-parsed structure from the API process — Redis can be
replayed across processes, and a malformed payload must surface as a
clean `INVALID_OPERATION` failure, not a worker crash.

The extra PDF (if any) is read from disk by `settings.extra_inputs_dir /
job_id / "extra.pdf"`. The API saves it before enqueueing.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from rq import get_current_job

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.errors import ErrorCode, message_for
from app.schemas.job import JobStatus
from app.services import job_store
from app.services import pages as pages_service

log = get_logger("task.pages")


def _parse_ops(raw: str) -> list[dict]:
    """Re-parse + validate the ops JSON string on the worker side."""
    from app.schemas.pages import parse_ops_json

    return parse_ops_json(raw)


def run_pages(job_id: str, ops_json: str, has_extra: bool) -> None:
    """RQ entrypoint.

    `has_extra` is the API's pre-decision about whether an `extra.pdf`
    file is on disk for this job. If an insert with `from_pdf="extra"`
    shows up but `has_extra` was false, the service raises
    INVALID_OPERATION before trying to read the file.
    """
    settings = get_settings()
    rq_job = get_current_job()

    info = job_store.get_job(job_id)
    if info is None:
        log.error("task.pages.no_job", jobId=job_id)
        return

    if info.status != JobStatus.QUEUED:
        log.warning(
            "task.pages.bad_state",
            jobId=job_id,
            current_status=info.status.value,
        )
        return

    job_store.update_status(job_id, JobStatus.PROCESSING, progress=5)
    if rq_job is not None:
        rq_job.meta["progress"] = 5
        rq_job.save_meta()

    input_path = Path(info.input_path)
    output_path = settings.outputs_dir / job_id / "output.pdf"
    extra_path = settings.extra_inputs_dir / job_id / "extra.pdf" if has_extra else None

    started = time.perf_counter()
    try:
        ops = _parse_ops(ops_json)
    except ValueError as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.pages.invalid_ops",
            jobId=job_id,
            operation="pages",
            duration_ms=duration_ms,
            errorCode=ErrorCode.INVALID_OPERATION.value,
            error=str(exc),
        )
        job_store.update_status(
            job_id,
            JobStatus.FAILED,
            error_code=ErrorCode.INVALID_OPERATION.value,
            error_message=message_for(ErrorCode.INVALID_OPERATION),
            duration_ms=duration_ms,
        )
        return

    log.info(
        "task.pages.start",
        jobId=job_id,
        operation="pages",
        ops_count=len(ops),
        ops_kind=[op.get("op") for op in ops],
        has_extra=has_extra,
        input_path=str(input_path),
        input_bytes=info.input_bytes,
    )

    try:
        stats = pages_service.edit_pages(
            input_path=input_path,
            output_path=output_path,
            ops=ops,
            extra_path=extra_path,
        )
    except pages_service.PagesError as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.pages.failed",
            jobId=job_id,
            operation="pages",
            duration_ms=duration_ms,
            errorCode=exc.error_code.value,
            error=exc.message,
        )
        job_store.update_status(
            job_id,
            JobStatus.FAILED,
            error_code=exc.error_code.value,
            error_message=message_for(exc.error_code),
            duration_ms=duration_ms,
        )
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.pages.unexpected",
            jobId=job_id,
            operation="pages",
            duration_ms=duration_ms,
            errorCode=ErrorCode.INTERNAL.value,
            error=str(exc),
        )
        job_store.update_status(
            job_id,
            JobStatus.FAILED,
            error_code=ErrorCode.INTERNAL.value,
            error_message=message_for(ErrorCode.INTERNAL),
            duration_ms=duration_ms,
        )
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return

    output_bytes = output_path.stat().st_size
    duration_ms = int((time.perf_counter() - started) * 1000)

    if info.input_bytes and info.input_bytes > 0:
        reduction_pct = ((info.input_bytes - output_bytes) / info.input_bytes) * 100
    else:
        reduction_pct = 0.0

    log.info(
        "task.pages.success",
        jobId=job_id,
        operation="pages",
        pages_in=stats.pages_in,
        pages_out=stats.pages_out,
        delete=stats.delete_count,
        insert=stats.insert_count,
        rotate=stats.rotate_count,
        reorder=stats.reorder_count,
        input_bytes=info.input_bytes,
        output_bytes=output_bytes,
        reduction_pct=round(reduction_pct, 2),
        duration_ms=duration_ms,
    )

    job_store.update_status(
        job_id,
        JobStatus.DONE,
        output_path=str(output_path),
        output_bytes=output_bytes,
        reduction_pct=round(reduction_pct, 2),
        duration_ms=duration_ms,
    )
