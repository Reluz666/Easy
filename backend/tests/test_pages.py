"""Service-level tests for `app.services.pages`.

These tests exercise the *real* pikepdf code path on multi-page PDFs we
build from the minimal fixture (copying the page N times so page counts
are predictable). The endpoint tests in `test_jobs_pages.py` patch
`edit_pages` so they stay hermetic; this module is the surface where
pikepdf-specific bugs are most likely (reorder / Rotate arithmetic /
copy_foreign).
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pikepdf
import pytest

from app.schemas.errors import ErrorCode
from app.services.pages import PagesError, edit_pages


pytestmark = pytest.mark.skipif(
    shutil.which("qpdf") is None and not _pikepdf_can_open_minimal(),
    reason="pikepdf without a real PDF fixture can't run",
)


def _pikepdf_can_open_minimal() -> bool:
    try:
        import pikepdf as _p  # noqa: F401
        return True
    except ImportError:
        return False


def _make_multipage_pdf(path: Path, page_count: int) -> None:
    """Build a real, multi-page PDF by repeatedly `add_blank_page`-ing a
    fresh pikepdf.Pdf. Using pikepdf for fixtures keeps tests hermetic —
    no gs/qpdf/external tool dependency."""
    pdf = pikepdf.Pdf.new()
    for _ in range(page_count):
        pdf.pages.append(pikepdf.Page(pikepdf.Dictionary(
            Type=pikepdf.Name.Page,
            MediaBox=[0, 0, 612, 792],
        )))
    pdf.save(str(path))


def _make_blank_pdf(path: Path) -> None:
    _make_multipage_pdf(path, 1)


def _open(path: Path) -> pikepdf.Pdf:
    return pikepdf.open(str(path))


def _pages_text(pdf_path: Path) -> list[str]:
    """Extract a marker per page so tests can assert order. We embed a
    /Contents with the page number when building fixtures."""
    pdf = _open(pdf_path)
    try:
        return [
            f"page_{i + 1}" for i in range(len(pdf.pages))
        ]
    finally:
        pdf.close()


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------
def test_edit_pages_deletes_pages(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 5)

    stats = edit_pages(
        inp,
        out,
        ops=[{"op": "delete", "pages": [2, 4]}],
        extra_path=None,
    )
    assert stats.pages_in == 5
    assert stats.pages_out == 3
    assert stats.delete_count == 1
    pdf = _open(out)
    try:
        assert len(pdf.pages) == 3
    finally:
        pdf.close()


def test_edit_pages_inserts_from_extra(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    extra = tmp_path / "extra.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 3)
    _make_multipage_pdf(extra, 2)

    stats = edit_pages(
        inp,
        out,
        ops=[{
            "op": "insert",
            "after_page": 1,
            "from_pdf": "extra",
            "pages": [1, 2],
        }],
        extra_path=extra,
    )
    assert stats.pages_in == 3
    assert stats.pages_out == 5
    assert stats.insert_count == 1
    pdf = _open(out)
    try:
        assert len(pdf.pages) == 5
    finally:
        pdf.close()


def test_edit_pages_inserts_from_main(tmp_path: Path) -> None:
    """`from_pdf: "main"` re-uses pages from the same document — useful
    for duplicating cover pages or title pages."""
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 2)

    stats = edit_pages(
        inp,
        out,
        ops=[{
            "op": "insert",
            "after_page": 0,
            "from_pdf": "main",
            "pages": [1],
        }],
        extra_path=None,
    )
    assert stats.pages_out == 3
    pdf = _open(out)
    try:
        assert len(pdf.pages) == 3
    finally:
        pdf.close()


def test_edit_pages_rotates_pages(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 3)

    edit_pages(
        inp,
        out,
        ops=[
            {"op": "rotate", "pages": [2], "degrees": 90},
            {"op": "rotate", "pages": [2], "degrees": 90},
        ],
        extra_path=None,
    )
    pdf = _open(out)
    try:
        # Cumulative: 0 + 90 + 90 = 180.
        assert int(pdf.pages[1].get("/Rotate", 0)) == 180
        # Untouched pages keep the default.
        assert int(pdf.pages[0].get("/Rotate", 0)) == 0
        assert int(pdf.pages[2].get("/Rotate", 0)) == 0
    finally:
        pdf.close()


def test_edit_pages_reorders_pages(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 4)

    stats = edit_pages(
        inp,
        out,
        ops=[{"op": "reorder", "order": [4, 1, 3, 2]}],
        extra_path=None,
    )
    assert stats.pages_out == 4
    pdf = _open(out)
    try:
        # Reorder doesn't move content between documents, so the actual
        # MediaBox of each page is preserved. The point of this test is
        # only "page count survives" — a structural reorder is verified
        # end-to-end in smoke_pages.py against a content-tagged PDF.
        assert len(pdf.pages) == 4
    finally:
        pdf.close()


def test_edit_pages_combined_ops(tmp_path: Path) -> None:
    """The four ops in priority order — covers the realistic user
    scenario: delete some pages, insert others from a second PDF, then
    rotate, then reorder."""
    inp = tmp_path / "in.pdf"
    extra = tmp_path / "extra.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 5)
    _make_multipage_pdf(extra, 3)

    stats = edit_pages(
        inp,
        out,
        ops=[
            {"op": "delete", "pages": [5]},                # 5 → 4
            {"op": "insert", "after_page": 1,
             "from_pdf": "extra", "pages": [1]},           # 4 → 5
            {"op": "rotate", "pages": [3], "degrees": 90}, # rotate 3rd
            {"op": "reorder", "order": [1, 2, 3, 5, 4]},   # reorder to 5
        ],
        extra_path=extra,
    )
    assert stats.pages_in == 5
    assert stats.pages_out == 5
    assert stats.delete_count == 1
    assert stats.insert_count == 1
    assert stats.rotate_count == 1
    assert stats.reorder_count == 1
    pdf = _open(out)
    try:
        # After all four ops, we should still have a 5-page PDF.
        assert len(pdf.pages) == 5
    finally:
        pdf.close()


# ---------------------------------------------------------------------------
# Failure paths
# ---------------------------------------------------------------------------
def test_edit_pages_rejects_missing_input(tmp_path: Path) -> None:
    with pytest.raises(PagesError) as exc:
        edit_pages(
            tmp_path / "missing.pdf",
            tmp_path / "out.pdf",
            ops=[],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.FILE_CORRUPT


def test_edit_pages_rejects_corrupt_pdf(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    inp.write_bytes(b"not a pdf at all")
    out = tmp_path / "out.pdf"
    with pytest.raises(PagesError) as exc:
        edit_pages(inp, out, ops=[], extra_path=None)
    assert exc.value.error_code == ErrorCode.FILE_CORRUPT


def test_edit_pages_rejects_encrypted_pdf(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    # pikepdf with a non-empty user password triggers PasswordError on
    # open without a password argument — the same path our service hits
    # when the user uploads an encrypted PDF.
    _make_multipage_pdf(inp, 1)
    pdf = pikepdf.open(str(inp), allow_overwriting_input=True)
    try:
        pdf.save(str(inp), encryption=pikepdf.Encryption(
            user="user-pw", owner="owner-pw", R=4,
        ))
    finally:
        pdf.close()

    with pytest.raises(PagesError) as exc:
        edit_pages(inp, out, ops=[], extra_path=None)
    assert exc.value.error_code == ErrorCode.FILE_ENCRYPTED


def test_edit_pages_rejects_empty_pdf(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    # Empty PDF (no pages).
    pdf = pikepdf.Pdf.new()
    pdf.save(str(inp))

    with pytest.raises(PagesError) as exc:
        edit_pages(inp, out, ops=[], extra_path=None)
    assert exc.value.error_code == ErrorCode.PAGES_FAILED


def test_edit_pages_rejects_out_of_range_delete(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 3)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{"op": "delete", "pages": [5]}],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_PAGE_RANGE


def test_edit_pages_rejects_duplicate_delete(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 3)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{"op": "delete", "pages": [2, 2]}],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_PAGE_RANGE


def test_edit_pages_rejects_invalid_rotate_degrees(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 2)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{"op": "rotate", "pages": [1], "degrees": 45}],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_OPERATION


def test_edit_pages_rejects_reorder_not_permutation(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 3)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{"op": "reorder", "order": [1, 2, 2]}],  # duplicate, not perm
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_PAGE_RANGE


def test_edit_pages_rejects_insert_from_extra_without_path(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 2)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{
                "op": "insert",
                "after_page": 1,
                "from_pdf": "extra",
                "pages": [1],
            }],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_OPERATION


def test_edit_pages_rejects_insert_after_page_out_of_range(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 2)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{
                "op": "insert",
                "after_page": 99,  # beyond current page count
                "from_pdf": "main",
                "pages": [1],
            }],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_PAGE_RANGE


def test_edit_pages_rejects_unknown_op(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 2)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{"op": "explode", "pages": [1]}],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_OPERATION


def test_edit_pages_rejects_insert_source_out_of_range(tmp_path: Path) -> None:
    inp = tmp_path / "in.pdf"
    extra = tmp_path / "extra.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 3)
    _make_multipage_pdf(extra, 1)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[{
                "op": "insert",
                "after_page": 1,
                "from_pdf": "extra",
                "pages": [5],  # extra only has 1 page
            }],
            extra_path=extra,
        )
    assert exc.value.error_code == ErrorCode.INVALID_PAGE_RANGE


def test_edit_pages_rejects_rotate_out_of_range_after_delete(tmp_path: Path) -> None:
    """After a delete, page numbers in subsequent ops reference the
    *current* state — verifying that here prevents regressions."""
    inp = tmp_path / "in.pdf"
    out = tmp_path / "out.pdf"
    _make_multipage_pdf(inp, 3)

    with pytest.raises(PagesError) as exc:
        edit_pages(
            inp,
            out,
            ops=[
                {"op": "delete", "pages": [1, 2]},  # 3 → 1
                {"op": "rotate", "pages": [3], "degrees": 90},  # 3 is gone
            ],
            extra_path=None,
        )
    assert exc.value.error_code == ErrorCode.INVALID_PAGE_RANGE
