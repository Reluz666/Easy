"""Redis + RQ singletons.

We expose:
- `get_redis()`: the raw connection (used by the API for state reads).
- `get_queue(name)`: a named RQ queue (used by the API to enqueue jobs).

Workers use `app.worker.entrypoint` directly; they don't need these helpers.
"""
from functools import lru_cache

import redis
from rq import Queue

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_redis() -> redis.Redis:
    settings = get_settings()
    return redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
        health_check_interval=30,
    )


@lru_cache(maxsize=4)
def get_queue(name: str) -> Queue:
    return Queue(name, connection=get_redis())
