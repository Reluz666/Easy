"""RQ task: foliate a PDF using PyMuPDF.

Mirrors `run_compress` / `run_ocr`: thin wrapper that owns the job-state
transitions and the structured logs. All PDF work lives in
`app.services.foliate`.

Why the parameter list is positional + keyword-defaulted instead of a
single dict:
- RQ pickles arguments by position. A flat signature lets the API pass
  each form field verbatim and makes the dequeued trace trivially
  inspectable. Adding a parameter doesn't break in-flight jobs (they
  pick up the new default).

Why no progress beyond 5% / 100%:
- Foliating a few hundred pages takes seconds, not minutes. The 5% /
  100% bookends are enough to render a meaningful spinner without
  pretending we have per-page telemetry we don't.
"""
from __future__ import annotations

import time
from pathlib import Path

from rq import get_current_job

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.errors import ErrorCode, message_for
from app.schemas.job import JobStatus
from app.services import foliate as foliate_service
from app.services import job_store

log = get_logger("task.foliate")


def run_foliate(
    job_id: str,
    initial_number: int = 1,
    prefix: str = "",
    position: str = "bottom-center",
    font_size: int = 12,
    range_mode: str = "all",
    from_page: int | None = None,
    to_page: int | None = None,
) -> None:
    """RQ entrypoint. Signature is what the API enqueues with."""
    settings = get_settings()
    rq_job = get_current_job()

    info = job_store.get_job(job_id)
    if info is None:
        log.error("task.foliate.no_job", jobId=job_id)
        return

    if info.status != JobStatus.QUEUED:
        log.warning(
            "task.foliate.bad_state",
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

    params = foliate_service.FoliateParams(
        initial_number=initial_number,
        prefix=prefix,
        position=position,
        font_size=font_size,
        range_mode=range_mode,
        from_page=from_page,
        to_page=to_page,
    )

    log.info(
        "task.foliate.start",
        jobId=job_id,
        operation="foliate",
        position=position,
        font_size=font_size,
        range_mode=range_mode,
        from_page=from_page,
        to_page=to_page,
        initial_number=initial_number,
        prefix=prefix,
        input_path=str(input_path),
        input_bytes=info.input_bytes,
    )

    started = time.perf_counter()
    try:
        pages_processed = foliate_service.foliate_pdf(input_path, output_path, params)
    except foliate_service.FoliateError as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.foliate.failed",
            jobId=job_id,
            operation="foliate",
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
            "task.foliate.unexpected",
            jobId=job_id,
            operation="foliate",
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
        "task.foliate.success",
        jobId=job_id,
        operation="foliate",
        pages_processed=pages_processed,
        range=range_mode,
        from_page=from_page,
        to_page=to_page,
        position=position,
        font_size=font_size,
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
