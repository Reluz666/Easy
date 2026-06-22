"""OCRmyPDF service tests — real subprocess, real binary where it matters."""
from __future__ import annotations

import shutil
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.services.ocr import (
    OCRmyPDFError,
    VALID_LANGS,
    ocr_pdf,
)


pytestmark = pytest.mark.skipif(
    shutil.which("ocrmypdf") is None,
    reason="ocrmypdf not installed",
)


def test_valid_langs_include_spa_eng() -> None:
    assert {"spa+eng", "spa", "eng"}.issubset(VALID_LANGS)
    # Anything outside the published set must be rejected.
    assert "fra" not in VALID_LANGS
    assert "" not in VALID_LANGS


def test_ocr_pdf_rejects_invalid_lang(tmp_path: Path, minimal_pdf: Path, settings) -> None:
    out = tmp_path / "out.pdf"
    with pytest.raises(OCRmyPDFError) as exc:
        ocr_pdf(minimal_pdf, out, lang="fra")
    assert exc.value.error_code.value == "OCR_FAILED"
    assert "idioma" in exc.value.message.lower() or "soportado" in exc.value.message.lower()


def test_ocr_pdf_rejects_missing_input(tmp_path: Path, settings) -> None:
    out = tmp_path / "out.pdf"
    missing = tmp_path / "does-not-exist.pdf"
    with pytest.raises(OCRmyPDFError) as exc:
        ocr_pdf(missing, out, lang="spa+eng")
    assert exc.value.error_code.value == "FILE_CORRUPT"


def test_ocr_pdf_runs_against_minimal_pdf(
    tmp_path: Path, minimal_pdf: Path, settings
) -> None:
    """Smoke: real ocrmypdf on the minimal fixture. Real ocrmypdf against
    a 1-page blank PDF has nothing to OCR, so the result may legitimately
    be a near-copy of the input. We only assert it ran cleanly and produced
    a non-empty PDF."""
    out = tmp_path / "out.pdf"
    ocr_pdf(minimal_pdf, out, lang="eng", timeout_seconds=60)
    assert out.is_file()
    assert out.stat().st_size > 0
    assert out.read_bytes().startswith(b"%PDF-")


def test_ocr_pdf_raises_timeout_when_killed(
    tmp_path: Path, minimal_pdf: Path, settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A 0-second budget kills the process group (ocrmypdf + tesseract
    children) via SIGTERM->SIGKILL. Verifies the killpg recipe works
    end-to-end on a real subprocess."""
    out = tmp_path / "out.pdf"
    with pytest.raises(OCRmyPDFError) as exc:
        ocr_pdf(minimal_pdf, out, lang="eng", timeout_seconds=0)
    assert exc.value.error_code.value == "OCR_TIMEOUT"
    assert "cancelado" in exc.value.message.lower() or "timeout" in exc.value.message.lower()


def test_ocr_pdf_raises_failed_when_output_is_empty(
    tmp_path: Path, minimal_pdf: Path, settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If ocrmypdf exits 0 but doesn't write output (or writes 0 bytes),
    the post-check raises OCR_FAILED. We mock Popen to simulate this
    without depending on a particular ocrmypdf version's behaviour."""

    @contextmanager
    def fake_popen(*args, **kwargs):
        class _FakeProc:
            pid = 12345
            returncode = 0

            def communicate(self, timeout=None):
                return (b"", b"")

            def wait(self, timeout=None):
                return 0

            def kill(self) -> None:
                pass

        yield _FakeProc()

    monkeypatch.setattr("app.services.ocr.subprocess.Popen", fake_popen)

    out = tmp_path / "out.pdf"
    with pytest.raises(OCRmyPDFError) as exc:
        ocr_pdf(minimal_pdf, out, lang="spa+eng", timeout_seconds=10)
    assert exc.value.error_code.value == "OCR_FAILED"
    assert "no produjo" in exc.value.message.lower()
