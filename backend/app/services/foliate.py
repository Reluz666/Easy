"""PyMuPDF wrapper for foliating (page-numbering) PDFs.

We use `fitz.Page.insert_text` with the built-in Helvetica core font
(`fontname="helv"`) so we never depend on an external font file. Position
is chosen from a closed set of six anchors (top/bottom x left/center/right)
and resolved into (x, y) PDF coordinates against the page's MediaBox.

Output is written with `garbage=4, deflate=True` to drop unused objects
and re-compress streams — the same safety-oriented settings pikepdf users
reach for, but using PyMuPDF so we don't add a second PDF library.

Why we draw a single line with `insert_text` (not `insert_textbox`):
- The folio is one short string per page; textbox adds wrapping logic
  we'd then have to defeat.

Why errors map to the existing `ErrorCode` enum:
- The worker reads `exc.error_code` and writes it to Redis verbatim. The
  UI's Spanish message is fetched via `message_for(...)`, so changing
  copy later requires no UI change.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import fitz

from app.core.logging import get_logger
from app.schemas.errors import ErrorCode

log = get_logger("foliate")


class FoliateError(Exception):
    """Raised when foliation fails. Carries the errorCode for the API/worker."""

    def __init__(self, error_code: ErrorCode, message: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


VALID_POSITIONS: frozenset[str] = frozenset({
    "top-left", "top-center", "top-right",
    "bottom-left", "bottom-center", "bottom-right",
})
MIN_FONT_SIZE = 6
MAX_FONT_SIZE = 72
MARGIN_PT = 24


@dataclass(frozen=True)
class FoliateParams:
    """Validated foliation parameters.

    `range_mode == "all"` ignores `from_page` / `to_page` (whole document).
    `range_mode == "from-to"` requires both fields to be 1-indexed inclusive.
    """

    initial_number: int = 1
    prefix: str = ""
    position: str = "bottom-center"
    font_size: int = 12
    range_mode: str = "all"
    from_page: int | None = None
    to_page: int | None = None


def _resolve_pages(params: FoliateParams, total: int) -> tuple[int, int]:
    """Translate (range_mode, from, to) into concrete 1-indexed [from, to].

    Raises FoliateError(INVALID_PAGE_RANGE) when the range is malformed OR
    out of bounds for the actual document — callers don't need to know which.
    """
    if params.range_mode == "all":
        return 1, total
    f, t = params.from_page, params.to_page
    if f is None or t is None or f < 1 or t < f or t > total:
        raise FoliateError(
            ErrorCode.INVALID_PAGE_RANGE,
            "El rango de páginas no es válido.",
        )
    return f, t


def _text_origin(
    page: fitz.Page,
    position: str,
    font_size: float,
    text_width: float,
) -> tuple[float, float]:
    """Return (x, y) in PDF points (origin = bottom-left) for the folio text.

    Top positions place the baseline near the top edge; bottom positions
    place it above the bottom margin.
    """
    width = page.rect.width
    height = page.rect.height
    margin = MARGIN_PT

    if position.endswith("center"):
        x = (width - text_width) / 2
    elif position.endswith("right"):
        x = width - text_width - margin
    else:
        x = margin

    if position.startswith("top"):
        y = height - margin
    else:
        y = margin + font_size
    return x, y


def foliate_pdf(
    input_path: Path,
    output_path: Path,
    params: FoliateParams,
) -> int:
    """Apply foliation to `input_path` and write the result to `output_path`.

    Returns the number of pages foliated.
    Raises FoliateError on validation or processing failures.
    """
    if not input_path.is_file():
        raise FoliateError(
            ErrorCode.FILE_CORRUPT,
            "El PDF de entrada no existe o no es accesible.",
        )
    if params.position not in VALID_POSITIONS:
        raise FoliateError(
            ErrorCode.FOLIATE_FAILED,
            f"Posición inválida: {params.position!r}.",
        )
    if params.font_size < MIN_FONT_SIZE or params.font_size > MAX_FONT_SIZE:
        raise FoliateError(
            ErrorCode.FOLIATE_FAILED,
            f"Tamaño de fuente fuera de rango ({MIN_FONT_SIZE}-{MAX_FONT_SIZE}).",
        )
    if params.initial_number < 1:
        raise FoliateError(
            ErrorCode.INVALID_PAGE_RANGE,
            "El número inicial debe ser mayor o igual a 1.",
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    try:
        doc = fitz.open(str(input_path))
    except Exception as exc:
        raise FoliateError(
            ErrorCode.FILE_CORRUPT,
            "El PDF puede estar dañado o protegido.",
        ) from exc

    try:
        if doc.is_encrypted:
            raise FoliateError(
                ErrorCode.FILE_ENCRYPTED,
                "El PDF está protegido con contraseña y no se puede procesar.",
            )
        if doc.needs_pass:
            raise FoliateError(
                ErrorCode.FILE_ENCRYPTED,
                "El PDF está protegido con contraseña y no se puede procesar.",
            )

        total = doc.page_count
        if total == 0:
            raise FoliateError(
                ErrorCode.FOLIATE_FAILED,
                "El PDF no tiene páginas.",
            )

        from_page, to_page = _resolve_pages(params, total)
        folio_value = params.initial_number
        pages_foliated = 0

        for page_index in range(from_page - 1, to_page):
            page = doc[page_index]
            text = f"{params.prefix}{folio_value}"
            text_width = fitz.get_text_length(text, fontname="helv", fontsize=params.font_size)
            x, y = _text_origin(page, params.position, params.font_size, text_width)
            try:
                page.insert_text(
                    (x, y),
                    text,
                    fontname="helv",
                    fontsize=params.font_size,
                    color=(0.0, 0.0, 0.0),
                )
            except Exception as exc:
                raise FoliateError(
                    ErrorCode.FOLIATE_FAILED,
                    f"No se pudo dibujar el folio en la página {page_index + 1}.",
                ) from exc
            folio_value += 1
            pages_foliated += 1

        try:
            doc.save(str(output_path), garbage=4, deflate=True)
        except Exception as exc:
            raise FoliateError(
                ErrorCode.FOLIATE_FAILED,
                "No se pudo guardar el PDF foliado.",
            ) from exc
    finally:
        doc.close()

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise FoliateError(
            ErrorCode.FOLIATE_FAILED,
            "El PDF foliado no se generó correctamente.",
        )

    log.info(
        "foliate.success",
        pages=pages_foliated,
        output=str(output_path),
        output_bytes=output_path.stat().st_size,
    )
    return pages_foliated
