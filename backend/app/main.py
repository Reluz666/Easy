"""FastAPI application factory.

Run locally:
    uvicorn app.main:app --reload --port 8000

In Docker the command lives in docker-compose.yml.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    log = get_logger("app.startup")
    # Ensure data subdirs exist before any worker tries to write.
    for sub in (settings.inputs_dir, settings.outputs_dir, settings.work_dir):
        sub.mkdir(parents=True, exist_ok=True)
    log.info(
        "app.startup",
        data_dir=str(settings.data_dir),
        max_upload_bytes=settings.max_upload_bytes,
        gs_timeout_seconds=settings.gs_timeout_seconds,
    )
    yield
    log.info("app.shutdown")


async def attach_rate_limit_headers(request: Request, call_next):
    """Promote `request.state.rate_limit_decision` into response headers.

    FastAPI's `Response` injection is only available in route
    handlers, not in dependencies, so the `enforce_rate_limit` dep
    can't set the headers itself. It stashes the decision on
    `request.state` and we copy `limit` / `remaining` into the
    outgoing response here. The 429 path already carries the same
    headers via `HTTPException(headers=...)`, so we leave those
    alone (we just skip overriding them).
    """
    response = await call_next(request)
    decision = getattr(request.state, "rate_limit_decision", None)
    if decision is not None and "X-RateLimit-Limit" not in response.headers:
        response.headers["X-RateLimit-Limit"] = str(decision.limit)
        response.headers["X-RateLimit-Remaining"] = str(decision.remaining)
    return response


def create_app() -> FastAPI:
    app = FastAPI(
        title="Easy PDF API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.middleware("http")(attach_rate_limit_headers)
    app.include_router(health_router, tags=["health"])
    app.include_router(jobs_router, tags=["jobs"])
    return app


app = create_app()
