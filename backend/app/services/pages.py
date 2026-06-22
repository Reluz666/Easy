"""pikepdf wrapper for page-level PDF editing.

Operations (any subset, applied in the order given in `ops`):

* ``delete``  remove pages by 1-indexed position in the current state
* ``insert``  copy pages from main or extra PDF, insert at a position
* ``rotate``  set /Rotate on specific pages (cumulative with existing)
* ``reorder`` rebuild the page order from a permutation

All page numbers in `ops` are **1-indexed positions in the current state**
of the main PDF at the time the op runs. So `delete [2]` on a 5-page
document reduces it to 4 pages; a subsequent `insert after_page=2` then
inserts right after the new second page. This makes the semantics order-
sensitive but unambiguous.

Why pikepdf (and not PyMuPDF) for page editing:
- `pikepdf.Pdf.copy_foreign` is purpose-built for moving pages between
  PDFs without losing form data, annotations, or document structure.
- Reordering uses direct /Kids manipulation, which is O(N) instead of
  PyMuPDF's `select()`-and-save (which re-writes the whole file).

Why errors map to the existing `ErrorCode` enum:
- The worker reads `exc.error_code` and writes it to Redis verbatim. The
  UI's Spanish message is fetched via `message_for(...)`, so changing
  copy later requires no UI change.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pikepdf

from app.core.logging import get_logger
from app.schemas.errors import ErrorCode

log = get_logger("pages")

VALID_DEGREES: frozenset[int] = frozenset({90, 180, 270})
VALID_OPS: frozenset[str] = frozenset({"delete", "insert", "rotate", "reorder"})


class PagesError(Exception):
    """Raised when page editing fails. Carries the errorCode for the API/worker."""

    def __init__(self, error_code: ErrorCode, message: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


@dataclass(frozen=True)
class EditStats:
    pages_in: int
    pages_out: int
    delete_count: int
    insert_count: int
    rotate_count: int
    reorder_count: int


def _check_no_dupes(values: list[int], label: str) -> None:
    if len(set(values)) != len(values):
        raise PagesError(
            ErrorCode.INVALID_PAGE_RANGE,
            f"{label}: hay páginas repetidas.",
        )


def _check_in_range(values: list[int], current: int, label: str) -> None:
    for v in values:
        if not isinstance(v, int) or v < 1 or v > current:
            raise PagesError(
                ErrorCode.INVALID_PAGE_RANGE,
                f"{label}: la página {v} está fuera del rango 1..{current}.",
            )


def _is_permutation(order: list[int], n: int) -> bool:
    """True iff `order` is exactly [1..n] in some order. Trivially rejects
    duplicates and out-of-range values."""
    return sorted(order) == list(range(1, n + 1))


def edit_pages(
    input_path: Path,
    output_path: Path,
    ops: list[dict],
    extra_path: Path | None,
) -> EditStats:
    """Apply `ops` in order to `input_path` and write the result to `output_path`.

    `ops` is a list of plain dicts already validated by the endpoint via
    the Pydantic models in `app.schemas.pages`. The service re-validates
    invariants that depend on the *current* state of the document (which
    the endpoint can't see) — page numbers, order permutations, etc.

    Raises `PagesError` on validation or processing failures.
    """
    if not input_path.is_file():
        raise PagesError(
            ErrorCode.FILE_CORRUPT,
            "El PDF de entrada no existe o no es accesible.",
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    try:
        main_pdf = pikepdf.open(str(input_path), allow_overwriting_input=True)
    except pikepdf.PasswordError as exc:
        raise PagesError(
            ErrorCode.FILE_ENCRYPTED,
            "El PDF está protegido con contraseña y no se puede procesar.",
        ) from exc
    except Exception as exc:
        raise PagesError(
            ErrorCode.FILE_CORRUPT,
            "El PDF puede estar dañado o protegido.",
        ) from exc

    extra_pdf: pikepdf.Pdf | None = None

    delete_count = 0
    insert_count = 0
    rotate_count = 0
    reorder_count = 0

    try:
        pages_in = len(main_pdf.pages)
        if pages_in == 0:
            raise PagesError(
                ErrorCode.PAGES_FAILED,
                "El PDF no tiene páginas.",
            )

        # Tally op counts for the final log + stats.
        for op in ops:
            kind = op.get("op") if isinstance(op, dict) else None
            if kind not in VALID_OPS:
                raise PagesError(
                    ErrorCode.INVALID_OPERATION,
                    f"Operación desconocida: {kind!r}.",
                )
            if kind == "delete":
                delete_count += 1
            elif kind == "insert":
                insert_count += 1
            elif kind == "rotate":
                rotate_count += 1
            elif kind == "reorder":
                reorder_count += 1

        # Pre-validate everything that doesn't depend on intermediate state.
        # `reorder` depends on the current page count at the time it runs,
        # so we defer its permutation check to the execution loop below.
        needs_extra = False
        for op in ops:
            kind = op["op"]
            if kind == "delete":
                _check_no_dupes(op["pages"], "delete")
                _check_in_range(op["pages"], pages_in, "delete")
            elif kind == "insert":
                _check_no_dupes(op["pages"], "insert")
                if op["from_pdf"] == "extra":
                    needs_extra = True
                    if extra_path is None:
                        raise PagesError(
                            ErrorCode.INVALID_OPERATION,
                            "Insert pide páginas de un PDF extra pero no se proporcionó.",
                        )
            elif kind == "rotate":
                _check_no_dupes(op["pages"], "rotate")
                if op["degrees"] not in VALID_DEGREES:
                    raise PagesError(
                        ErrorCode.INVALID_OPERATION,
                        f"rotate: grados deben ser 90, 180 o 270 (recibido {op['degrees']}).",
                    )
            elif kind == "reorder":
                _check_no_dupes(op["order"], "reorder")
                # Permutation check deferred — the page count at execution
                # time may differ from `pages_in` after earlier ops.

        # Lazily open the extra PDF — only if at least one insert needs it.
        if needs_extra:
            try:
                extra_pdf = pikepdf.open(str(extra_path), allow_overwriting_input=True)
            except pikepdf.PasswordError as exc:
                raise PagesError(
                    ErrorCode.FILE_ENCRYPTED,
                    "El PDF extra está protegido con contraseña.",
                ) from exc
            except Exception as exc:
                raise PagesError(
                    ErrorCode.FILE_CORRUPT,
                    "El PDF extra puede estar dañado o protegido.",
                ) from exc

        # Apply ops in the order given. After every op the page count
        # changes (or may), so we re-read it before each step.
        for op in ops:
            kind = op["op"]
            current = len(main_pdf.pages)

            if kind == "delete":
                # Validate against the *current* state in case a prior op
                # changed the page count.
                _check_in_range(op["pages"], current, "delete")
                # Sort descending so removing one page doesn't shift the
                # next index before we delete it.
                for p in sorted(op["pages"], reverse=True):
                    del main_pdf.pages[p - 1]

            elif kind == "insert":
                src = extra_pdf if op["from_pdf"] == "extra" else main_pdf
                src_count = len(src.pages)
                _check_in_range(op["pages"], src_count, "insert (origen)")
                after = op["after_page"]
                if after < 0 or after > current:
                    raise PagesError(
                        ErrorCode.INVALID_PAGE_RANGE,
                        f"insert.after_page {after} fuera de 0..{current}.",
                    )
                # pikepdf copies foreign pages automatically on append/insert
                # into a different PDF's /Pages tree. We use a single
                # `pages.insert` per source page so the source PDF stays
                # intact and the destination gets a fresh, independent
                # reference to the page object.
                for offset, src_idx in enumerate(op["pages"]):
                    main_pdf.pages.insert(after + offset, src.pages[src_idx - 1])

            elif kind == "rotate":
                _check_in_range(op["pages"], current, "rotate")
                for p in op["pages"]:
                    page = main_pdf.pages[p - 1]
                    existing = int(page.get("/Rotate", 0))
                    page["/Rotate"] = (existing + op["degrees"]) % 360

            elif kind == "reorder":
                if not _is_permutation(op["order"], current):
                    raise PagesError(
                        ErrorCode.INVALID_PAGE_RANGE,
                        f"reorder: el orden debe ser una permutación exacta de 1..{current}.",
                    )
                # Build the new order from the *current* state, then replace.
                current_pages = list(main_pdf.pages)
                desired = [current_pages[i - 1] for i in op["order"]]
                # `del pages[:]` removes all kids from the page tree.
                # The page objects themselves are kept alive via `desired`.
                del main_pdf.pages[:]
                for page in desired:
                    main_pdf.pages.append(page)

        try:
            main_pdf.save(str(output_path))
        except Exception as exc:
            raise PagesError(
                ErrorCode.PAGES_FAILED,
                "No se pudo guardar el PDF editado.",
            ) from exc
    finally:
        main_pdf.close()
        if extra_pdf is not None:
            extra_pdf.close()

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise PagesError(
            ErrorCode.PAGES_FAILED,
            "El PDF editado no se generó correctamente.",
        )

    # Open the output to count pages and confirm it's a valid PDF.
    try:
        verify_pdf = pikepdf.open(str(output_path))
    except Exception as exc:
        raise PagesError(
            ErrorCode.PAGES_FAILED,
            "El PDF editado no se pudo reabrir para verificación.",
        ) from exc
    try:
        pages_out = len(verify_pdf.pages)
    finally:
        verify_pdf.close()

    log.info(
        "pages.success",
        pages_in=pages_in,
        pages_out=pages_out,
        delete=delete_count,
        insert=insert_count,
        rotate=rotate_count,
        reorder=reorder_count,
        output=str(output_path),
        output_bytes=output_path.stat().st_size,
    )

    return EditStats(
        pages_in=pages_in,
        pages_out=pages_out,
        delete_count=delete_count,
        insert_count=insert_count,
        rotate_count=rotate_count,
        reorder_count=reorder_count,
    )
