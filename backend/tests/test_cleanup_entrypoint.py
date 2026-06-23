"""Tests for the cleanup worker's main loop.

The loop has two non-trivial behaviours we need to lock down:
  1. It sleeps `cleanup_interval_seconds` between runs.
  2. A failing `cleanup_once()` does not kill the loop.

Everything else (logging, signal handling) is observable in integration
tests rather than unit tests.
"""
from __future__ import annotations

import pytest

from app.worker import cleanup_entrypoint as entry


@pytest.fixture(autouse=True)
def _reset_stop_flag() -> None:
    """Module-level `_stop_requested` is mutated by the loop and the
    signal handler. Reset it around every test so they don't bleed."""
    entry._stop_requested = False
    yield
    entry._stop_requested = False


def test_loop_sleeps_interval_between_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two successful runs ⇒ cumulative sleep equals the configured interval."""
    runs = {"n": 0}

    def fake_cleanup_once() -> object:
        runs["n"] += 1
        # Stop after the second run so the test exits quickly.
        if runs["n"] >= 2:
            entry._stop_requested = True
        return _NoOpReport()

    sleeps: list[float] = []

    def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(entry, "cleanup_once", fake_cleanup_once)
    monkeypatch.setattr(entry.time, "sleep", fake_sleep)

    exit_code = entry.main()
    assert exit_code == 0
    assert runs["n"] == 2
    assert sleeps, "the loop must have slept at least once"
    # The loop slices the wait into ≤ 1 s ticks so SIGTERM is honored
    # within ~1 s. The total accumulated sleep between runs must equal
    # the configured interval.
    interval = entry.get_settings().cleanup_interval_seconds
    assert sum(sleeps) == pytest.approx(interval, abs=0.01)


def test_loop_continues_after_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """If `cleanup_once` raises, the loop logs the error and runs again."""
    runs = {"n": 0}

    def flaky_cleanup_once() -> object:
        runs["n"] += 1
        if runs["n"] == 1:
            raise RuntimeError("boom")
        # Stop after a successful follow-up.
        entry._stop_requested = True
        return _NoOpReport()

    def fake_sleep(_seconds: float) -> None:
        # No actual sleep — keep the test fast.
        return None

    monkeypatch.setattr(entry, "cleanup_once", flaky_cleanup_once)
    monkeypatch.setattr(entry.time, "sleep", fake_sleep)

    exit_code = entry.main()
    assert exit_code == 0
    assert runs["n"] == 2, "loop must have survived the first run's exception"


def test_loop_returns_after_stop_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    """After `_request_stop` is invoked, the loop returns on the next tick."""
    # Pre-arm the stop flag — the loop should observe it on its first check.
    entry._stop_requested = True

    called = {"n": 0}

    def fake_cleanup_once() -> object:
        called["n"] += 1
        return _NoOpReport()

    monkeypatch.setattr(entry, "cleanup_once", fake_cleanup_once)
    monkeypatch.setattr(entry.time, "sleep", lambda _s: None)

    exit_code = entry.main()
    assert exit_code == 0
    assert called["n"] == 0, "loop must exit before running when stop is pre-armed"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _NoOpReport:
    """Stand-in for `CleanupReport` — the loop only checks `dirs_removed` /
    `errors`, and only to decide whether to log at DEBUG or INFO. Tests
    patch `cleanup_once`, so they don't need a real report instance."""

    dirs_removed = 0
    errors: list = []
    duration_ms = 0