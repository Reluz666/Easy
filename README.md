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

## Rate limiting

Los 4 `POST /api/jobs/*` están protegidos con un rate limiter de
**fixed window por IP**, respaldado por Redis (funciona en deployments
multi-instancia). Defaults:

| Variable                              | Default | Significado                              |
|---------------------------------------|---------|------------------------------------------|
| `RATE_LIMIT_ENABLED`                  | `true`  | Apagálo solo en dev / redes confiables   |
| `RATE_LIMIT_JOBS_PER_MINUTE`          | `5`     | Requests por IP por minuto               |
| `RATE_LIMIT_JOBS_PER_HOUR`            | `30`    | Requests por IP por hora                 |
| `RATE_LIMIT_MAX_ACTIVE_JOBS_PER_IP`   | `3`     | Jobs `queued`/`processing` simultáneos   |
| `TRUST_PROXY_HEADERS`                 | `false` | Habilitar XFF **solo detrás de proxy**    |

**La cuota NO se consume** si el upload falla validación (PDF
incorrecto, oversize, falta `ops` o `extra_file`). Las validaciones
corren como dependencias de FastAPI **antes** del rate limit.

Las respuestas de error son JSON con `errorCode` + `message` en
español:

- `429` con `errorCode: "RATE_LIMITED"` — “Has enviado demasiadas
  solicitudes. Intenta nuevamente en unos minutos.”
- `429` con `errorCode: "TOO_MANY_ACTIVE_JOBS"` — “Ya tienes demasiados
  archivos procesándose. Espera a que terminen antes de subir otro.”

Toda respuesta (200, 202, 429) lleva los headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `Retry-After` (solo en 429)

**Sobre `TRUST_PROXY_HEADERS`**: si está apagado (default), la IP
viene de `request.client.host` — el peer TCP real, no spoofable.
Si está prendido, se usa el primer hop de `X-Forwarded-For`. Solo
habilitar detrás de un reverse proxy que **re-escriba** ese header
(nginx con `proxy_set_header X-Forwarded-For $remote_addr`, ALB,
Cloudflare, etc.). Un atacante puede rotar IPs enviando XFF
manualmente si no hay un proxy de confianza delante.

> **Nota sobre uvicorn.** Uvicorn 0.34 trae su propio parseo de
> `X-Forwarded-For` cuando el peer TCP es `127.0.0.1` (su default
> `--forwarded-allow-ips=127.0.0.1`). Para que `TRUST_PROXY_HEADERS`
> sea la única fuente de verdad, `docker-compose.yml` arranca uvicorn
> con `--forwarded-allow-ips=` (cadena vacía = nunca confía en XFF a
> nivel servidor). Si desplegás detrás de un proxy real, mantené este
> flag y administrá la confianza con `TRUST_PROXY_HEADERS` desde la
> app.

## Desarrollo del backend sin Docker

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # o .venv\Scripts\activate en Windows
pip install -r requirements-dev.txt
# Necesitás un Redis local en :6379
REDIS_URL=redis://localhost:6379/0 DATA_DIR=./data uvicorn app.main:app --reload
```
