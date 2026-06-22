"""HTTP surface for the PDF tools.

Flow for compress (and future ocr/foliate/pages — same shape):

    POST /api/jobs/{op}      multipart file (+ params)
       -> validate, save to /data/jobs/{id}/input.pdf
       -> write job state to Redis
       -> enqueue task on Redis
       -> return { jobId, status: "queued" }

    GET  /api/jobs/{id}      read state from Redis

    GET  /api/jobs/{id}/download
       -> stream output.pdf to the client (StreamingResponse, never RAM)

Why we don't pass the file bytes through the queue:
- 100 MB through Redis would be 100 MB through the network twice
  (api -> redis -> worker). Disk I/O via the shared `job-data` volume
  is faster and never holds the PDF in Python memory.
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.core.ids import new_job_id
from app.core.logging import get_logger
from app.core.queue import get_queue
from app.schemas.errors import ErrorCode, message_for
from app.schemas.job import JobCreatedResponse, JobInfo, JobOperation, JobStatus
from app.services import job_store
from app.services.uploads import save_pdf_upload
from app.services.ghostscript import VALID_LEVELS

log = get_logger("api.jobs")

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# Bound the level parameter via Literal[...]; FastAPI rejects anything else
# with 422 before the handler runs.
CompressLevel = Literal["baja", "media", "alta"]


# ---------------------------------------------------------------------------
# POST /api/jobs/compress
# ---------------------------------------------------------------------------
@router.post(
    "/compress",
    response_model=JobCreatedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_compress_job(
    file: UploadFile = File(...),
    level: CompressLevel = Form(default="media"),
) -> JobCreatedResponse:
    settings = get_settings()
    job_id = new_job_id()

    saved = save_pdf_upload(file, job_id)

    info = job_store.create_job(
        job_id=job_id,
        operation=JobOperation.COMPRESS,
        input_path=str(saved.path),
        safe_name=saved.safe_name,
        input_bytes=saved.size,
        params={"level": level},
    )

    log.info(
        "api.jobs.compress.created",
        jobId=job_id,
        operation="compress",
        preset=level,
        input_name=saved.safe_name,
        input_bytes=saved.size,
        max_upload_bytes=settings.max_upload_bytes,
    )

    # Enqueue on the `compress` queue. The worker is the only place that
    # actually imports `run_compress`; here we just pass the function
    # object to RQ, which pickles the reference. We let RQ generate its
    # own internal id — our `job_id` is the API-level identifier the
    # client uses to poll state, and we pass it positionally so the task
    # knows which Redis key to update.
    from app.tasks.compress import run_compress

    queue = get_queue("compress")
    # RQ's job_timeout must exceed the gs timeout, otherwise RQ kills the task
    # *after* gs has already written its output but *before* our code reads the
    # result — a race that leaves the job marked failed even though the PDF is
    # ready. We add 60 s of headroom for cleanup + state writes.
    queue.enqueue(
        run_compress,
        job_id,
        level,
        job_timeout=settings.gs_timeout_seconds + 60,
        result_ttl=settings.job_ttl_seconds,
        failure_ttl=settings.job_ttl_seconds,
    )

    return JobCreatedResponse(jobId=job_id, status="queued")


# ---------------------------------------------------------------------------
# GET /api/jobs/{jobId}
# ---------------------------------------------------------------------------
@router.get("/{job_id}", response_model=JobInfo)
def get_job_status(job_id: str) -> JobInfo:
    info = job_store.get_job(job_id)
    if info is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "errorCode": ErrorCode.JOB_NOT_FOUND.value,
                "message": message_for(
                    ErrorCode.JOB_NOT_FOUND,
                    ttl_h=get_settings().job_ttl_seconds // 3600,
                ),
            },
        )
    return info


# ---------------------------------------------------------------------------
# GET /api/jobs/{jobId}/download — streaming, never loads the PDF in RAM.
# ---------------------------------------------------------------------------
@router.get("/{job_id}/download")
def download_job_result(job_id: str) -> StreamingResponse:
    info = job_store.get_job(job_id)
    if info is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "errorCode": ErrorCode.JOB_NOT_FOUND.value,
                "message": message_for(
                    ErrorCode.JOB_NOT_FOUND,
                    ttl_h=get_settings().job_ttl_seconds // 3600,
                ),
            },
        )
    if info.status != JobStatus.DONE or not info.output_path:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "errorCode": "JOB_NOT_READY",
                "message": "El trabajo todavía no terminó.",
            },
        )

    output_path = Path(info.output_path)
    if not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={
                "errorCode": "JOB_OUTPUT_MISSING",
                "message": "El archivo de salida ya no está disponible.",
            },
        )

    safe_name = info.params.get("safe_name") if isinstance(info.params, dict) else None
    if not isinstance(safe_name, str) or not safe_name:
        safe_name = "documento.pdf"

    suggested = _suggest_output_name(safe_name, suffix=info.op.value)

    return StreamingResponse(
        _file_iter(output_path, chunk_bytes=64 * 1024),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{suggested}"',
            "Content-Length": str(output_path.stat().st_size),
            "X-Job-Id": job_id,
        },
    )


# ---------------------------------------------------------------------------
# DELETE /api/jobs/{jobId} — best-effort cleanup.
# ---------------------------------------------------------------------------
@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_job(job_id: str) -> Response:
    info = job_store.get_job(job_id)
    if info is None:
        # Idempotent: deleting a missing job is not an error.
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    for path_str in (info.input_path, info.output_path):
        if not path_str:
            continue
        p = Path(path_str)
        # Only delete files we own (under data_dir), never anything outside.
        try:
            p.resolve().relative_to(get_settings().data_dir.resolve())
        except ValueError:
            continue
        if p.is_file():
            p.unlink(missing_ok=True)
    job_store.delete_job(job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _suggest_output_name(original: str, suffix: str) -> str:
    stem = original[:-4] if original.lower().endswith(".pdf") else original
    return f"{stem}-{suffix}.pdf"


def _file_iter(path: Path, chunk_bytes: int):
    """Yield chunks of `path` until EOF. Open file is closed on completion."""
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_bytes)
            if not chunk:
                return
            yield chunk
