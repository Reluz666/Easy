"""RQ task: compress a PDF with Ghostscript.

The task is intentionally thin — it owns:

1. Job-state transitions (queued -> processing -> done|failed).
2. Wall-clock timing + structured logs.
3. Mapping service exceptions to (errorCode, errorMessage).

Everything else lives in `services/`. That's what makes this file easy
to read and easy to keep stable as the service layer evolves.
"""
from __future__ import annotations

import time
from pathlib import Path

from rq import get_current_job

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.errors import ErrorCode, message_for
from app.schemas.job import JobStatus
from app.services import ghostscript as gs_service
from app.services import job_store

log = get_logger("task.compress")


def run_compress(job_id: str, level: str) -> None:
    """RQ entrypoint. Signature is what the API enqueues with."""
    settings = get_settings()
    rq_job = get_current_job()

    info = job_store.get_job(job_id)
    if info is None:
        log.error("task.compress.no_job", jobId=job_id)
        return

    if info.status != JobStatus.QUEUED:
        log.warning(
            "task.compress.bad_state",
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

    log.info(
        "task.compress.start",
        jobId=job_id,
        operation="compress",
        preset=level,
        input_path=str(input_path),
        input_bytes=info.input_bytes,
    )

    started = time.perf_counter()
    try:
        gs_service.compress_pdf(input_path, output_path, level)
    except gs_service.GhostscriptError as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.compress.failed",
            jobId=job_id,
            operation="compress",
            preset=level,
            input_bytes=info.input_bytes,
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
        # Cleanup the partial output if gs left one.
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.compress.unexpected",
            jobId=job_id,
            operation="compress",
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
    reduction_pct = (
        ((info.input_bytes - output_bytes) / info.input_bytes) * 100
        if info.input_bytes and info.input_bytes > 0
        else 0.0
    )

    log.info(
        "task.compress.success",
        jobId=job_id,
        operation="compress",
        preset=level,
        input_bytes=info.input_bytes,
        output_bytes=output_bytes,
        reduction_pct=round(reduction_pct, 1),
        duration_ms=duration_ms,
    )

    job_store.update_status(
        job_id,
        JobStatus.DONE,
        output_path=str(output_path),
        output_bytes=output_bytes,
        reduction_pct=round(reduction_pct, 1),
        duration_ms=duration_ms,
    )
