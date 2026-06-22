/**
 * API client for the Python backend job endpoints.
 *
 * The frontend is a thin transport layer: it uploads, polls, and downloads —
 * all heavy lifting happens server-side.
 */

export type CompressLevel = "baja" | "media" | "alta";

export type OcrLang = "spa+eng" | "spa" | "eng";

export type FoliatePosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type FoliateRangeMode = "all" | "from-to";

/**
 * Page-edit operations.
 *
 * Mirror of `backend/app/schemas/pages.py` (Pydantic discriminated union on
 * `op`). All page numbers are **1-indexed** and reference the *current*
 * state of the main PDF at the time the op runs — i.e. ops are applied
 * sequentially and earlier ops can change what later page numbers refer to.
 *
 * The backend re-validates these against the actual document on the worker
 * side; the frontend only needs to match the shape.
 */
export type PagesDeleteOp = {
  op: "delete";
  /** 1-indexed page numbers to remove from the main PDF. */
  pages: number[];
};

export type PagesInsertOp = {
  op: "insert";
  /**
   * 1-indexed position in the current main PDF *after* which the new
   * pages are inserted. `0` prepends; pass the current page count to
   * append.
   */
  after_page: number;
  /** Source PDF for the inserted pages. `"extra"` requires `extraFile`. */
  from_pdf: "main" | "extra";
  /** 1-indexed page numbers within the source PDF. */
  pages: number[];
};

export type PagesRotateOp = {
  op: "rotate";
  pages: number[];
  /** Rotation applied cumulatively on top of any existing /Rotate. */
  degrees: 90 | 180 | 270;
};

export type PagesReorderOp = {
  op: "reorder";
  /** Permutation of 1..N where N is the current main PDF page count. */
  order: number[];
};

export type PagesOp = PagesDeleteOp | PagesInsertOp | PagesRotateOp | PagesReorderOp;

export type JobStatus = "queued" | "processing" | "done" | "failed";

export type JobInfo = {
  id: string;
  op: string;
  status: JobStatus;
  progress: number;
  params: {
    level?: CompressLevel;
    lang?: OcrLang;
    initial_number?: number;
    prefix?: string;
    position?: FoliatePosition;
    font_size?: number;
    range_mode?: FoliateRangeMode;
    from_page?: number | null;
    to_page?: number | null;
    ops?: PagesOp[];
    has_extra?: boolean;
    extra_path?: string | null;
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

/**
 * Upload a PDF and create a foliation job. Returns the API-level jobId.
 *
 * Same async error contract as `createOcrJob`: this call only surfaces
 * synchronous validation errors (invalid position/range_mode, file is not
 * a PDF, file too large, missing/inverted from-to bounds). Worker-side
 * failures (INVALID_PAGE_RANGE out of bounds, FOLIATE_FAILED, FILE_CORRUPT,
 * FILE_ENCRYPTED) are NOT in the POST response — they're written to the
 * job state in Redis. The caller must poll `getJob` to read the eventual
 * outcome.
 */
export async function createFoliateJob(
  file: File,
  params: {
    initial_number: number;
    prefix: string;
    position: FoliatePosition;
    font_size: number;
    range_mode: FoliateRangeMode;
    from_page: number | null;
    to_page: number | null;
  },
  signal?: AbortSignal,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("initial_number", String(params.initial_number));
  fd.append("prefix", params.prefix);
  fd.append("position", params.position);
  fd.append("font_size", String(params.font_size));
  fd.append("range_mode", params.range_mode);
  if (params.from_page !== null) fd.append("from_page", String(params.from_page));
  if (params.to_page !== null) fd.append("to_page", String(params.to_page));

  const resp = await fetch("/api/jobs/foliate", {
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
 * Upload a PDF (plus an optional secondary PDF) and create a page-edit job.
 * Returns the API-level jobId.
 *
 * `ops` is a list of page-level operations applied **in order** to the main
 * PDF — see the `PagesOp` union for the supported shapes. All page numbers
 * are 1-indexed and reference the current state of the document at the
 * time the op runs (so a `delete [4]` followed by `rotate [4]` on a 5-page
 * doc means "rotate the page that *was* 5"). The backend serializes the
 * ops as JSON in the multipart `ops` field.
 *
 * `extraFile` is required iff any op has `from_pdf: "extra"`; the backend
 * returns a 400 INVALID_OPERATION if it's missing.
 *
 * Same async error contract as the other create* helpers: synchronous
 * errors (malformed ops, missing extra, file is not a PDF, file too large)
 * come back via this call; worker-side failures (INVALID_PAGE_RANGE out of
 * bounds, FILE_CORRUPT, FILE_ENCRYPTED, PAGES_FAILED) are written to the
 * job state in Redis. The caller must poll `getJob` to read the outcome.
 */
export async function createPagesJob(
  file: File,
  ops: PagesOp[],
  extraFile?: File | null,
  signal?: AbortSignal,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("ops", JSON.stringify(ops));
  if (extraFile) {
    fd.append("extra_file", extraFile, extraFile.name);
  }

  const resp = await fetch("/api/jobs/pages", {
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