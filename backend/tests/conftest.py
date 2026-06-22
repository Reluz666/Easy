"""Shared test fixtures.

We hit a real Redis (separate DB) and a real gs binary — the whole point
of these tests is that the wiring works. We avoid mocking at this layer
because Hito 1's bug surface is precisely the boundary between Python
and the subprocess / the queue.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest
import redis as redis_lib


@pytest.fixture(scope="session")
def redis_url() -> str:
    """Use a separate DB index so we never collide with the dev stack."""
    return os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")


@pytest.fixture(autouse=True)
def _clean_redis(redis_url: str) -> None:
    """Wipe DB 15 before every test."""
    r = redis_lib.Redis.from_url(redis_url, decode_responses=True)
    r.flushdb()
    yield
    r.flushdb()


@pytest.fixture()
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point DATA_DIR at a tmp dir so tests don't touch real /data."""
    d = tmp_path / "data"
    (d / "inputs").mkdir(parents=True)
    (d / "outputs").mkdir(parents=True)
    monkeypatch.setenv("DATA_DIR", str(d))
    # Settings is cached; reset it.
    from app.core import config as cfg
    cfg.get_settings.cache_clear()
    yield d
    cfg.get_settings.cache_clear()
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture()
def settings(data_dir: Path):
    from app.core.config import get_settings
    return get_settings()


@pytest.fixture()
def minimal_pdf_bytes() -> bytes:
    """A real (tiny) PDF: 1 page, blank, valid header + EOF + xref."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000009 00000 n \n0000000053 00000 n \n0000000100 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n167\n%%EOF\n"
    )


@pytest.fixture()
def minimal_pdf(tmp_path: Path, minimal_pdf_bytes: bytes) -> Path:
    p = tmp_path / "test.pdf"
    p.write_bytes(minimal_pdf_bytes)
    return p
