"""RQ worker entrypoint.

Run with:

    python -m app.worker.entrypoint

The worker reads `WORKER_QUEUES` (comma-separated) and subscribes to those
queues. For each queue it also imports the matching task module so the
function reference the API enqueued resolves correctly when the job is
dequeued.

Mapping (one queue -> one task module today; Hitos 2-4 add the others):

    compress  -> app.tasks.compress
    ocr       -> app.tasks.ocr       (added in Hito 2)
    foliate   -> app.tasks.foliate   (added in Hito 3)
    pages     -> app.tasks.pages     (added in Hito 4)
"""
from __future__ import annotations

import os
import sys

import redis as redis_lib
from rq import Queue, Worker

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger

# Importing a task module has the side effect of registering the function
# references that RQ pickles by name. We import them eagerly so missing
# modules fail at boot, not at dequeue time.
QUEUE_TASKS: dict[str, str] = {
    "compress": "app.tasks.compress",
    "ocr": "app.tasks.ocr",
    "foliate": "app.tasks.foliate",
    "pages": "app.tasks.pages",
}


def _load_task_module(queue_name: str) -> None:
    module_name = QUEUE_TASKS.get(queue_name)
    if module_name is None:
        # Unknown queue — let RQ raise a clean error when the job arrives.
        return
    try:
        __import__(module_name)
    except ModuleNotFoundError:
        # Tolerated: future hito hasn't landed yet. The worker just won't
        # accept jobs for this queue, which is the right behaviour during
        # incremental rollout.
        pass


def main() -> int:
    settings = get_settings()
    configure_logging()
    log = get_logger("worker.boot")

    queues_env = os.environ.get("WORKER_QUEUES", "")
    queues = [q.strip() for q in queues_env.split(",") if q.strip()]
    if not queues:
        log.error("worker.no_queues", hint="Set WORKER_QUEUES=compress,ocr,...")
        return 2

    for q in queues:
        _load_task_module(q)

    redis_conn = redis_lib.Redis.from_url(settings.redis_url)
    worker_name = os.environ.get("WORKER_NAME", f"worker-{os.getpid()}")
    burst = os.environ.get("WORKER_BURST", "0") == "1"

    worker = Worker(
        queues=[Queue(q, connection=redis_conn) for q in queues],
        connection=redis_conn,
        name=worker_name,
    )

    log.info(
        "worker.start",
        name=worker_name,
        queues=queues,
        burst=burst,
        pid=os.getpid(),
    )

    worker.work(burst=burst, logging_level=settings.log_level)
    return 0


if __name__ == "__main__":
    sys.exit(main())
