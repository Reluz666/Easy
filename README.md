# Easy PDF

Herramientas PDF en el navegador, con el procesamiento pesado en un backend
Python (FastAPI + RQ + Ghostscript + OCRmyPDF + PyMuPDF + pikepdf).

```
Easy/
├── web/                  # Frontend React 19 + Vite + TypeScript
├── backend/              # API FastAPI + workers RQ (mismo Dockerfile)
├── docker-compose.yml    # Redis + API + 5 workers
└── .env.example          # Variables de entorno (copiar a .env)
```

## Requisitos

- Docker Desktop (o Docker Engine + Compose v2)
- Node 20+ (solo si vas a desarrollar el frontend sin Docker)

## Arranque rápido

```bash
cp .env.example .env              # una vez
docker compose up --build         # primera vez tarda ~3 min por la imagen
```

Cuando veas `api-1  | Application startup complete`, abrí <http://localhost:8000/health>.
Tiene que devolver `{"ok":true,...}` con las 6 dependencias (`gs`, `ocrmypdf`,
`tesseract`, `qpdf`, `PyMuPDF`, `pikepdf`) en `available: true`.

El frontend sigue siendo el de `web/`. Para levantarlo sin Docker:

```bash
cd web
npm install
npm run dev    # http://localhost:5173 — proxya /api → http://localhost:8000
```

## Servicios del compose

| Servicio              | Función                                                 |
|-----------------------|---------------------------------------------------------|
| `redis`               | Broker RQ + estado de jobs                              |
| `api`                 | FastAPI en :8000 (uploads, status, downloads)           |
| `worker-compress-1/2` | 2 procesos para comprimir (paralelismo real)            |
| `worker-ocr`          | OCR vía OCRmyPDF                                        |
| `worker-foliate`      | Foliar con PyMuPDF                                      |
| `worker-pages`        | Eliminar / rotar / reordenar páginas con pikepdf        |
| `worker-cleanup`      | GC periódico de `/data` (jobs viejos + huérfanos)       |

`deploy.replicas` no se usa: solo aplica en Swarm. Para más workers de
compresión, copiá el bloque `worker-compress-1` y renombrá el `WORKER_NAME`.

## Endpoints

| Método | Ruta                            | Descripción                       |
|--------|---------------------------------|-----------------------------------|
| GET    | `/health`                       | Estado completo (Redis + tools)   |
| GET    | `/health/live`                  | Liveness probe (204)              |
| POST   | `/api/jobs/compress`            | Subir PDF + `level`               |
| POST   | `/api/jobs/ocr`                 | Subir PDF + `language`            |
| POST   | `/api/jobs/foliate`             | Subir PDF + posición + formato    |
| POST   | `/api/jobs/pages`               | Subir PDF + ops JSON              |
| GET    | `/api/jobs/{jobId}`             | Estado del job                    |
| GET    | `/api/jobs/{jobId}/download`    | Descargar PDF resultante          |
| DELETE | `/api/jobs/{jobId}`             | Cancelar / limpiar                |

## Logs y timeouts

- Logs estructurados JSON en stdout (`docker compose logs -f api`).
- Cada tool corre con `subprocess.communicate(timeout=…)` y se mata con
  SIGTERM → SIGKILL si excede el límite configurado en `.env`.

## Limpieza de archivos en `/data`

El `worker-cleanup` corre en background y borra cada
`CLEANUP_INTERVAL_SECONDS`:

- Jobs `done`/`failed` más viejos que `JOB_TTL_SECONDS` (default 24 h).
- Directorios huérfanos (sin `job:{id}` en Redis) más viejos que
  `CLEANUP_GRACE_SECONDS` (default 1 h).
- **Nunca** borra jobs `queued`/`processing`.

Para forzar una pasada manual (sin reiniciar el contenedor):

```bash
docker compose run --rm worker-cleanup python -m app.cleanup --once
# o con el reporte como JSON:
docker compose run --rm worker-cleanup python -m app.cleanup --json
```

## Desarrollo del backend sin Docker

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # o .venv\Scripts\activate en Windows
pip install -r requirements-dev.txt
# Necesitás un Redis local en :6379
REDIS_URL=redis://localhost:6379/0 DATA_DIR=./data uvicorn app.main:app --reload
```
