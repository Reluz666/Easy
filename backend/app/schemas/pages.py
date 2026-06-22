"""Pydantic models for the `/api/jobs/pages` operation list.

The frontend ships an `ops` JSON string on the multipart form. FastAPI
gives us the raw string; we `json.loads` it and validate here. We use a
discriminated union on the ``op`` field so each variant can carry its
own typed fields (delete.pages vs. insert.after_page, etc.).

After validation the endpoint converts each model to a plain dict via
``model_dump()`` and passes the list to ``app.services.pages.edit_pages``,
which trusts the shape but still re-validates invariants that depend on
the current document state (page count, ordering).
"""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Base(BaseModel):
    """Frozen, forbid extras — keeps malformed input out of the worker."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DeleteOp(_Base):
    op: Literal["delete"]
    pages: list[int] = Field(min_length=1)


class InsertOp(_Base):
    op: Literal["insert"]
    after_page: int = Field(
        ge=0,
        description=(
            "1-indexed position in the current main PDF state *after* this "
            "page. 0 means prepend; len(pages) means append."
        ),
    )
    from_pdf: Literal["main", "extra"]
    pages: list[int] = Field(
        min_length=1,
        description="1-indexed page numbers within the source PDF.",
    )


class RotateOp(_Base):
    op: Literal["rotate"]
    pages: list[int] = Field(min_length=1)
    degrees: Literal[90, 180, 270]


class ReorderOp(_Base):
    op: Literal["reorder"]
    order: list[int] = Field(
        min_length=1,
        description="A permutation of 1..N where N is the current main PDF page count.",
    )


PagesOp = Annotated[
    DeleteOp | InsertOp | RotateOp | ReorderOp,
    Field(discriminator="op"),
]


def parse_ops_json(raw: str) -> list[dict]:
    """Validate the multipart `ops` field and return a list of plain dicts.

    Raises ``ValueError`` with a Spanish-friendly message on shape errors;
    the endpoint converts to 400 / 422.
    """
    import json

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"El campo ops no es JSON válido: {exc.msg}.") from exc

    if not isinstance(parsed, list):
        raise ValueError("ops debe ser una lista de operaciones.")

    adapter = TypeAdapter(list[PagesOp])
    try:
        models = adapter.validate_python(parsed)
    except Exception as exc:
        # Pydantic's exception is verbose; collapse to a short Spanish hint.
        raise ValueError(f"Operación inválida en ops: {exc}") from exc

    return [m.model_dump() for m in models]
