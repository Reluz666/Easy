"""Schema for the cleanup worker.

The worker doesn't need a Pydantic model — a frozen dataclass with
int fields is enough — but we keep it under `schemas/` so the report
shape is discoverable and serialisable for tests and the CLI.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CleanupReport:
    """Summary of a single `cleanup_once()` pass.

    Fields are designed to map 1:1 onto the structured log the worker
    emits (`cleanup.done`). All counters are non-negative.
    """

    dirs_removed: int = 0
    bytes_freed: int = 0
    """Sum of bytes reclaimed across all removed directories."""

    errors: list[tuple[str, str]] = field(default_factory=list)
    """`[(path, reason), ...]` for per-directory errors that did not abort
    the run. The cleanup is best-effort: a single permission error on one
    job's directory must not stop the others."""

    duration_ms: int = 0
    """Wall-clock time the pass took. Useful for spotting latency
    regressions when the worker scans large trees."""

    def to_dict(self) -> dict:
        """Shape the report as a dict for the structured logger."""
        return {
            "dirs_removed": self.dirs_removed,
            "bytes_freed": self.bytes_freed,
            "errors": [{"path": p, "reason": r} for p, r in self.errors],
            "duration_ms": self.duration_ms,
        }
