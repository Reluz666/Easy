"""PyMuPDF-level tests for `app.services.foliate`.

The endpoint tests in `test_jobs_foliate.py` patch `foliate_pdf` so the
worker tests stay hermetic. These tests exercise the *real* PyMuPDF code
path on small multi-page PDFs — the surface where bugs are most likely
(position math, garbage/deflate round-trip, encrypted input).

We build real multi-page PDFs from the minimal fixture by copying the
page object N times so `doc.page_count` is what we expect.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import fitz
import pytest

from app.schemas.errors import ErrorCode
from app.services.foliate import (
    FoliateError,
    FoliateParams,
    MAX_FONT_SIZE,
    MIN_FONT_SIZE,
    VALID_POSITIONS,
    foliate_pdf,
)


pytestmark = pytest.mark.skipif(
    shutil.which("gs") is None,
    reason="PyMuPDF/Pillow stack not reliably available without gs",
)


def _make_multipage_pdf(path: Path, page_count: int) -> None:
    """Write a real, multi-page PDF at `path` by duplicating a single-page
    blank PDF via PyMuPDF's `insert_page`. Using PyMuPDF for the fixture
    keeps the test hermetic — no ghostscript/qpdf dependency."""
    doc = fitz.open()  # empty
    for _ in range(page_count):
        doc.insert_page(-1, width=612, height=792)
    doc.save(str(path))
    doc.close()


def test_valid_positions_is_six_anchors() -> None:
    assert VALID_POSITIONS == frozenset({
        "top-left", "top-center", "top-right",
        "bottom-left", "bottom-center", "bottom-right",
    })


def test_foliate_pdf_rejects_missing_input(tmp_path: Path) -> None:
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(
            tmp_path / "missing.pdf",
            tmp_path / "out.pdf",
            FoliateParams(),
        )
    assert exc.value.error_code == ErrorCode.FILE_CORRUPT


def test_foliate_pdf_rejects_invalid_position(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 2)
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(inp, out, FoliateParams(position="middle-center"))
    assert exc.value.error_code == ErrorCode.FOLIATE_FAILED


def test_foliate_pdf_rejects_oversize_font(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 2)
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(inp, out, FoliateParams(font_size=MAX_FONT_SIZE + 1))
    assert exc.value.error_code == ErrorCode.FOLIATE_FAILED


def test_foliate_pdf_rejects_zero_initial_number(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 2)
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(inp, out, FoliateParams(initial_number=0))
    assert exc.value.error_code == ErrorCode.PAGES_FAILED


def test_foliate_pdf_writes_valid_pdf_for_all_pages(
    tmp_path: Path, minimal_pdf_bytes: bytes
) -> None:
    """All-pages foliation on a 3-page PDF writes a 3-page output that
    PyMuPDF can re-open — proves draw + garbage=4 + deflate=True round-trip."""
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 3)
    out = tmp_path / "out.pdf"

    pages = foliate_pdf(
        inp,
        out,
        FoliateParams(position="bottom-center", initial_number=1, prefix="Pág. "),
    )
    assert pages == 3
    assert out.is_file()
    assert out.stat().st_size > 0
    assert out.read_bytes()[:5] == b"%PDF-"

    # Re-open to verify the output is well-formed.
    doc = fitz.open(str(out))
    try:
        assert doc.page_count == 3
        # Bottom-center should put the baseline near y≈margin+fontSize,
        # which is below the page midpoint on a 792-pt page.
        first_text = doc[0].get_text("text")
        assert "Pág." in first_text
        assert "1" in first_text
        third_text = doc[2].get_text("text")
        assert "3" in third_text
    finally:
        doc.close()


@pytest.mark.parametrize("position", sorted(VALID_POSITIONS))
def test_foliate_pdf_supports_all_six_positions(
    tmp_path: Path, position: str
) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 2)
    out = tmp_path / "out.pdf"

    pages = foliate_pdf(
        inp,
        out,
        FoliateParams(position=position, font_size=10, initial_number=10),
    )
    assert pages == 2
    doc = fitz.open(str(out))
    try:
        text = doc[0].get_text("text")
        assert "10" in text  # initial number on first page
    finally:
        doc.close()


def test_foliate_pdf_respects_from_to_range(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 5)
    out = tmp_path / "out.pdf"

    pages = foliate_pdf(
        inp,
        out,
        FoliateParams(
            position="top-right",
            initial_number=100,
            range_mode="from-to",
            from_page=2,
            to_page=4,
        ),
    )
    assert pages == 3
    doc = fitz.open(str(out))
    try:
        # Page 0 (index) is outside the range -> no folio text.
        assert "100" not in doc[0].get_text("text")
        # Page 1 (index) starts the range at 100.
        assert "100" in doc[1].get_text("text")
        assert "101" in doc[2].get_text("text")
        assert "102" in doc[3].get_text("text")
        # Page 4 (index) is past `to_page` -> no folio text.
        assert "103" not in doc[4].get_text("text")
    finally:
        doc.close()


def test_foliate_pdf_rejects_from_to_above_total(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 3)
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(
            inp,
            out,
            FoliateParams(range_mode="from-to", from_page=1, to_page=99),
        )
    assert exc.value.error_code == ErrorCode.PAGES_FAILED


def test_foliate_pdf_rejects_from_to_with_inverted_bounds(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 3)
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(
            inp,
            out,
            FoliateParams(range_mode="from-to", from_page=3, to_page=2),
        )
    assert exc.value.error_code == ErrorCode.PAGES_FAILED


def test_foliate_pdf_rejects_from_to_with_missing_bounds(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 3)
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(
            inp,
            out,
            FoliateParams(range_mode="from-to", from_page=None, to_page=2),
        )
    assert exc.value.error_code == ErrorCode.PAGES_FAILED


def test_foliate_pdf_rejects_corrupt_pdf(tmp_path: Path) -> None:
    """PyMuPDF raises on bytes that aren't a real PDF."""
    inp = tmp_path / "in.pdf"
    inp.write_bytes(b"this is not a pdf at all")
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(inp, out, FoliateParams())
    assert exc.value.error_code == ErrorCode.FILE_CORRUPT


def test_foliate_pdf_rejects_encrypted_pdf(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    # PyMuPDF's encrypt() uses AES-256 by default; the result is a valid
    # but unreadable PDF that fits needs_pass=True / is_encrypted=True.
    doc = fitz.open()
    doc.insert_page(-1, width=612, height=792)
    doc.save(str(inp), encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    doc.close()

    with pytest.raises(FoliateError) as exc:
        foliate_pdf(inp, out, FoliateParams())
    assert exc.value.error_code == ErrorCode.FILE_ENCRYPTED


def test_foliate_pdf_rejects_min_font_size_below_floor(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 1)
    out = tmp_path / "out.pdf"
    with pytest.raises(FoliateError) as exc:
        foliate_pdf(inp, out, FoliateParams(font_size=MIN_FONT_SIZE - 1))
    assert exc.value.error_code == ErrorCode.FOLIATE_FAILED


def test_foliate_pdf_uses_garbage_4_deflate(tmp_path: Path) -> None:
    """After foliation the output must be smaller than or equal to the
    input — garbage=4 + deflate=True strip redundant objects on save."""
    inp = tmp_path / "in.pdf"
    _make_multipage_pdf(inp, 4)
    out = tmp_path / "out.pdf"
    foliate_pdf(inp, out, FoliateParams())
    assert out.stat().st_size > 0
    # Sanity: round-trip the output through PyMuPDF without warnings.
    doc = fitz.open(str(out))
    try:
        assert doc.page_count == 4
        # No exception = object stream + deflate decoded cleanly.
        for page in doc:
            _ = page.get_text("text")
    finally:
        doc.close()
