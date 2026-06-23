"""Tests for `app.services.cleanup.cleanup_once`.

Each test sets up a small `/data` tree under `tmp_path` (via the
`data_dir` fixture), seeds Redis with `JobInfo` blobs, then asserts
which directories survive a single cleanup pass.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.core.queue import get_redis
from app.schemas.job import JobInfo, JobOperation, JobStatus
from app.services import cleanup, job_store


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# A frozen "now" so we can reason about TTL cutoffs deterministically.
# Cleanup accepts `now` as an argument precisely for this reason.
_NOW = datetime(2026, 6, 22, 12, 0, 0, tzinfo=timezone.utc)


def _seed_job(
    job_id: str,
    status: JobStatus,
    *,
    finished_at: datetime | None = None,
    created_at: datetime | None = None,
) -> None:
    """Write a `job:{id}` blob to Redis with the requested status."""
    info = JobInfo(
        id=job_id,
        op=JobOperation.COMPRESS,
        status=status,
        params={"safe_name": "x.pdf"},
        input_path=f"/tmp/{job_id}/input.pdf",
        input_bytes=100,
        created_at=created_at or _NOW,
        finished_at=finished_at,
    )
    r = get_redis()
    r.set(f"job:{job_id}", info.model_dump_json(), ex=get_settings().job_ttl_seconds)


def _make_job_dir(base: Path, job_id: str, *, size_bytes: int = 0) -> Path:
    """Create `<base>/<job_id>/file.pdf` of the given size. Returns the dir."""
    d = base / job_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "file.pdf").write_bytes(b"x" * size_bytes)
    return d


def _set_mtime(path: Path, mtime: datetime) -> None:
    """Force the directory's mtime to `mtime` (UTC) for orphan-grace tests."""
    ts = mtime.timestamp()
    os.utime(path, (ts, ts))


def _job_dirs(data_dir: Path) -> set[str]:
    """Set of `job_id` names that still exist somewhere under data_dir."""
    out: set[str] = set()
    for sub in ("inputs", "outputs", "extra-inputs"):
        p = data_dir / sub
        if not p.is_dir():
            continue
        for entry in p.iterdir():
            if entry.is_dir():
                out.add(entry.name)
    return out


# ---------------------------------------------------------------------------
# Rules: finished jobs (done / failed)
# ---------------------------------------------------------------------------


def test_cleanup_removes_done_job_older_than_ttl(data_dir: Path) -> None:
    finished = _NOW - timedelta(hours=25)  # older than JOB_TTL_SECONDS (24h)
    _seed_job("01OLD_DONE", JobStatus.DONE, finished_at=finished)
    _make_job_dir(data_dir / "inputs", "01OLD_DONE")
    _make_job_dir(data_dir / "outputs", "01OLD_DONE")

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 2
    assert "01OLD_DONE" not in _job_dirs(data_dir)


def test_cleanup_removes_failed_job_older_than_ttl(data_dir: Path) -> None:
    finished = _NOW - timedelta(hours=25)
    _seed_job("01OLD_FAIL", JobStatus.FAILED, finished_at=finished)
    _make_job_dir(data_dir / "inputs", "01OLD_FAIL")

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 1
    assert "01OLD_FAIL" not in _job_dirs(data_dir)


def test_cleanup_keeps_done_job_younger_than_ttl(data_dir: Path) -> None:
    finished = _NOW - timedelta(hours=1)  # well under TTL
    _seed_job("01FRESH", JobStatus.DONE, finished_at=finished)
    _make_job_dir(data_dir / "inputs", "01FRESH")

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 0
    assert "01FRESH" in _job_dirs(data_dir)


def test_cleanup_uses_created_at_when_finished_at_missing(
    data_dir: Path,
) -> None:
    """Legacy records written before `finished_at` existed must still age out."""
    created = _NOW - timedelta(hours=25)  # older than TTL
    _seed_job("01LEGACY", JobStatus.DONE, created_at=created, finished_at=None)
    _make_job_dir(data_dir / "inputs", "01LEGACY")

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 1


# ---------------------------------------------------------------------------
# Rules: active jobs (never removed)
# ---------------------------------------------------------------------------


def test_cleanup_keeps_queued_job_even_if_old(data_dir: Path) -> None:
    """A `queued` job whose disk is aged must survive — the user may
    still be polling its status."""
    created = _NOW - timedelta(days=2)
    _seed_job("01QUEUED", JobStatus.QUEUED, created_at=created)
    _make_job_dir(data_dir / "inputs", "01QUEUED")

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 0
    assert "01QUEUED" in _job_dirs(data_dir)


def test_cleanup_keeps_processing_job_even_if_old(data_dir: Path) -> None:
    created = _NOW - timedelta(days=2)
    _seed_job("01PROC", JobStatus.PROCESSING, created_at=created)
    _make_job_dir(data_dir / "inputs", "01PROC")

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 0
    assert "01PROC" in _job_dirs(data_dir)


# ---------------------------------------------------------------------------
# Rules: orphan directories (no Redis key)
# ---------------------------------------------------------------------------


def test_cleanup_removes_orphan_older_than_grace(data_dir: Path) -> None:
    # No Redis key for this one — it's truly orphan.
    old_mtime = _NOW - timedelta(hours=2)  # older than cleanup_grace (1h)
    d = _make_job_dir(data_dir / "inputs", "01ORPHAN_OLD")
    _set_mtime(d, old_mtime)

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 1
    assert "01ORPHAN_OLD" not in _job_dirs(data_dir)


def test_cleanup_keeps_orphan_younger_than_grace(data_dir: Path) -> None:
    """An upload that just finished writing to disk but hasn't enqueued
    yet must not be reaped."""
    fresh_mtime = _NOW - timedelta(seconds=30)  # under grace (1h)
    d = _make_job_dir(data_dir / "inputs", "01ORPHAN_FRESH")
    _set_mtime(d, fresh_mtime)

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 0
    assert "01ORPHAN_FRESH" in _job_dirs(data_dir)


# ---------------------------------------------------------------------------
# Report contents
# ---------------------------------------------------------------------------


def test_cleanup_reports_bytes_freed(data_dir: Path) -> None:
    finished = _NOW - timedelta(hours=25)
    _seed_job("01BIG", JobStatus.DONE, finished_at=finished)
    # 1234 bytes of "real" content
    _make_job_dir(data_dir / "inputs", "01BIG", size_bytes=1234)
    _make_job_dir(data_dir / "outputs", "01BIG", size_bytes=4096)

    report = cleanup.cleanup_once(now=_NOW)

    assert report.dirs_removed == 2
    assert report.bytes_freed == 1234 + 4096


def test_cleanup_idle_when_nothing_to_do(data_dir: Path) -> None:
    report = cleanup.cleanup_once(now=_NOW)
    assert report.dirs_removed == 0
    assert report.bytes_freed == 0
    assert report.errors == []
    assert report.duration_ms >= 0


# ---------------------------------------------------------------------------
# Robustness
# ---------------------------------------------------------------------------


def test_cleanup_continues_after_per_directory_error(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failing rmtree on one job must not abort the whole pass."""
    finished = _NOW - timedelta(hours=25)
    _seed_job("01A", JobStatus.DONE, finished_at=finished)
    _seed_job("01B", JobStatus.DONE, finished_at=finished)
    _make_job_dir(data_dir / "inputs", "01A")
    _make_job_dir(data_dir / "inputs", "01B")

    real_rmtree = cleanup._safe_rmtree

    def flaky_rmtree(path: Path) -> tuple[int, str | None]:
        if path.name == "01A":
            return 0, "simulated permission denied"
        return real_rmtree(path)

    monkeypatch.setattr(cleanup, "_safe_rmtree", flaky_rmtree)

    report = cleanup.cleanup_once(now=_NOW)

    # 01A failed and was reported; 01B still got removed.
    assert report.dirs_removed == 1
    assert any(p.endswith("01A") for p, _ in report.errors)
    assert "01B" not in _job_dirs(data_dir)


def test_cleanup_rejects_base_dir_outside_data_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Defense in depth: the base-dir `inputs_dir` resolves outside `data_dir`.

    In production this can't happen — `inputs_dir = data_dir / "inputs"` —
    but if a future change ever makes it configurable, `_is_inside` must
    catch it. We drive `_is_inside` directly via a stub that exposes the
    same `data_dir` and `inputs_dir` attributes the cleanup code reads.
    """
    from types import SimpleNamespace

    data_root = tmp_path / "data"
    foreign = tmp_path / "elsewhere" / "inputs"
    foreign.mkdir(parents=True)

    stub = SimpleNamespace(data_dir=data_root, inputs_dir=foreign)

    # `_is_inside` is the gate; assert it returns False for foreign base.
    assert cleanup._is_inside(foreign, data_root) is False

    # And the converse: a real inputs/ under data_dir passes.
    real_inputs = data_root / "inputs"
    real_inputs.mkdir(parents=True)
    assert cleanup._is_inside(real_inputs, data_root) is True


def test_cleanup_rejects_job_dir_outside_data_root(
    data_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Defense in depth at the per-job level too: a job dir that resolves
    outside data_dir is logged and skipped, never deleted."""
    # Make a symlink inside inputs/ that points outside data_dir.
    target = tmp_path / "outside"
    target.mkdir()
    (target / "secret.txt").write_bytes(b"keep me")

    inputs = data_dir / "inputs"
    link = inputs / "01LINK"
    link.symlink_to(target)

    report = cleanup.cleanup_once(now=_NOW)

    # Target untouched, error surfaced.
    assert (target / "secret.txt").is_file()
    assert any(p.endswith("01LINK") for p, _ in report.errors)
    # Symlink itself still present (we don't remove it).
    assert link.is_symlink()