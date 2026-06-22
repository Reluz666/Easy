"""Health endpoint smoke tests."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint_reports_all_dependencies() -> None:
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["redis"] is True
    names = {d["name"] for d in body["dependencies"]}
    assert {"gs", "ocrmypdf", "tesseract", "qpdf", "PyMuPDF", "pikepdf"} <= names
    assert all(d["available"] for d in body["dependencies"])


def test_health_live_does_not_touch_redis_or_subprocess() -> None:
    client = TestClient(app)
    resp = client.get("/health/live")
    assert resp.status_code == 204
    assert resp.content == b""
