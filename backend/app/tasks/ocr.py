"""RQ task: apply OCRmyPDF to a scanned PDF.

The task is intentionally thin — it owns:

1. Job-state transitions (queued -> processing -> done|failed).
2. Wall-clock timing + structured logs.
3. Mapping service exceptions to (errorCode, errorMessage).

Everything else lives in `services/`. That's what makes this file easy
to read and easy to keep stable as the service layer evolves.

Why we log both `size_change_pct` and `reduction_pct` for OCR:
- GS compression *always* shrinks (or fails), so a single `reduction_pct`
  field is unambiguous. OCR is different: the text layer it adds can grow
  the file even when image optimization shrinks it, so the net result can
  be positive *or* negative. Logging both with explicit sign conventions
  removes ambiguity from log scrapes and lets downstream tooling pick the
  sign it wants.
- `size_change_pct = (output - input) / input * 100` — positive = grew.
- `reduction_pct  = (input - output) / input * 100` — positive = shrank.
"""
from __future__ import annotations

import time
from pathlib import Path

from rq import get_current_job

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.errors import ErrorCode, message_for
from app.schemas.job import JobStatus
from app.services import job_store
from app.services import ocr as ocr_service

log = get_logger("task.ocr")

OPTIMIZE_LEVEL = 2


def run_ocr(job_id: str, lang: str = "spa+eng") -> None:
    """RQ entrypoint. Signature is what the API enqueues with."""
    settings = get_settings()
    rq_job = get_current_job()

    info = job_store.get_job(job_id)
    if info is None:
        log.error("task.ocr.no_job", jobId=job_id)
        return

    if info.status != JobStatus.QUEUED:
        log.warning(
            "task.ocr.bad_state",
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
        "task.ocr.start",
        jobId=job_id,
        operation="ocr",
        lang=lang,
        optimize_level=OPTIMIZE_LEVEL,
        input_path=str(input_path),
        input_bytes=info.input_bytes,
    )

    started = time.perf_counter()
    try:
        ocr_service.ocr_pdf(
            input_path,
            output_path,
            lang=lang,
            optimize_level=OPTIMIZE_LEVEL,
        )
    except ocr_service.OCRmyPDFError as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.ocr.failed",
            jobId=job_id,
            operation="ocr",
            lang=lang,
            optimize_level=OPTIMIZE_LEVEL,
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
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        log.error(
            "task.ocr.unexpected",
            jobId=job_id,
            operation="ocr",
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
        size_change_pct = ((output_bytes - info.input_bytes) / info.input_bytes) * 100
        reduction_pct = ((info.input_bytes - output_bytes) / info.input_bytes) * 100
    else:
        size_change_pct = 0.0
        reduction_pct = 0.0

    log.info(
        "task.ocr.success",
        jobId=job_id,
        operation="ocr",
        lang=lang,
        optimize_level=OPTIMIZE_LEVEL,
        input_bytes=info.input_bytes,
        output_bytes=output_bytes,
        size_change_pct=round(size_change_pct, 1),
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
