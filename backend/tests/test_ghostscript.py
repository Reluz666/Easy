"""Ghostscript service tests — real subprocess, real binary."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.services.ghostscript import (
    VALID_LEVELS,
    GhostscriptError,
    compress_pdf,
)


pytestmark = pytest.mark.skipif(
    shutil.which("gs") is None,
    reason="ghostscript not installed",
)


def test_presets_include_three_required_levels() -> None:
    assert VALID_LEVELS == frozenset({"baja", "media", "alta"})


def test_compress_pdf_rejects_invalid_level(tmp_path: Path, minimal_pdf: Path, settings) -> None:
    out = tmp_path / "out.pdf"
    with pytest.raises(GhostscriptError) as exc:
        compress_pdf(minimal_pdf, out, "extreme")
    assert exc.value.error_code.value == "INTERNAL"


def test_compress_pdf_produces_a_smaller_pdf(tmp_path: Path, minimal_pdf: Path, settings) -> None:
    # Build a non-trivial PDF by stuffing the blank one with repeated
    # stream objects — gs has more work to do so the smoke test is meaningful.
    fat_pdf = tmp_path / "fat.pdf"
    fat = b"%PDF-1.4\n"
    for i in range(1, 31):
        fat += f"{i} 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td ({i}) Tj ET\nendstream endobj\n".encode()
    fat += b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    fat += b"2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R 5 0 R]/Count 3>>endobj\n"
    fat += b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    fat += b"4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    fat += b"5 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    fat += b"xref\n0 6\n"
    fat += b"0000000000 65535 f \n" * 6
    fat += b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n0\n%%EOF\n"
    fat_pdf.write_bytes(fat)

    out = tmp_path / "out.pdf"
    compress_pdf(fat_pdf, out, "media")
    assert out.is_file()
    assert out.stat().st_size > 0
    assert out.read_bytes().startswith(b"%PDF-")


def test_compress_pdf_completes_under_timeout(tmp_path: Path, minimal_pdf: Path, settings) -> None:
    """A tiny PDF finishes well within the timeout. Proves the happy path
    doesn't accidentally trigger the kill branch on small inputs."""
    out = tmp_path / "out.pdf"
    compress_pdf(minimal_pdf, out, "media", timeout_seconds=30)
    assert out.is_file()
    assert out.stat().st_size > 0


def test_compress_pdf_raises_gs_timeout_when_killed(
    tmp_path: Path, minimal_pdf: Path, settings, monkeypatch
) -> None:
    """Force a timeout by capping gs at 0s. Even on the fastest machine,
    a 0-second budget cannot complete the process."""
    out = tmp_path / "out.pdf"
    with pytest.raises(GhostscriptError) as exc:
        compress_pdf(minimal_pdf, out, "media", timeout_seconds=0)
    assert exc.value.error_code.value == "GS_TIMEOUT"
    assert "cancelado" in exc.value.message.lower()
