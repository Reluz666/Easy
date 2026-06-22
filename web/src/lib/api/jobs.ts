/**
 * API client for the Python backend job endpoints.
 *
 * The frontend is a thin transport layer: it uploads, polls, and downloads —
 * all heavy lifting happens server-side.
 */

export type CompressLevel = "baja" | "media" | "alta";

export type OcrLang = "spa+eng" | "spa" | "eng";

export type JobStatus = "queued" | "processing" | "done" | "failed";

export type JobInfo = {
  id: string;
  op: string;
  status: JobStatus;
  progress: number;
  params: {
    level?: CompressLevel;
    lang?: OcrLang;
    safe_name?: string;
    [k: string]: unknown;
  };
  input_path: string;
  output_path: string | null;
  error_code: string | null;
  error_message: string | null;
  input_bytes: number;
  output_bytes: number | null;
  reduction_pct: number | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type JobCreatedResponse = {
  jobId: string;
  status: "queued";
};

export type ApiError = {
  errorCode: string;
  message: string;
};

export class JobApiError extends Error {
  readonly errorCode: string;
  readonly httpStatus: number;

  constructor(httpStatus: number, errorCode: string, message: string) {
    super(message);
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    this.name = "JobApiError";
  }
}

/**
 * Translate a backend `errorCode` into a user-facing Spanish message.
 *
 * The backend already returns Spanish messages in `detail.message` for
 * 4xx errors; we surface those unchanged. For 5xx/network failures we
 * fall back to a generic Spanish message so the UI is never blank.
 */
export function describeApiError(err: unknown): string {
  if (err instanceof JobApiError) {
    return err.message;
  }
  if (err instanceof TypeError) {
    // fetch() rejects with TypeError on network failure (DNS, refused, offline).
    return "No se pudo contactar al servidor. Verificá tu conexión e intentá de nuevo.";
  }
  if (err instanceof Error) return err.message;
  return "Ocurrió un error inesperado.";
}

async function readJsonError(resp: Response): Promise<ApiError> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "object" && body.detail !== null) {
      return {
        errorCode: String(body.detail.errorCode ?? "UNKNOWN"),
        message: String(body.detail.message ?? "Error desconocido."),
      };
    }
    if (body && typeof body.errorCode === "string") {
      return { errorCode: body.errorCode, message: String(body.message ?? "Error.") };
    }
  } catch {
    // non-JSON body — fall through
  }
  return { errorCode: `HTTP_${resp.status}`, message: `Error HTTP ${resp.status}.` };
}

/**
 * Upload a PDF and create a compression job. Returns the API-level jobId
 * the client polls for state.
 */
export async function createCompressJob(
  file: File,
  level: CompressLevel,
  signal?: AbortSignal,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("level", level);

  const resp = await fetch("/api/jobs/compress", {
    method: "POST",
    body: fd,
    signal,
  });
  if (!resp.ok) {
    const err = await readJsonError(resp);
    throw new JobApiError(resp.status, err.errorCode, err.message);
  }
  const body = (await resp.json()) as JobCreatedResponse;
  return body.jobId;
}

/**
 * Upload a scanned PDF and create an OCR job. Returns the API-level jobId.
 *
 * Note on error semantics: this call only surfaces synchronous validation
 * errors (invalid language, file is not a PDF, file too large, unexpected
 * save failure). Worker-side failures (OCR_TIMEOUT, OCR_FAILED, empty
 * output) are NOT in the POST response — they're written to the job
 * state in Redis. The caller must poll `getJob` to read the eventual
 * outcome.
 */
export async function createOcrJob(
  file: File,
  lang: OcrLang,
  signal?: AbortSignal,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("lang", lang);

  const resp = await fetch("/api/jobs/ocr", {
    method: "POST",
    body: fd,
    signal,
  });
  if (!resp.ok) {
    const err = await readJsonError(resp);
    throw new JobApiError(resp.status, err.errorCode, err.message);
  }
  const body = (await resp.json()) as JobCreatedResponse;
  return body.jobId;
}

/** Fetch the current state of a job. Throws JobApiError on 404 / 5xx. */
export async function getJob(jobId: string, signal?: AbortSignal): Promise<JobInfo> {
  const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { signal });
  if (!resp.ok) {
    const err = await readJsonError(resp);
    throw new JobApiError(resp.status, err.errorCode, err.message);
  }
  return (await resp.json()) as JobInfo;
}

/** Delete a job and its files (idempotent — 204 either way). */
export async function deleteJob(jobId: string): Promise<void> {
  try {
    await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  } catch {
    // best-effort cleanup; ignore network errors so the UI can keep going
  }
}

export type DownloadResult = {
  blob: Blob;
  filename: string;
};

/**
 * Stream the result PDF into a Blob. The backend already streams chunks;
 * we let the browser accumulate them so the user gets a single download.
 */
export async function downloadJobResult(
  jobId: string,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/download`, { signal });
  if (!resp.ok) {
    const err = await readJsonError(resp);
    throw new JobApiError(resp.status, err.errorCode, err.message);
  }
  const blob = await resp.blob();
  const cd = resp.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match?.[1] ?? `comprimido-${jobId}.pdf`;
  return { blob, filename };
}