"""Error catalogue — Spanish messages for the UI, English codes for logs."""
from enum import Enum


class ErrorCode(str, Enum):
    FILE_NOT_PDF = "FILE_NOT_PDF"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    FILE_CORRUPT = "FILE_CORRUPT"
    FILE_ENCRYPTED = "FILE_ENCRYPTED"
    GS_TIMEOUT = "GS_TIMEOUT"
    GS_FAILED = "GS_FAILED"
    OCR_TIMEOUT = "OCR_TIMEOUT"
    OCR_FAILED = "OCR_FAILED"
    FOLIATE_FAILED = "FOLIATE_FAILED"
    PAGES_FAILED = "PAGES_FAILED"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    INTERNAL = "INTERNAL"


def message_for(code: ErrorCode, **kwargs: object) -> str:
    """Return the user-facing Spanish message for an error code.

    `kwargs` lets us interpolate runtime values (size, limit, detail, ...).
    Unknown kwargs are ignored on purpose so the caller can pass extra context.
    """
    templates: dict[ErrorCode, str] = {
        ErrorCode.FILE_NOT_PDF: "El archivo debe ser un PDF.",
        ErrorCode.FILE_TOO_LARGE: (
            "El archivo ({size_mb} MB) supera el límite de {limit_mb} MB."
        ),
        ErrorCode.FILE_CORRUPT: "El PDF puede estar dañado o protegido.",
        ErrorCode.FILE_ENCRYPTED: (
            "El PDF está protegido con contraseña y no se puede procesar."
        ),
        ErrorCode.GS_TIMEOUT: (
            "La compresión tardó demasiado y fue cancelada. "
            "Probá con un PDF más liviano o un nivel más bajo."
        ),
        ErrorCode.GS_FAILED: "No se pudo comprimir el PDF. ({detail})",
        ErrorCode.OCR_TIMEOUT: (
            "El OCR tardó demasiado. El PDF puede tener imágenes muy grandes."
        ),
        ErrorCode.OCR_FAILED: "No se pudo aplicar OCR al PDF. ({detail})",
        ErrorCode.FOLIATE_FAILED: "No se pudo foliar el PDF.",
        ErrorCode.PAGES_FAILED: (
            "La operación de páginas no es válida. Verificá los números de página."
        ),
        ErrorCode.JOB_NOT_FOUND: (
            "No encontramos el trabajo. Puede haber expirado (TTL {ttl_h} h)."
        ),
        ErrorCode.INTERNAL: "Error interno. Reintentá en unos minutos.",
    }
    template = templates[code]
    try:
        return template.format(**kwargs)
    except KeyError:
        return template
