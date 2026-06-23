"""Tests for the per-IP rate limiter + active-job cap.

The limiter (`app.core.rate_limit.limiter`) is exercised two ways:

1. **Direct unit tests** against the `limiter` instance. These don't
   go through the API and don't need a TestClient; they verify the
   Redis-backed primitives (INCR, EXPIRE, SADD, SREM, zombie prune)
   in isolation.

2. **Route tests** via `TestClient`. These verify the dep wiring,
   header propagation, the "no quota on bad upload" rule, and the
   interaction between `enforce_rate_limit` and the
   `validate_pdf_upload` / `validate_pages_payload` pre-deps.

All tests run against `TEST_REDIS_URL` (DB 15) and rely on the
autouse `_clean_redis` fixture in `conftest.py` to start with an
empty keyspace.
"""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.main import app
from app.schemas.job import JobInfo, JobOperation, JobStatus
from app.services import job_store


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def tiny_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tight limits so we can hit them in <1 s of test wall time.

    2 per minute / 3 per hour / 2 active is enough to exercise the
    allow/block/active paths without burning seconds in `time.sleep`.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_jobs_per_minute", 2)
    monkeypatch.setattr(settings, "rate_limit_jobs_per_hour", 3)
    monkeypatch.setattr(settings, "rate_limit_max_active_jobs_per_ip", 2)


@pytest.fixture()
def tiny_active_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """A wide per-minute/hour budget but a small active-jobs cap.

    Use this when the test cares specifically about the active cap
    rather than the per-window rate limit. Without separating them,
    a test that fills the active set to 2 will also fill the
    per-minute bucket to 2 — and the next request gets blocked by
    the per-minute check, not the active one.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_jobs_per_minute", 100)
    monkeypatch.setattr(settings, "rate_limit_jobs_per_hour", 1000)
    monkeypatch.setattr(settings, "rate_limit_max_active_jobs_per_ip", 2)


# ---------------------------------------------------------------------------
# Direct limiter tests
# ---------------------------------------------------------------------------


def test_check_increments_minute_counter(redis_url: str) -> None:
    decision1 = limiter.check("10.0.0.1")
    decision2 = limiter.check("10.0.0.1")
    assert decision1.allowed
    # Default per-minute limit is 5. After 1 call, remaining = 5 - 1 = 4.
    assert decision1.remaining == 4
    # The second call brings the count to 2; remaining reflects that.
    assert decision2.allowed
    assert decision2.remaining == 3


def test_check_blocks_at_minute_limit(tiny_limits) -> None:
    """Two requests under the cap, third returns 429."""
    assert limiter.check("10.0.0.2").allowed
    assert limiter.check("10.0.0.2").allowed
    decision = limiter.check("10.0.0.2")
    assert not decision.allowed
    assert decision.error_code == "RATE_LIMITED"
    assert decision.retry_after == 60


def test_check_blocks_at_hour_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_jobs_per_minute", 100)
    monkeypatch.setattr(settings, "rate_limit_jobs_per_hour", 2)
    assert limiter.check("10.0.0.3").allowed
    assert limiter.check("10.0.0.3").allowed
    decision = limiter.check("10.0.0.3")
    assert not decision.allowed
    assert decision.error_code == "RATE_LIMITED"
    assert decision.retry_after == 3600


def test_independent_ips_have_independent_buckets(tiny_limits) -> None:
    """Exhausting IP A's bucket doesn't affect IP B."""
    assert limiter.check("10.0.0.4").allowed
    assert limiter.check("10.0.0.4").allowed
    assert not limiter.check("10.0.0.4").allowed
    # IP B is untouched.
    assert limiter.check("10.0.0.5").allowed
    assert limiter.check("10.0.0.5").allowed
    assert not limiter.check("10.0.0.5").allowed


def test_record_active_adds_to_set_with_ttl(
    redis_url: str, data_dir, settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """After SADD, the SET has TTL ~= job_ttl_seconds + 3600."""
    limiter.record_active("10.0.0.6", "01AAA")
    import redis as redis_lib

    r = redis_lib.Redis.from_url(redis_url, decode_responses=True)
    ttl = r.ttl("ip_jobs:10.0.0.6")
    expected = settings.job_ttl_seconds + 3600
    assert expected - 5 <= ttl <= expected


def test_count_active_prunes_zombie_entries(
    redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If `job:{id}` is gone, the SET member is SREM-ed and the key
    is DEL-ed when the set becomes empty."""
    import redis as redis_lib

    r = redis_lib.Redis.from_url(redis_url, decode_responses=True)
    # Seed: SET has two members, neither has a `job:` key.
    r.sadd("ip_jobs:10.0.0.7", "01ZOMB1", "01ZOMB2")
    assert limiter.count_active("10.0.0.7") == 0
    # Both were zombies, so the SET itself is gone.
    assert not r.exists("ip_jobs:10.0.0.7")


def test_count_active_counts_only_live_jobs(
    redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If one member has a live `job:{id}` and one is a zombie,
    only the live one counts (and the zombie is pruned)."""
    import redis as redis_lib

    r = redis_lib.Redis.from_url(redis_url, decode_responses=True)
    # Live job: write `job:01LIVE`
    info = JobInfo(
        id="01LIVE",
        op=JobOperation.COMPRESS,
        status=JobStatus.QUEUED,
        params={},
        input_path="/tmp/01LIVE/input.pdf",
        input_bytes=0,
        created_at=datetime.now(timezone.utc),
        client_ip="10.0.0.8",
    )
    job_store.save_job(info)
    r.sadd("ip_jobs:10.0.0.8", "01LIVE", "01ZOMB")
    assert limiter.count_active("10.0.0.8") == 1
    # The zombie was reaped; the live one remains.
    assert r.smembers("ip_jobs:10.0.0.8") == {"01LIVE"}


def test_release_active_drops_member_and_clears_empty_set(redis_url: str) -> None:
    import redis as redis_lib

    r = redis_lib.Redis.from_url(redis_url, decode_responses=True)
    limiter.record_active("10.0.0.9", "01AAA")
    limiter.release_active("10.0.0.9", "01AAA")
    assert not r.exists("ip_jobs:10.0.0.9")


def test_update_status_terminal_releases_active(
    redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The worker's `update_status(DONE)` should SREM the IP set
    without anyone calling `release_active` explicitly — that's the
    contract `job_store.update_status` enforces when `client_ip` is set."""
    import redis as redis_lib

    r = redis_lib.Redis.from_url(redis_url, decode_responses=True)
    info = JobInfo(
        id="01DONE",
        op=JobOperation.COMPRESS,
        status=JobStatus.QUEUED,
        params={},
        input_path="/tmp/01DONE/input.pdf",
        input_bytes=0,
        created_at=datetime.now(timezone.utc),
        client_ip="10.0.0.10",
    )
    job_store.save_job(info)
    r.sadd("ip_jobs:10.0.0.10", "01DONE")
    # Worker marks the job done.
    job_store.update_status("01DONE", JobStatus.DONE)
    assert r.smembers("ip_jobs:10.0.0.10") == set()
    # And the SET is DEL-ed because it's empty.
    assert not r.exists("ip_jobs:10.0.0.10")


# ---------------------------------------------------------------------------
# Route tests
# ---------------------------------------------------------------------------


def test_route_responds_with_rate_limit_headers(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, minimal_pdf_bytes: bytes
) -> None:
    """A successful POST carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`."""
    with patch("app.api.jobs.get_queue"):
        resp = client.post(
            "/api/jobs/compress",
            files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert resp.status_code == 202
    assert "X-RateLimit-Limit" in resp.headers
    assert "X-RateLimit-Remaining" in resp.headers


def test_rate_limit_disabled_skips_dependency(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, minimal_pdf_bytes: bytes
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    with patch("app.api.jobs.get_queue"):
        # 10 requests in a row would normally trip the 5/min cap.
        for _ in range(10):
            resp = client.post(
                "/api/jobs/compress",
                files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            )
            assert resp.status_code == 202
        # No rate-limit headers either — the dep didn't run.
        assert "X-RateLimit-Limit" not in resp.headers


def test_blocked_request_returns_429_with_retry_after(
    client: TestClient, tiny_limits, minimal_pdf_bytes: bytes
) -> None:
    with patch("app.api.jobs.get_queue"):
        # Burn the budget.
        for _ in range(2):
            ok = client.post(
                "/api/jobs/compress",
                files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            )
            assert ok.status_code == 202
        # 3rd request hits the 2/min cap.
        blocked = client.post(
            "/api/jobs/compress",
            files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert blocked.status_code == 429
    body = blocked.json()["detail"]
    assert body["errorCode"] == "RATE_LIMITED"
    assert "demasiadas solicitudes" in body["message"]
    assert blocked.headers["Retry-After"] == "60"
    assert blocked.headers["X-RateLimit-Limit"] == "2"
    assert blocked.headers["X-RateLimit-Remaining"] == "0"


def test_invalid_pdf_does_not_consume_quota(
    client: TestClient, tiny_limits, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A 400 (bad magic bytes) is rejected BEFORE the rate-limit dep,
    so the bucket stays at zero and we can still upload 2 valid PDFs
    afterwards (which would be the limit)."""
    # 1) Bad upload — must NOT increment any counter.
    bad = client.post(
        "/api/jobs/compress",
        files={"file": ("x.pdf", io.BytesIO(b"not a pdf"), "application/pdf")},
    )
    assert bad.status_code == 400

    # 2) Two valid uploads should succeed within the 2/min budget.
    with patch("app.api.jobs.get_queue"):
        for _ in range(2):
            resp = client.post(
                "/api/jobs/compress",
                files={"file": ("x.pdf", io.BytesIO(_valid_pdf()), "application/pdf")},
            )
            assert resp.status_code == 202
        # 3) 3rd valid upload is blocked because the budget is exhausted
        # by the 2 valid ones — NOT by the bad upload.
        blocked = client.post(
            "/api/jobs/compress",
            files={"file": ("x.pdf", io.BytesIO(_valid_pdf()), "application/pdf")},
        )
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["errorCode"] == "RATE_LIMITED"


def test_invalid_pages_ops_does_not_consume_quota(
    client: TestClient, tiny_limits, minimal_pdf_bytes: bytes
) -> None:
    """Same protection for the pages route: a bad `ops` JSON must
    not burn quota."""
    bad = client.post(
        "/api/jobs/pages",
        files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": "not json at all"},
    )
    assert bad.status_code == 400
    # And the two subsequent good requests still fit in the 2/min bucket.
    ops_json = json.dumps([{"op": "delete", "pages": [1]}])
    with patch("app.api.jobs.get_queue"):
        for _ in range(2):
            resp = client.post(
                "/api/jobs/pages",
                files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
                data={"ops": ops_json},
            )
            assert resp.status_code == 202
    blocked = client.post(
        "/api/jobs/pages",
        files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        data={"ops": ops_json},
    )
    assert blocked.status_code == 429


def test_too_many_active_jobs_returns_specific_code(
    client: TestClient, tiny_active_only, minimal_pdf_bytes: bytes
) -> None:
    """Once an IP has 2 active jobs, the 3rd upload hits the active cap
    and returns `TOO_MANY_ACTIVE_JOBS` (not the per-minute one)."""
    with patch("app.api.jobs.get_queue"):
        # First two uploads succeed; we DON'T inline-run, so the jobs
        # stay in `queued` state (active).
        for _ in range(2):
            r = client.post(
                "/api/jobs/compress",
                files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            )
            assert r.status_code == 202
        # 3rd hits the active cap.
        blocked = client.post(
            "/api/jobs/compress",
            files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
        )
    assert blocked.status_code == 429
    body = blocked.json()["detail"]
    assert body["errorCode"] == "TOO_MANY_ACTIVE_JOBS"
    assert "demasiados archivos" in body["message"]
    assert blocked.headers["Retry-After"] == "30"


def test_health_endpoint_not_rate_limited(
    client: TestClient, tiny_limits
) -> None:
    """`/health` doesn't depend on `enforce_rate_limit`, so even 50
    hits in a row return 200 and never carry `X-RateLimit-*` headers."""
    for _ in range(50):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert "X-RateLimit-Limit" not in resp.headers


def test_get_status_endpoint_not_rate_limited(
    client: TestClient, tiny_limits
) -> None:
    """`GET /api/jobs/{id}` doesn't depend on `enforce_rate_limit`."""
    for _ in range(20):
        resp = client.get("/api/jobs/01MISSING")
        assert resp.status_code == 404
        assert "X-RateLimit-Limit" not in resp.headers


def test_xff_not_trusted_by_default(
    client: TestClient, tiny_limits, minimal_pdf_bytes: bytes
) -> None:
    """Without `TRUST_PROXY_HEADERS`, `X-Forwarded-For` is ignored and
    the real client IP is used. All requests come from `testclient`
    (same IP), so they all share a bucket."""
    headers = {"X-Forwarded-For": "9.9.9.9"}
    with patch("app.api.jobs.get_queue"):
        for _ in range(2):
            r = client.post(
                "/api/jobs/compress",
                files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
                headers=headers,
            )
            assert r.status_code == 202
        # The 3rd is blocked because the real client IP's bucket is full.
        blocked = client.post(
            "/api/jobs/compress",
            files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            headers=headers,
        )
    assert blocked.status_code == 429


def test_xff_trusted_when_enabled(
    client: TestClient, tiny_limits, monkeypatch: pytest.MonkeyPatch, minimal_pdf_bytes: bytes
) -> None:
    """With `TRUST_PROXY_HEADERS=true`, the leftmost XFF entry is the
    rate-limit key. Different XFFs get different buckets."""
    settings = get_settings()
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    with patch("app.api.jobs.get_queue"):
        # Two from 9.9.9.9 — uses that IP's bucket.
        for _ in range(2):
            r = client.post(
                "/api/jobs/compress",
                files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
                headers={"X-Forwarded-For": "9.9.9.9"},
            )
            assert r.status_code == 202
        # 3rd from 9.9.9.9 — blocked.
        blocked = client.post(
            "/api/jobs/compress",
            files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            headers={"X-Forwarded-For": "9.9.9.9"},
        )
        assert blocked.status_code == 429
        # 1st from 8.8.8.8 — independent bucket, succeeds.
        other = client.post(
            "/api/jobs/compress",
            files={"file": ("t.pdf", io.BytesIO(minimal_pdf_bytes), "application/pdf")},
            headers={"X-Forwarded-For": "8.8.8.8"},
        )
    assert other.status_code == 202


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _valid_pdf() -> bytes:
    """A minimal valid 1-page PDF (same shape `conftest.minimal_pdf_bytes` uses)."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000009 00000 n \n0000000053 00000 n \n0000000100 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n167\n%%EOF\n"
    )
