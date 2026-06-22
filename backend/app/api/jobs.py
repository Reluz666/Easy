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
from app.services.uploads import save_extra_pdf_upload, save_pdf_upload
from app.services.ghostscript import VALID_LEVELS

log = get_logger("api.jobs")

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# Bound the level parameter via Literal[...]; FastAPI rejects anything else
# with 422 before the handler runs.
CompressLevel = Literal["baja", "media", "alta"]
OcrLang = Literal["spa+eng", "spa", "eng"]
FoliatePosition = Literal[
    "top-left", "top-center", "top-right",
    "bottom-left", "bottom-center", "bottom-right",
]
FoliateRangeMode = Literal["all", "from-to"]


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
# POST /api/jobs/ocr
#
# Error contract:
#   * 422 — invalid language (Literal validation)
#   * 400 — file is not a PDF or exceeds max size (upload validator)
#   * 500 — unexpected error saving the file
#   * 202 — accepted, job enqueued
#
# Worker-side failures (OCR_TIMEOUT, OCR_FAILED, empty output, raw
# ocrmypdf non-zero exit) live in the job state and are surfaced via
# `GET /api/jobs/{jobId}` as status="failed" with errorCode + Spanish
# errorMessage. The POST body never carries the OCR outcome.
# ---------------------------------------------------------------------------
@router.post(
    "/ocr",
    response_model=JobCreatedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_ocr_job(
    file: UploadFile = File(...),
    lang: OcrLang = Form(default="spa+eng"),
) -> JobCreatedResponse:
    settings = get_settings()
    job_id = new_job_id()

    saved = save_pdf_upload(file, job_id)

    info = job_store.create_job(
        job_id=job_id,
        operation=JobOperation.OCR,
        input_path=str(saved.path),
        safe_name=saved.safe_name,
        input_bytes=saved.size,
        params={"lang": lang},
    )

    log.info(
        "api.jobs.ocr.created",
        jobId=job_id,
        operation="ocr",
        lang=lang,
        input_name=saved.safe_name,
        input_bytes=saved.size,
        max_upload_bytes=settings.max_upload_bytes,
    )

    from app.tasks.ocr import run_ocr

    queue = get_queue("ocr")
    # Same RQ headroom pattern as compress: OCR_TIMEOUT_SECONDS is the
    # deadline we enforce inside the service; RQ's own job_timeout must
    # exceed it so the cleanup + state write completes even if the
    # service is at the edge of its budget.
    queue.enqueue(
        run_ocr,
        job_id,
        lang,
        job_timeout=settings.ocr_timeout_seconds + 60,
        result_ttl=settings.job_ttl_seconds,
        failure_ttl=settings.job_ttl_seconds,
    )

    return JobCreatedResponse(jobId=job_id, status="queued")


# ---------------------------------------------------------------------------
# POST /api/jobs/foliate
#
# Error contract:
#   * 422 — invalid position / range_mode / font_size / initial_number
#           (Literal + Pydantic constraints reject before the handler runs)
#   * 400 INVALID_PAGE_RANGE — range_mode == "from-to" but from_page/to_page
#           are missing, or from_page > to_page. Bounds against the actual
#           PDF page count happen in the worker and surface as 200 +
#           status="failed" via GET /api/jobs/{jobId}.
#   * 400 FILE_NOT_PDF / FILE_TOO_LARGE — upload validator
#   * 500 — unexpected error saving the file
#   * 202 — accepted, job enqueued
# ---------------------------------------------------------------------------
@router.post(
    "/foliate",
    response_model=JobCreatedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_foliate_job(
    file: UploadFile = File(...),
    initial_number: int = Form(default=1, ge=1),
    prefix: str = Form(default=""),
    position: FoliatePosition = Form(default="bottom-center"),
    font_size: int = Form(default=12, ge=6, le=72),
    range_mode: FoliateRangeMode = Form(default="all"),
    from_page: int | None = Form(default=None, ge=1),
    to_page: int | None = Form(default=None, ge=1),
) -> JobCreatedResponse:
    if range_mode == "from-to":
        if from_page is None or to_page is None or from_page > to_page:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "errorCode": ErrorCode.INVALID_PAGE_RANGE.value,
                    "message": message_for(ErrorCode.INVALID_PAGE_RANGE),
                },
            )

    settings = get_settings()
    job_id = new_job_id()
    saved = save_pdf_upload(file, job_id)

    info = job_store.create_job(
        job_id=job_id,
        operation=JobOperation.FOLIATE,
        input_path=str(saved.path),
        safe_name=saved.safe_name,
        input_bytes=saved.size,
        params={
            "initial_number": initial_number,
            "prefix": prefix,
            "position": position,
            "font_size": font_size,
            "range_mode": range_mode,
            "from_page": from_page,
            "to_page": to_page,
        },
    )

    log.info(
        "api.jobs.foliate.created",
        jobId=job_id,
        operation="foliate",
        position=position,
        font_size=font_size,
        range_mode=range_mode,
        from_page=from_page,
        to_page=to_page,
        initial_number=initial_number,
        prefix=prefix,
        input_name=saved.safe_name,
        input_bytes=saved.size,
    )

    from app.tasks.foliate import run_foliate

    queue = get_queue("foliate")
    queue.enqueue(
        run_foliate,
        job_id,
        initial_number,
        prefix,
        position,
        font_size,
        range_mode,
        from_page,
        to_page,
        job_timeout=settings.foliate_timeout_seconds + 60,
        result_ttl=settings.job_ttl_seconds,
        failure_ttl=settings.job_ttl_seconds,
    )

    return JobCreatedResponse(jobId=job_id, status="queued")


# ---------------------------------------------------------------------------
# POST /api/jobs/pages
#
# Error contract:
#   * 400 INVALID_OPERATION — malformed ops JSON, or an insert references
#           `from_pdf: "extra"` but no `extra_file` was uploaded
#   * 400 FILE_NOT_PDF / FILE_TOO_LARGE — upload validator (main or extra)
#   * 500 — unexpected error saving files
#   * 202 — accepted, job enqueued
#
# Worker-side failures (INVALID_PAGE_RANGE, INVALID_OPERATION, FILE_CORRUPT,
# FILE_ENCRYPTED, PAGES_FAILED, INTERNAL) live in the job state and are
# surfaced via `GET /api/jobs/{jobId}` as status="failed" with errorCode +
# Spanish errorMessage. The POST body never carries the page-edit outcome.
# ---------------------------------------------------------------------------
@router.post(
    "/pages",
    response_model=JobCreatedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_pages_job(
    file: UploadFile = File(...),
    ops: str = Form(...),
    extra_file: UploadFile | None = File(default=None),
) -> JobCreatedResponse:
    # 1) Validate ops shape BEFORE writing any files, so a malformed payload
    #    never creates an empty job on disk.
    from app.schemas.pages import parse_ops_json

    try:
        validated_ops = parse_ops_json(ops)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "errorCode": ErrorCode.INVALID_OPERATION.value,
                "message": str(exc),
            },
        )

    # 2) If any op reads from `extra`, an extra_file upload is mandatory.
    needs_extra = any(op.get("from_pdf") == "extra" for op in validated_ops)
    if needs_extra and extra_file is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "errorCode": ErrorCode.INVALID_OPERATION.value,
                "message": message_for(ErrorCode.INVALID_OPERATION),
            },
        )

    settings = get_settings()
    job_id = new_job_id()

    saved_main = save_pdf_upload(file, job_id)
    saved_extra = save_extra_pdf_upload(extra_file, job_id) if extra_file is not None else None

    info = job_store.create_job(
        job_id=job_id,
        operation=JobOperation.PAGES,
        input_path=str(saved_main.path),
        safe_name=saved_main.safe_name,
        input_bytes=saved_main.size,
        params={
            "ops": validated_ops,
            "has_extra": saved_extra is not None,
            "extra_path": str(saved_extra.path) if saved_extra else None,
        },
    )

    log.info(
        "api.jobs.pages.created",
        jobId=job_id,
        operation="pages",
        ops_count=len(validated_ops),
        ops_kinds=[op.get("op") for op in validated_ops],
        has_extra=saved_extra is not None,
        input_name=saved_main.safe_name,
        input_bytes=saved_main.size,
    )

    from app.tasks.pages import run_pages

    queue = get_queue("pages")
    queue.enqueue(
        run_pages,
        job_id,
        ops,
        saved_extra is not None,
        job_timeout=settings.pages_timeout_seconds + 60,
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
    # Pages jobs store the secondary input under params["extra_path"].
    extra_path_str = None
    if isinstance(info.params, dict):
        extra_path_str = info.params.get("extra_path")
    for path_str in (info.input_path, info.output_path, extra_path_str):
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
