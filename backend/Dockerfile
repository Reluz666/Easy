# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# --- System deps ---------------------------------------------------------
# - ghostscript: image/PDF compression
# - ocrmypdf pinned separately (it's a pip package)
# - tesseract-ocr-{eng,spa}: OCR engine + language packs (spa+eng is the
#   combination ocrmypdf recommends for bilingual scans)
# - qpdf: used by both gs (via pdfwrite) and ocrmypdf --optimize
# - unpaper: optional cleanup stage ocrmypdf uses when --clean is passed
# - build-essential + libffi-dev: only needed for a couple of pip wheels
#   (pikepdf bundles pre-built wheels but we keep build tools in case a
#   future package needs compiling)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ghostscript \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-spa \
        qpdf \
        unpaper \
        pngquant \
        build-essential \
        libffi-dev \
        libxml2-dev \
        libxslt1-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps in a cached layer
COPY requirements.txt .
RUN pip install -r requirements.txt

# App source
COPY app/ ./app/
COPY pyproject.toml .

# The default command is overridden per-service in docker-compose.yml:
#   - api:           uvicorn app.main:app --host 0.0.0.0 --port 8000
#   - worker-*:      python -m app.worker.entrypoint
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
