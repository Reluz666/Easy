"""Periodic cleanup loop.

Run with:

    python -m app.worker.cleanup_entrypoint

The loop calls `cleanup_once()` from `app.services.cleanup` and sleeps
`settings.cleanup_interval_seconds` between runs. We don't use RQ or a
scheduled task: cleanup is a background process, not work dispatched
to a queue, and a simple loop with `time.sleep` is the smallest
correct implementation.

Failure handling:
- One bad run must not kill the container. We catch every exception,
  log it, and continue to the next iteration.
- On SIGTERM / SIGINT we exit cleanly. (Container shutdown will
  send SIGTERM by default.)
"""
from __future__ import annotations

import signal
import sys
import time

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.services.cleanup import cleanup_once

_stop_requested = False


def _request_stop(_signum, _frame) -> None:
    global _stop_requested
    _stop_requested = True


def main() -> int:
    settings = get_settings()
    configure_logging()
    log = get_logger("cleanup.loop")

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    interval = settings.cleanup_interval_seconds
    log.info(
        "cleanup.loop.start",
        interval_seconds=interval,
        job_ttl_seconds=settings.job_ttl_seconds,
        cleanup_grace_seconds=settings.cleanup_grace_seconds,
        inputs_dir=str(settings.inputs_dir),
        outputs_dir=str(settings.outputs_dir),
        extra_inputs_dir=str(settings.extra_inputs_dir),
    )

    while not _stop_requested:
        try:
            report = cleanup_once()
            if report.dirs_removed == 0 and not report.errors:
                # Quiet pass — log at debug so an idle worker doesn't
                # spam the journal, but still visible in DEBUG mode.
                log.debug("cleanup.loop.idle", duration_ms=report.duration_ms)
        except Exception as exc:
            # We deliberately do NOT re-raise. The next iteration
            # might succeed; killing the container would only delay
            # the recovery.
            log.error("cleanup.loop.failed", error=str(exc), exc_info=True)
        # Sleep in short slices so SIGTERM is honored within ~1 s.
        slept = 0.0
        while slept < interval and not _stop_requested:
            tick = min(1.0, interval - slept)
            time.sleep(tick)
            slept += tick

    log.info("cleanup.loop.stop")
    return 0


if __name__ == "__main__":
    sys.exit(main())
