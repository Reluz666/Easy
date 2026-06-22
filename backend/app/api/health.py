"""Health endpoint: confirms Redis + every external tool is callable.

This runs subprocess probes (gs --version, etc.) so it's *not* cheap — keep
it on a less frequent schedule from your orchestrator (every 30s is fine).
"""
from __future__ import annotations

import shutil
import subprocess
from importlib import metadata as importlib_metadata

import fitz  # PyMuPDF
import pikepdf
import redis
from fastapi import APIRouter, Response, status

from app.core.config import get_settings
from app.core.queue import get_redis
from app.schemas.job import HealthDependency, HealthResponse

router = APIRouter()


def _probe_binary(name: str, args: list[str], version_arg: str = "--version") -> HealthDependency:
    path = shutil.which(name)
    if path is None:
        return HealthDependency(name=name, available=False, detail="binary not found")
    try:
        proc = subprocess.run(
            [path, version_arg],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        return HealthDependency(name=name, available=False, detail=str(exc))
    version_line = (proc.stdout or proc.stderr or "").strip().splitlines()
    version = version_line[0] if version_line else None
    return HealthDependency(
        name=name,
        available=proc.returncode == 0,
        version=version,
        detail=None if proc.returncode == 0 else (proc.stderr or "").strip()[:200] or None,
    )


def _probe_python_lib(name: str, import_name: str) -> HealthDependency:
    try:
        version = importlib_metadata.version(import_name)
        __import__(import_name)
        return HealthDependency(name=name, available=True, version=version)
    except Exception as exc:
        return HealthDependency(name=name, available=False, detail=str(exc))


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()

    redis_ok = True
    try:
        get_redis().ping()
    except redis.RedisError:
        redis_ok = False

    deps: list[HealthDependency] = [
        _probe_binary("gs", [], "--version"),
        _probe_binary("ocrmypdf", [], "--version"),
        _probe_binary("tesseract", [], "--version"),
        _probe_binary("qpdf", [], "--version"),
        _probe_python_lib("PyMuPDF", "pymupdf"),
        _probe_python_lib("pikepdf", "pikepdf"),
    ]

    # `fitz` is a runtime sanity check beyond just the import — it makes sure
    # the native binding actually loaded (wheel compatibility, musl vs glibc).
    if deps[4].available:
        try:
            _ = fitz.__version__
        except Exception as exc:  # pragma: no cover - defensive
            deps[4] = HealthDependency(name="PyMuPDF", available=False, detail=str(exc))

    ok = redis_ok and all(d.available for d in deps)
    return HealthResponse(ok=ok, redis=redis_ok, dependencies=deps)


@router.get("/health/live", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def liveness() -> Response:
    """Cheap liveness probe: process is up. Does NOT touch Redis or subprocesses."""
    return Response(status_code=status.HTTP_204_NO_CONTENT)
