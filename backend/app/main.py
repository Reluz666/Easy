"""FastAPI application factory.

Run locally:
    uvicorn app.main:app --reload --port 8000

In Docker the command lives in docker-compose.yml.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

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


def create_app() -> FastAPI:
    app = FastAPI(
        title="Easy PDF API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(health_router, tags=["health"])
    app.include_router(jobs_router, tags=["jobs"])
    return app


app = create_app()
