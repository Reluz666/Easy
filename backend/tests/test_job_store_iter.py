"""Tests for `app.services.job_store.iter_jobs*`.

These cover the new SCAN-based iterators used by the cleanup worker.
The `data_dir` fixture points Redis at a tmp dir + DB 15 (see conftest).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.queue import get_redis
from app.schemas.job import JobInfo, JobOperation, JobStatus
from app.services import job_store


def _seed(job_id: str, status: JobStatus, finished_at: datetime | None = None) -> None:
    info = JobInfo(
        id=job_id,
        op=JobOperation.COMPRESS,
        status=status,
        progress=100 if status == JobStatus.DONE else 0,
        params={"safe_name": "x.pdf"},
        input_path=f"/tmp/{job_id}/input.pdf",
        input_bytes=100,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=finished_at,
    )
    r = get_redis()
    r.set(f"job:{job_id}", info.model_dump_json(), ex=get_settings().job_ttl_seconds)


def test_iter_jobs_yields_id_and_status() -> None:
    _seed("01AAA", JobStatus.QUEUED)
    _seed("01BBB", JobStatus.DONE)
    _seed("01CCC", JobStatus.FAILED)

    result = dict(job_store.iter_jobs())
    assert result == {
        "01AAA": JobStatus.QUEUED,
        "01BBB": JobStatus.DONE,
        "01CCC": JobStatus.FAILED,
    }


def test_iter_jobs_full_yields_full_info() -> None:
    finished = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    _seed("01XYZ", JobStatus.DONE, finished_at=finished)

    items = list(job_store.iter_jobs_full())
    assert len(items) == 1
    job_id, info = items[0]
    assert job_id == "01XYZ"
    assert info.status == JobStatus.DONE
    assert info.finished_at == finished


def test_iter_jobs_skips_garbage_keys() -> None:
    """A key that doesn't match the `job:` prefix or holds a non-JSON
    blob must be silently ignored — cleanup must not crash on stale
    or malformed data."""
    r = get_redis()
    r.set("not-a-job-key", "irrelevant")
    r.set("job:01OK", _info_blob(JobStatus.DONE))
    r.set("job:01BAD", "this is not json {{{")
    r.set("job:01ALSO_BAD", "[]")  # valid JSON but not a JobInfo shape

    result = dict(job_store.iter_jobs())
    # Only the parseable JobInfo shows up; the garbage keys are skipped.
    assert list(result.keys()) == ["01OK"]


def test_iter_jobs_empty_when_no_jobs() -> None:
    assert list(job_store.iter_jobs()) == []


def _info_blob(status: JobStatus) -> str:
    return JobInfo(
        id="01OK",
        op=JobOperation.COMPRESS,
        status=status,
        params={"safe_name": "x.pdf"},
        input_path="/tmp/01OK/input.pdf",
        input_bytes=100,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    ).model_dump_json()
