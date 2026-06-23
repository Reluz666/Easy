"""Centralised settings loaded from environment variables.

Why pydantic-settings:
- Type-checked values at boot (a typo in MAX_UPLOAD_BYTES fails fast, not silently).
- Reads `.env` automatically for local dev (no dotenv import dance).
- One source of truth for the API and the worker — both import `get_settings()`.
"""
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Redis / RQ -------------------------------------------------------
    redis_url: str = Field(default="redis://localhost:6379/0")

    # --- Storage ----------------------------------------------------------
    # Shared between api and workers via the `job-data` docker volume.
    data_dir: Path = Field(default=Path("/data"))

    # --- Upload limits ----------------------------------------------------
    # 100 MB hard cap. Browser compression of bigger PDFs is impractical
    # anyway; raise only after profiling disk + memory.
    max_upload_bytes: int = Field(default=100 * 1024 * 1024)

    # --- Tool timeouts (seconds) -----------------------------------------
    # Worst case: 100 MB scanned PDF at /printer on slow CPUs can take ~5 min.
    gs_timeout_seconds: int = Field(default=300)
    ocr_timeout_seconds: int = Field(default=900)
    foliate_timeout_seconds: int = Field(default=60)
    pages_timeout_seconds: int = Field(default=60)

    # --- Job TTL ----------------------------------------------------------
    # How long Redis keeps job state + output file before cleanup.
    job_ttl_seconds: int = Field(default=24 * 60 * 60)

    # --- Cleanup worker ---------------------------------------------------
    # How often the cleanup worker scans `/data/inputs`, `/data/outputs`, and
    # `/data/extra-inputs` for aged-out jobs and orphans. Lower = more
    # frequent disk scans; higher = longer window where aged jobs linger.
    cleanup_interval_seconds: int = Field(default=300)

    # Grace period before a directory with no matching Redis key is removed.
    # Long enough to cover an upload that just finished writing to disk but
    # hasn't enqueued the task yet; short enough to actually clean mistakes.
    cleanup_grace_seconds: int = Field(default=60 * 60)

    # --- Rate limiting ----------------------------------------------------
    # Per-IP fixed-window limits on the 4 `POST /api/jobs/*` endpoints.
    # The limit is consumed only AFTER upload validation passes, so a bad
    # PDF / oversize / missing field never counts against the bucket.
    rate_limit_enabled: bool = Field(default=True)
    rate_limit_jobs_per_minute: int = Field(default=5)
    rate_limit_jobs_per_hour: int = Field(default=30)
    rate_limit_max_active_jobs_per_ip: int = Field(default=3)

    # Trust the `X-Forwarded-For` header. ONLY enable this when the API
    # sits behind a known reverse proxy that strips client-supplied XFF
    # and re-injects the real client IP. Leaving this off means we use
    # `request.client.host` directly, which an attacker cannot spoof.
    trust_proxy_headers: bool = Field(default=False)

    # --- Logging ----------------------------------------------------------
    log_level: str = Field(default="INFO")

    # --- Computed paths ---------------------------------------------------
    @property
    def inputs_dir(self) -> Path:
        return self.data_dir / "inputs"

    @property
    def outputs_dir(self) -> Path:
        return self.data_dir / "outputs"

    @property
    def extra_inputs_dir(self) -> Path:
        # Files uploaded as "secondary" inputs (e.g. the extra PDF for the
        # page-editing insert op) live here so they share the job-data
        # volume with the main input/output but don't collide with it.
        return self.data_dir / "extra-inputs"

    @property
    def work_dir(self) -> Path:
        return self.data_dir / "work"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
