"""Periodic garbage collector for `/data/inputs`, `/data/outputs`, and
`/data/extra-inputs`.

Why a service and not a CRON script:
- Single source of truth for "what counts as expired" — both the loop
  worker and the `--once` CLI call the same `cleanup_once()` function.
- Easy to unit-test: every branch (active vs. finished vs. orphan,
  fresh vs. aged) is reachable without Docker.
- Pure function (no I/O on RQ or the worker process) so we can run it
  from tests, the CLI, or the periodic loop interchangeably.

What it removes:
- Directories under inputs/ outputs/ extra-inputs/ whose `job_id` is
  *not* in Redis as `queued` or `processing` AND
  - either has a `job:{id}` entry in `done`/`failed` whose
    `finished_at` (or `created_at` as a fallback) is older than
    `JOB_TTL_SECONDS`, OR
  - has no `job:{id}` entry at all (the "orphan" case) and the
    directory's mtime is older than `CLEANUP_GRACE_SECONDS`.

What it never removes:
- Active jobs (`queued` / `processing`), regardless of disk age.
- Anything outside `data_dir` — defense in depth against a symlink
  attack that points a job_id at `/etc` or similar.
"""
from __future__ import annotations

import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.cleanup import CleanupReport
from app.schemas.job import JobStatus
from app.services import job_store

log = get_logger("cleanup")

# Sentinel mtime for directories whose stat fails. We treat them as
# "infinitely old" so they get a chance to be cleaned up on the next
# pass after a transient stat error.
_EPOCH = datetime.fromtimestamp(0, tz=timezone.utc)


def _is_inside(child: Path, parent: Path) -> bool:
    """True iff `child` resolves to a path under `parent`.

    Uses `resolve()` to defeat symlink-based escapes. We use this for
    defense in depth even though we already constrain the base dirs
    via `settings.data_dir`.
    """
    try:
        child_resolved = child.resolve()
        parent_resolved = parent.resolve()
    except (OSError, ValueError):
        return False
    try:
        child_resolved.relative_to(parent_resolved)
        return True
    except ValueError:
        return False


def _dir_size(path: Path) -> int:
    """Recursive byte count of `path`. Returns 0 if the dir is empty or
    has been concurrently removed."""
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                # File vanished mid-walk; that's fine — we just don't
                # count it toward bytes_freed.
                pass
    return total


def _dir_mtime_utc(path: Path) -> datetime:
    """Mtime of `path` as a UTC datetime. Returns the epoch on
    `OSError` so the directory is treated as "infinitely old" and
    surfaced for cleanup on the next pass."""
    try:
        ts = path.stat().st_mtime
    except OSError:
        return _EPOCH
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def _safe_rmtree(path: Path) -> tuple[int, str | None]:
    """Remove `path` and all its contents. Returns `(bytes_freed, error)`.

    On success, `error` is None. On failure, `bytes_freed` is 0 and
    `error` is a short reason string. We never raise — the caller wants
    to keep cleaning other directories even if one fails.
    """
    try:
        size = _dir_size(path)
        shutil.rmtree(path)
        return size, None
    except FileNotFoundError:
        # Race: someone else removed it between the scan and now.
        return 0, None
    except PermissionError as exc:
        return 0, f"permission denied: {exc.strerror or exc}"
    except OSError as exc:
        return 0, f"os error: {exc.strerror or exc}"


def _should_remove(
    *,
    status: JobStatus | None,
    finished_at: datetime | None,
    created_at: datetime | None,
    dir_mtime: datetime,
    now: datetime,
    finished_cutoff: datetime,
    orphan_cutoff: datetime,
) -> bool:
    """Decide whether a single job_dir is removable.

    Rules (any one is sufficient):
    - `status` is `QUEUED` or `PROCESSING` → never remove.
    - `status` is `DONE` or `FAILED` AND
      (`finished_at` or `created_at`) <= `finished_cutoff` → remove.
    - `status` is `None` (no Redis key) AND `dir_mtime` <= `orphan_cutoff` → remove.
    - Otherwise → keep.
    """
    if status in (JobStatus.QUEUED, JobStatus.PROCESSING):
        return False
    if status in (JobStatus.DONE, JobStatus.FAILED):
        # Use `finished_at` (set on terminal transitions) and fall back
        # to `created_at` if the job was created before this code path
        # existed and never had `finished_at` written.
        reference = finished_at or created_at
        if reference is None:
            # Malformed job record with no timestamps — be conservative
            # and skip. It'll either get a `finished_at` on the next
            # status update or expire via Redis TTL on its own.
            return False
        return reference <= finished_cutoff
    # status is None (no Redis key) or some unknown status.
    return dir_mtime <= orphan_cutoff


def cleanup_once(*, now: datetime | None = None) -> CleanupReport:
    """Scan the three job dirs and remove what the rules allow.

    `now` is injectable for tests. Production calls leave it None and
    get `datetime.now(timezone.utc)`.

    The function is intentionally tolerant: a per-directory failure
    (permission error, race) is captured into the report's `errors`
    list, and the loop continues. The whole pass only raises on a
    programmer error or a Redis outage — both of which the loop
    worker treats as a transient blip and logs.
    """
    settings = get_settings()
    now = now or datetime.now(timezone.utc)
    finished_cutoff = now.timestamp() - settings.job_ttl_seconds
    orphan_cutoff_ts = now.timestamp() - settings.cleanup_grace_seconds
    finished_cutoff_dt = datetime.fromtimestamp(finished_cutoff, tz=timezone.utc)
    orphan_cutoff_dt = datetime.fromtimestamp(orphan_cutoff_ts, tz=timezone.utc)

    started = time.perf_counter()
    report = CleanupReport()

    # Map job_id -> (status, finished_at, created_at). The cleanup rule
    # needs `finished_at` to compare against `finished_cutoff`, so we
    # pull the full JobInfo via iter_jobs_full().
    known: dict[str, tuple[JobStatus, datetime | None, datetime | None]] = {}
    for job_id, info in job_store.iter_jobs_full():
        known[job_id] = (info.status, info.finished_at, info.created_at)

    bases: list[Path] = [
        settings.inputs_dir,
        settings.outputs_dir,
        settings.extra_inputs_dir,
    ]
    data_root = settings.data_dir

    for base in bases:
        if not base.is_dir():
            continue
        if not _is_inside(base, data_root):
            # Defense in depth: the settings computation makes this
            # impossible, but a misconfigured env could leak paths in.
            # Skipping is safer than deleting the wrong tree.
            report.errors.append((str(base), "base dir outside data_dir"))
            continue
        for job_dir in base.iterdir():
            if not job_dir.is_dir():
                continue
            if not _is_inside(job_dir, data_root):
                report.errors.append((str(job_dir), "job dir outside data_dir"))
                continue
            job_id = job_dir.name
            status, finished_at, created_at = known.get(job_id, (None, None, None))
            if status in (JobStatus.QUEUED, JobStatus.PROCESSING):
                continue
            dir_mtime = _dir_mtime_utc(job_dir)
            removable = _should_remove(
                status=status,
                finished_at=finished_at,
                created_at=created_at,
                dir_mtime=dir_mtime,
                now=now,
                finished_cutoff=finished_cutoff_dt,
                orphan_cutoff=orphan_cutoff_dt,
            )
            if not removable:
                continue
            freed, err = _safe_rmtree(job_dir)
            if err is not None:
                report.errors.append((str(job_dir), err))
                continue
            report = CleanupReport(
                dirs_removed=report.dirs_removed + 1,
                bytes_freed=report.bytes_freed + freed,
                errors=report.errors,
                duration_ms=0,  # filled in at the end
            )

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    report = CleanupReport(
        dirs_removed=report.dirs_removed,
        bytes_freed=report.bytes_freed,
        errors=report.errors,
        duration_ms=elapsed_ms,
    )
    if report.dirs_removed > 0 or report.errors:
        log.info("cleanup.done", **report.to_dict())
    return report
