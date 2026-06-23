"""Redis-backed rate limiter + per-IP active-job tracking.

Why Redis and not in-process state:
- The API can scale horizontally. An in-memory counter on instance A
  misses requests hitting instance B. Redis is the only state the
  instances already share, so the limit is correct cluster-wide.

Two independent protections, both per IP:

1. **Fixed-window counters** for `POST /api/jobs/*`:
   - `rl:jobs:{ip}:m` — counter for the current minute, `EXPIRE 60 s`.
   - `rl:jobs:{ip}:h` — counter for the current hour, `EXPIRE 3600 s`.
   The counter is incremented AFTER upload validation passes (size,
   magic bytes, required fields) so a bad request never burns quota.
   Fixed window is good enough for "stop a script from saturating
   us" — a determined attacker can 2× the per-minute limit at the
   window boundary, but the per-hour ceiling still holds.

2. **Active-job cap** to keep one IP from queuing N parallel jobs:
   - `ip_jobs:{ip}` — a SET of `job_id`s the IP currently has
     in `queued` / `processing`. SADD on enqueue, SREM on terminal
     status. We also SREM zombies whose `job:{id}` key has expired.
   - The SET has a TTL of `job_ttl_seconds + 3600` refreshed on every
     SADD — it can't grow without bound: if a worker dies between
     mark-done and SREM, the SET entry is reaped at most one TTL after
     the job was created, and `count_active` skips entries whose
     `job:{id}` key is gone.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.queue import get_redis

log = get_logger("rate_limit")

# Key templates. The IP slot is sanitized by the caller (see
# `app.api.deps.get_client_ip`); we don't allow user input past that.
_KEY_RL_MIN: Final = "rl:jobs:{ip}:m"
_KEY_RL_HOUR: Final = "rl:jobs:{ip}:h"
_KEY_ACTIVE: Final = "ip_jobs:{ip}"

# The SET TTL is the job TTL plus a one-hour safety margin. A worker
# that crashes between writing `done` and SREM-ing will still be reaped
# by `count_active` (which filters on `EXISTS job:{id}`), but if the
# `job:{id}` key expires before the next request, the SET entry is
# stranded until this TTL fires. The +3600s margin is enough for a
# client polling their status and a worker draining the queue.
_ACTIVE_SET_TTL_BUFFER: Final = 60 * 60


@dataclass(frozen=True)
class RateLimitDecision:
    """Outcome of a `check()` call.

    The route handler uses `allowed` to short-circuit. When denied, the
    response carries the matching `error_code` and `retry_after`
    seconds.
    """

    allowed: bool
    error_code: str | None = None
    """`RATE_LIMITED` or `TOO_MANY_ACTIVE_JOBS` when not allowed."""
    retry_after: int = 0
    """Seconds the client should wait before retrying (for `Retry-After`)."""
    limit: int = 0
    """The relevant limit value (for `X-RateLimit-Limit`)."""
    remaining: int = 0
    """Remaining requests in the relevant window (for `X-RateLimit-Remaining`)."""


class RateLimiter:
    """All per-IP rate-limit + active-job state.

    Stateless beyond what lives in Redis. The instance methods are
    thin wrappers around a few Redis commands so tests can use the
    class directly and the API layer can just call `check()`.
    """

    # ----- Windowed rate limit ------------------------------------------

    def _key_min(self, ip: str) -> str:
        return _KEY_RL_MIN.format(ip=ip)

    def _key_hour(self, ip: str) -> str:
        return _KEY_RL_HOUR.format(ip=ip)

    def _key_active(self, ip: str) -> str:
        return _KEY_ACTIVE.format(ip=ip)

    def check(self, ip: str) -> RateLimitDecision:
        """Atomically increment the minute + hour counters and decide.

        Uses `INCR` so the check is race-free across API replicas. On
        the first increment of a window the key has no TTL, so we
        set it (also atomically: `INCR` is single-command atomic, and
        `EXPIRE` is best-effort — even if it fails, the worst case is
        a counter that never expires, which the next `FLUSHDB` or
        manual cleanup will handle).

        The counter is consumed at *this* call, before the route
        handler runs. This is intentional: the validation step (PDF
        magic, size, required fields) must run before we burn quota,
        and the route's own deps run in declared order. See
        `app.api.jobs` for how the deps are wired.
        """
        settings = get_settings()
        r = get_redis()
        minute = r.incr(self._key_min(ip))
        if minute == 1:
            r.expire(self._key_min(ip), 60)
        hour = r.incr(self._key_hour(ip))
        if hour == 1:
            r.expire(self._key_hour(ip), 3600)

        per_min = settings.rate_limit_jobs_per_minute
        per_hour = settings.rate_limit_jobs_per_hour

        if minute > per_min:
            return RateLimitDecision(
                allowed=False,
                error_code="RATE_LIMITED",
                retry_after=60,
                limit=per_min,
                remaining=0,
            )
        if hour > per_hour:
            return RateLimitDecision(
                allowed=False,
                error_code="RATE_LIMITED",
                retry_after=3600,
                limit=per_hour,
                remaining=0,
            )

        # Remaining in the most-binding window (per-minute is the
        # tighter one in practice). Surfaced as `X-RateLimit-Remaining`.
        remaining = max(0, min(per_min - minute, per_hour - hour))
        return RateLimitDecision(
            allowed=True,
            limit=per_min,
            remaining=remaining,
        )

    # ----- Active jobs --------------------------------------------------

    def check_active(self, ip: str) -> RateLimitDecision:
        """Reject if `ip` is already at the active-jobs cap.

        Pure read — does NOT add a slot. The SADD happens later, in
        `record_active`, once the handler has a real `job_id` to
        associate. This split lets the dependency check the cap
        before any state is mutated, and the handler refresh the
        SADD TTL only after `create_job` succeeds.
        """
        settings = get_settings()
        active = self.count_active(ip)
        cap = settings.rate_limit_max_active_jobs_per_ip
        if active >= cap:
            return RateLimitDecision(
                allowed=False,
                error_code="TOO_MANY_ACTIVE_JOBS",
                retry_after=30,
                limit=cap,
                remaining=0,
            )
        return RateLimitDecision(
            allowed=True,
            limit=cap,
            remaining=max(0, cap - active),
        )

    def record_active(self, ip: str, job_id: str) -> None:
        """Track that `ip` now has `job_id` queued / processing.

        Idempotent on duplicate calls: SADD returns 0 if the member
        already exists, and we still refresh the SET TTL. The TTL is
        `job_ttl_seconds + 3600` — generous enough to outlive a
        normal job even if the worker never SREMs (e.g. crash
        between `update_status` writing `done` and the SREM call).
        """
        settings = get_settings()
        r = get_redis()
        r.sadd(self._key_active(ip), job_id)
        r.expire(self._key_active(ip), settings.job_ttl_seconds + _ACTIVE_SET_TTL_BUFFER)

    def release_active(self, ip: str, job_id: str) -> None:
        """Drop a job from the active set.

        Called by:
        - `job_store.update_status` on terminal transitions (done / failed).
        - The API route handler when the RQ enqueue itself fails, so a
          job that never reached a worker doesn't burn a slot.
        """
        r = get_redis()
        r.srem(self._key_active(ip), job_id)
        # If the set is now empty, free the key — `ip_jobs:{ip}` must
        # not linger in Redis after a client finishes their session.
        if r.exists(self._key_active(ip)) == 0:
            r.delete(self._key_active(ip))

    def count_active(self, ip: str) -> int:
        """How many active jobs `ip` has, after pruning zombies.

        A zombie is a SET member whose `job:{id}` key has already
        expired (e.g. cleanup worker reaped the job but the SREM
        didn't fire, or a worker died mid-flight). We `EXISTS` each
        member and SREM the dead ones. With small caps (3-5) the
        per-call cost is trivial.
        """
        r = get_redis()
        members = r.smembers(self._key_active(ip))
        if not members:
            return 0
        alive = 0
        dead: list[str] = []
        for m in members:
            job_id = m.decode() if isinstance(m, bytes) else str(m)
            if r.exists(f"job:{job_id}"):
                alive += 1
            else:
                dead.append(job_id)
        if dead:
            r.srem(self._key_active(ip), *dead)
            if r.exists(self._key_active(ip)) == 0:
                r.delete(self._key_active(ip))
        return alive


# Module-level singleton — `app.api.deps` calls these directly.
limiter = RateLimiter()
