"""Shared FastAPI dependencies.

`get_client_ip` and `enforce_rate_limit` are reused by the 4
`POST /api/jobs/*` routes. They live here (and not next to the
routes) because they're cross-cutting and a future endpoint may
want to apply the same treatment.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.rate_limit import RateLimitDecision, limiter
from app.schemas.errors import ErrorCode, message_for

log = get_logger("api.deps")


# ---------------------------------------------------------------------------
# Client IP
# ---------------------------------------------------------------------------


def get_client_ip(request: Request) -> str:
    """Return the client's IP for rate-limit and audit purposes.

    Default: `request.client.host` — the address of whoever opened
    the TCP connection. This is what you want when the API is
    exposed directly (no proxy in front), because the value cannot
    be spoofed by the client.

    If `TRUST_PROXY_HEADERS=true` is set, we additionally honor
    `X-Forwarded-For` and use the leftmost entry (the original
    client per RFC 7239 conventions, modulo the proxy chain you
    trust). The deployer MUST be behind a reverse proxy that
    strips and re-injects this header — otherwise an attacker can
    rotate IPs at will and bypass the rate limiter.
    """
    settings = get_settings()
    if settings.trust_proxy_headers:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            # XFF is a comma-separated list: `client, proxy1, proxy2`.
            # The leftmost is the original client.
            first = xff.split(",", 1)[0].strip()
            if first:
                return first
    # `request.client` is None for ASGI transports that don't carry
    # a peer (e.g. in-process unit tests with a synthetic scope).
    # Fall back to a constant so the rate limit can still key on it.
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


# ---------------------------------------------------------------------------
# Rate limit
# ---------------------------------------------------------------------------


def _raise_rate_limited(decision: RateLimitDecision) -> None:
    """Surface a 429 with the standard `Retry-After` + `X-RateLimit-*` headers.

    We use `JSONResponse` directly (raising `HTTPException` doesn't
    carry custom headers in older FastAPI/Starlette versions). The
    body shape matches the rest of the API: `{"errorCode", "message"}`
    nested under `detail`, so the frontend's existing error renderer
    surfaces the Spanish message without changes.
    """
    body = {
        "detail": {
            "errorCode": decision.error_code,
            "message": message_for(ErrorCode(decision.error_code)),
        }
    }
    headers = {
        "Retry-After": str(decision.retry_after),
        "X-RateLimit-Limit": str(decision.limit),
        "X-RateLimit-Remaining": "0",
    }
    # FastAPI turns a returned `JSONResponse` into the actual HTTP
    # response when raised from a dependency. Headers are preserved.
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=body["detail"],
        headers=headers,
    )


def enforce_rate_limit(
    request: Request,
    ip: str = Depends(get_client_ip),
) -> str:
    """FastAPI dependency that consumes one rate-limit slot for `ip`.

    Returns the client IP on success so the route handler can pass
    it to `job_store.create_job` without re-extracting.

    Order of operations inside this dependency:

    1. If `RATE_LIMIT_ENABLED` is off, return early with just the IP.
    2. `limiter.check(ip)` — increment the minute + hour counters
       and reject if either is exhausted.
    3. `limiter.check_active(ip)` — reject if the IP is already at
       the active-jobs cap. This is a pure read; the SADD happens
       later, in the handler, once we have a real `job_id`.

    The successful decision is stashed in `request.state` so a
    middleware (`attach_rate_limit_headers` in `app.main`) can copy
    the values into the response headers. The 429 path attaches the
    same headers (and `Retry-After`) via `HTTPException(headers=...)`.

    The quota is consumed by THIS call, not by the handler. The
    "don't burn quota on a bad upload" rule is enforced by putting
    file validation in EARLIER dependencies (e.g. `SavedUpload =
    Depends(save_pdf_upload_dep)` declared before this one). See
    `app.api.jobs` for the wiring.
    """
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return ip

    decision = limiter.check(ip)
    if not decision.allowed:
        log.warning(
            "rate_limit.denied",
            ip=ip,
            error_code=decision.error_code,
            path=request.url.path,
        )
        _raise_rate_limited(decision)
    request.state.rate_limit_decision = decision

    active_decision = limiter.check_active(ip)
    if not active_decision.allowed:
        log.warning(
            "rate_limit.denied",
            ip=ip,
            error_code=active_decision.error_code,
            path=request.url.path,
        )
        _raise_rate_limited(active_decision)
    return ip
