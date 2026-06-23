"""Redis-backed job state.

We store each job as a JSON blob under `job:{id}` with a TTL so the user
gets clean-up for free. Updates overwrite the whole blob — these structs
are tiny (a few hundred bytes), so partial updates aren't worth the
extra round-trip.

Why Redis and not RQ's own job registry:
- RQ's `Job` is mostly for execution metadata (status, result, traceback).
  We want a stable, API-shaped view of the job that survives the worker
  dying and that we can shape to match `JobInfo` in the schemas.
- Decoupling lets us replace RQ later (Celery, Dramatiq, ...) without
  rewriting the API.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterator

import redis

from app.core.config import get_settings
from app.core.queue import get_redis
from app.schemas.job import JobInfo, JobOperation, JobStatus


def _key(job_id: str) -> str:
    return f"job:{job_id}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_job(
    job_id: str,
    operation: JobOperation,
    input_path: str,
    safe_name: str,
    input_bytes: int,
    params: dict[str, Any],
    *,
    client_ip: str | None = None,
) -> JobInfo:
    """Initial state — `queued`. Called by the API immediately after upload."""
    info = JobInfo(
        id=job_id,
        op=operation,
        status=JobStatus.QUEUED,
        params={**params, "safe_name": safe_name},
        input_path=input_path,
        input_bytes=input_bytes,
        created_at=_now(),
        client_ip=client_ip,
    )
    _save(info)
    return info


def get_job(job_id: str) -> JobInfo | None:
    raw = get_redis().get(_key(job_id))
    if raw is None:
        return None
    return JobInfo.model_validate_json(raw)


def save_job(info: JobInfo) -> None:
    _save(info)


def update_status(
    job_id: str,
    status: JobStatus,
    *,
    output_path: str | None = None,
    output_bytes: int | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    duration_ms: int | None = None,
    reduction_pct: float | None = None,
    progress: int | None = None,
) -> JobInfo | None:
    """Convenience mutator that loads, patches, saves. Returns None if not found."""
    info = get_job(job_id)
    if info is None:
        return None
    info.status = status
    if output_path is not None:
        info.output_path = output_path
    if output_bytes is not None:
        info.output_bytes = output_bytes
    if error_code is not None:
        info.error_code = error_code
    if error_message is not None:
        info.error_message = error_message
    if duration_ms is not None:
        info.duration_ms = duration_ms
    if reduction_pct is not None:
        info.reduction_pct = reduction_pct
    if progress is not None:
        info.progress = max(0, min(100, progress))
    if status == JobStatus.PROCESSING and info.started_at is None:
        info.started_at = _now()
    if status in (JobStatus.DONE, JobStatus.FAILED):
        info.finished_at = _now()
        if status == JobStatus.DONE:
            info.progress = 100
        else:
            info.progress = 0
    _save(info)
    # Once the job leaves the active set, drop the per-IP counter so
    # the slot becomes available again. We import lazily to avoid a
    # circular dependency: rate_limit -> queue -> settings, while
    # services -> rate_limit stays one-directional.
    if status in (JobStatus.DONE, JobStatus.FAILED) and info.client_ip:
        from app.core.rate_limit import limiter

        limiter.release_active(info.client_ip, info.id)
    return info


def _save(info: JobInfo) -> None:
    settings = get_settings()
    payload = info.model_dump_json()
    get_redis().set(_key(info.id), payload, ex=settings.job_ttl_seconds)


# ---- Internal helpers used by tests / cleanup ---------------------------

def delete_job(job_id: str) -> bool:
    return get_redis().delete(_key(job_id)) > 0


def iter_jobs() -> Iterator[tuple[str, JobStatus]]:
    """Yield `(job_id, status)` for every job currently in Redis.

    Uses `SCAN` (non-blocking) so it's safe to call on a keyspace with
    thousands of entries. Keys that fail to parse (e.g. a partial write
    from a crashed process) are silently skipped — a malformed blob is
    not the cleanup worker's problem to fix; leaving it alone keeps the
    job visible to `GET /api/jobs/{id}`, which will surface the parse
    error to the user.

    The cleanup worker is the only consumer today; we keep the surface
    minimal (id + status) because that's all most callers need. Use
    `iter_jobs_full()` when you need `JobInfo` (e.g. `finished_at`).
    """
    for job_id, info in iter_jobs_full():
        yield job_id, info.status


def iter_jobs_full() -> Iterator[tuple[str, JobInfo]]:
    """Yield `(job_id, JobInfo)` for every parseable job in Redis.

    Malformed blobs are skipped (see `iter_jobs` for the rationale).
    Returns the full `JobInfo` so callers that need `finished_at`,
    `created_at`, etc. don't have to round-trip a second time per key.
    """
    r = get_redis()
    for raw_key in r.scan_iter(match="job:*"):
        key = raw_key.decode("utf-8") if isinstance(raw_key, bytes) else str(raw_key)
        if not key.startswith("job:"):
            continue
        job_id = key[len("job:"):]
        raw = r.get(key)
        if raw is None:
            continue
        try:
            info = JobInfo.model_validate_json(raw)
        except Exception:
            continue
        yield job_id, info
