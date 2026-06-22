"""RQ worker entrypoint.

This module is the command target for every worker container:

    rq worker --url $REDIS_URL --name $WORKER_NAME <queue1> <queue2> ...

For Hito 0 the queues are empty (no tasks registered yet). The workers boot,
register on Redis, and idle. Subsequent milestones add the actual task
functions to `app.tasks.*` and import them here so RQ knows how to call them.
"""
from __future__ import annotations

import os
import sys

from rq import Worker
from rq.serializers import resolve_serializer

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger


def main() -> int:
    settings = get_settings()
    configure_logging()
    log = get_logger("worker.boot")

    queues_env = os.environ.get("WORKER_QUEUES", "")
    queues = [q.strip() for q in queues_env.split(",") if q.strip()]
    if not queues:
        log.error("worker.no_queues", hint="Set WORKER_QUEUES=compress,ocr,...")
        return 2

    redis_conn = __import__("redis").Redis.from_url(settings.redis_url)
    worker_name = os.environ.get("WORKER_NAME", f"worker-{os.getpid()}")
    burst = os.environ.get("WORKER_BURST", "0") == "1"

    worker = Worker(
        queues=[__import__("rq").Queue(q, connection=redis_conn) for q in queues],
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
