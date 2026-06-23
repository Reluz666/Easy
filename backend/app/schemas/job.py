"""Pydantic models for the public API surface."""
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class JobOperation(str, Enum):
    COMPRESS = "compress"
    OCR = "ocr"
    FOLIATE = "foliate"
    PAGES = "pages"


class JobInfo(BaseModel):
    """Snapshot of a job's state, returned by GET /api/jobs/{id}."""

    id: str
    op: JobOperation
    status: JobStatus
    progress: int = Field(default=0, ge=0, le=100)
    params: dict
    input_path: str
    output_path: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    input_bytes: int | None = None
    output_bytes: int | None = None
    reduction_pct: float | None = None
    duration_ms: int | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    # IP that submitted the job. Used by the rate limiter to count
    # active jobs per source. Optional for backward compatibility with
    # jobs persisted before the rate-limit feature shipped.
    client_ip: str | None = None


class JobCreatedResponse(BaseModel):
    """Returned by POST /api/jobs/*."""

    jobId: str
    status: Literal["queued"] = "queued"


class HealthDependency(BaseModel):
    name: str
    available: bool
    version: str | None = None
    detail: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    redis: bool
    dependencies: list[HealthDependency]
