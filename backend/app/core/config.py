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
    gs_timeout_seconds: int = Field(default=120)
    ocr_timeout_seconds: int = Field(default=900)
    foliate_timeout_seconds: int = Field(default=60)
    pages_timeout_seconds: int = Field(default=60)

    # --- Job TTL ----------------------------------------------------------
    # How long Redis keeps job state + output file before cleanup.
    job_ttl_seconds: int = Field(default=24 * 60 * 60)

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
    def work_dir(self) -> Path:
        return self.data_dir / "work"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
