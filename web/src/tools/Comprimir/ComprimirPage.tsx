import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import LevelSelector, { type LevelDescriptor } from "./LevelSelector";
import ProgressBar from "./ProgressBar";
import ResultBar from "./ResultBar";
import {
  type CompressLevel,
  type JobInfo,
  createCompressJob,
  createOcrJob,
  deleteJob,
  describeApiError,
  downloadJobResult,
  getJob,
} from "../../lib/api/jobs";
import { formatBytes } from "../../lib/format";
import { logCompressMetric } from "./compress.metrics";

const LEVELS: readonly LevelDescriptor[] = [
  { id: "baja", label: "Baja", description: "Casi sin pérdida visible (~10-20% menos)" },
  { id: "media", label: "Media", description: "Balance recomendado (~40-60% menos)" },
  { id: "alta", label: "Alta", description: "Máxima reducción (~70-85% menos)" },
];

// 100 MB hard cap matches the backend. We mirror it client-side so users
// get an instant error instead of waiting for an upload that will be
// rejected server-side anyway.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type Mode = "compress" | "ocr";

const MODE_OPTIONS: ReadonlyArray<{
  id: Mode;
  label: string;
  description: string;
}> = [
  {
    id: "compress",
    label: "PDF normal",
    description: "Comprime imágenes y objetos con Ghostscript.",
  },
  {
    id: "ocr",
    label: "PDF escaneado: OCR + optimización",
    description:
      "Agrega texto buscable y optimiza imágenes del PDF escaneado.",
  },
];

type Status =
  | "idle"
  | "uploading"
  | "queued"
  | "processing"
  | "complete"
  | "error";

export default function ComprimirPage() {
  const [mode, setMode] = useState<Mode>("compress");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [level, setLevel] = useState<CompressLevel | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  // Tracks whether the user (or unmount) cancelled the in-flight job so we
  // can ignore late `done` polls that finish after the user moved on.
  const cancelledRef = useRef<boolean>(false);

  // Clean up the polling loop and best-effort delete the job on unmount.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      const jid = currentJobIdRef.current;
      if (jid) void deleteJob(jid);
    };
  }, []);

  // Switching mode resets progress + selected level so the user always
  // confirms their choice per mode.
  useEffect(() => {
    setLevel(null);
    setStatus("idle");
    setProgress(0);
    setErrorMessage(null);
    setJobInfo(null);
  }, [mode]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const resetAll = useCallback(() => {
    setFile(null);
    setFileName("");
    setOriginalSize(0);
    setLevel(null);
    setStatus("idle");
    setProgress(0);
    setJobInfo(null);
    setErrorMessage(null);
  }, []);

  const handleFile = useCallback((selected: File) => {
    setErrorMessage(null);
    if (selected.size > MAX_UPLOAD_BYTES) {
      const mb = (selected.size / 1024 / 1024).toFixed(1);
      setErrorMessage(
        `Este PDF es demasiado pesado (${mb} MB). El máximo permitido es ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      );
      return;
    }
    setFile(selected);
    setFileName(selected.name);
    setOriginalSize(selected.size);
    setLevel(null);
    setStatus("idle");
    setProgress(0);
    setJobInfo(null);
    setErrorMessage(null);
  }, []);

  const handleClearFile = useCallback(() => {
    stopPolling();
    const jid = currentJobIdRef.current;
    currentJobIdRef.current = null;
    cancelledRef.current = false;
    if (jid) void deleteJob(jid);
    resetAll();
  }, [stopPolling, resetAll]);

  const pollOnce = useCallback(
    async (jobId: string) => {
      try {
        const info = await getJob(jobId);
        if (cancelledRef.current) return;
        setJobInfo(info);
        setProgress(info.progress);
        if (info.status === "done") {
          stopPolling();
          setStatus("complete");
          setProgress(100);
          if (mode === "ocr") {
            logCompressMetric({
              status: "ocr-success",
              fileName,
              originalSize,
              lang: "spa+eng",
              durationMs: info.duration_ms ?? undefined,
              resultSize: info.output_bytes ?? undefined,
              reductionPct: info.reduction_pct ?? undefined,
              timestamp: new Date().toISOString(),
            });
          } else {
            logCompressMetric({
              status: "success",
              fileName,
              originalSize,
              level: level ?? "media",
              durationMs: info.duration_ms ?? undefined,
              resultSize: info.output_bytes ?? undefined,
              reductionPct: info.reduction_pct ?? undefined,
              timestamp: new Date().toISOString(),
            });
          }
        } else if (info.status === "failed") {
          stopPolling();
          setStatus("error");
          const backendMsg =
            info.error_message ??
            "El servidor rechazó el archivo o falló durante el procesamiento.";
          if (mode === "ocr") {
            logCompressMetric({
              status: "ocr-failed",
              fileName,
              originalSize,
              lang: "spa+eng",
              durationMs: info.duration_ms ?? undefined,
              error: `${info.error_code ?? "UNKNOWN"}: ${backendMsg}`,
              timestamp: new Date().toISOString(),
            });
          } else {
            logCompressMetric({
              status: "error",
              fileName,
              originalSize,
              level: level ?? "media",
              durationMs: info.duration_ms ?? undefined,
              error: `${info.error_code ?? "UNKNOWN"}: ${backendMsg}`,
              timestamp: new Date().toISOString(),
            });
          }
          setErrorMessage(backendMsg);
        } else if (info.status === "queued") {
          setStatus("queued");
          pollTimerRef.current = setTimeout(() => void pollOnce(jobId), 1000);
        } else {
          // processing
          setStatus("processing");
          pollTimerRef.current = setTimeout(() => void pollOnce(jobId), 1000);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        stopPolling();
        const message = describeApiError(err);
        logCompressMetric({
          status: mode === "ocr" ? "ocr-failed" : "error",
          fileName,
          originalSize,
          lang: mode === "ocr" ? "spa+eng" : undefined,
          level: mode === "compress" ? level ?? "media" : undefined,
          error: message,
          timestamp: new Date().toISOString(),
        });
        setErrorMessage(message);
        setStatus("error");
      }
    },
    [fileName, originalSize, level, mode, stopPolling],
  );

  const handleSubmit = useCallback(async () => {
    if (!file) return;
    if (mode === "compress" && !level) return;
    if (status !== "idle" && status !== "complete" && status !== "error") return;

    cancelledRef.current = false;
    setStatus("uploading");
    setProgress(0);
    setErrorMessage(null);
    setJobInfo(null);

    const startTime = performance.now();
    let jobId: string;
    try {
      jobId =
        mode === "compress"
          ? await createCompressJob(file, level as CompressLevel)
          : await createOcrJob(file, "spa+eng");
    } catch (err) {
      const message = describeApiError(err);
      logCompressMetric({
        status: mode === "ocr" ? "ocr-failed" : "error",
        fileName,
        originalSize,
        lang: mode === "ocr" ? "spa+eng" : undefined,
        level: mode === "compress" ? level ?? "media" : undefined,
        durationMs: performance.now() - startTime,
        error: message,
        timestamp: new Date().toISOString(),
      });
      setErrorMessage(message);
      setStatus("error");
      return;
    }

    currentJobIdRef.current = jobId;
    await pollOnce(jobId);
  }, [file, level, mode, status, fileName, originalSize, pollOnce]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    stopPolling();
    const jid = currentJobIdRef.current;
    currentJobIdRef.current = null;
    if (jid) void deleteJob(jid);
    logCompressMetric({
      status: "cancelled",
      fileName,
      originalSize,
      level: level ?? "media",
      lang: mode === "ocr" ? "spa+eng" : undefined,
      timestamp: new Date().toISOString(),
    });
    setStatus("idle");
    setProgress(0);
  }, [fileName, originalSize, level, mode, stopPolling]);

  const handleDownload = useCallback(async () => {
    const jid = currentJobIdRef.current;
    if (!jid) return;
    try {
      const { blob, filename } = await downloadJobResult(jid);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMessage(describeApiError(err));
      setStatus("error");
    }
  }, []);

  const isBusy =
    status === "uploading" || status === "queued" || status === "processing";

  const statusLabel = useMemo<Record<Status, string>>(() => {
    if (mode === "ocr") {
      return {
        idle: "Listo para aplicar OCR.",
        uploading: "Subiendo PDF…",
        queued: "En cola para OCR…",
        processing: "Aplicando OCR y optimización…",
        complete: "OCR finalizado. El PDF ahora puede incluir texto buscable.",
        error: "Ocurrió un error.",
      };
    }
    return {
      idle: "Listo para comprimir.",
      uploading: "Subiendo archivo…",
      queued: "En cola, esperando un worker libre…",
      processing: "Procesando en el servidor…",
      complete: "Listo.",
      error: "Ocurrió un error.",
    };
  }, [mode]);

  // OCR can grow the file (text layer outweighs image savings). When that
  // happens, surface an explicit "creció un X%" note above the result bar
  // so the user understands the size comparison in ResultBar.
  const ocrGrewNote = (() => {
    if (mode !== "ocr") return null;
    if (status !== "complete") return null;
    if (!jobInfo || jobInfo.reduction_pct === null || jobInfo.reduction_pct === undefined) return null;
    if (jobInfo.reduction_pct >= 0) return null;
    const grewPct = Math.abs(jobInfo.reduction_pct).toFixed(1);
    return `El PDF creció un ${grewPct}% (el OCR agregó una capa de texto). Eso es esperable en archivos ya optimizados: ahora el documento es buscable.`;
  })();

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-2">Comprimir</h1>
      <p className="text-text-muted mb-4">
        Reducí el tamaño de un PDF o aplicá OCR a un PDF escaneado.
      </p>

      <section aria-labelledby="mode-heading" className="flex flex-col gap-3 mb-6">
        <h2 id="mode-heading" className="text-lg font-medium text-text">
          Modo
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {MODE_OPTIONS.map((opt) => {
            const selected = opt.id === mode;
            return (
              <label
                key={opt.id}
                className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-surface hover:border-primary/50"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={opt.id}
                  checked={selected}
                  onChange={() => setMode(opt.id)}
                  disabled={isBusy}
                  className="mt-1"
                  data-testid={`mode-${opt.id}`}
                />
                <div>
                  <div className="font-medium text-text">{opt.label}</div>
                  <div className="text-sm text-text-muted">{opt.description}</div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {!file ? (
        <UploadArea onFileSelected={handleFile} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 p-3 bg-surface border border-border rounded-lg">
            <div>
              <div className="font-medium text-text truncate">{fileName}</div>
              <div className="text-sm text-text-muted">{formatBytes(originalSize)}</div>
            </div>
            <button
              type="button"
              onClick={handleClearFile}
              disabled={isBusy}
              className="text-sm px-3 py-1 border border-border rounded hover:border-primary disabled:opacity-50"
            >
              Cambiar archivo
            </button>
          </div>

          {mode === "compress" ? (
            <section aria-labelledby="level-heading" className="flex flex-col gap-3">
              <h2 id="level-heading" className="text-lg font-medium text-text">
                Nivel de compresión
              </h2>
              <LevelSelector
                levels={LEVELS}
                value={level}
                onChange={(id) => setLevel(id as CompressLevel)}
                disabled={isBusy}
              />
            </section>
          ) : (
            <section aria-labelledby="ocr-info-heading" className="flex flex-col gap-3">
              <h2 id="ocr-info-heading" className="text-lg font-medium text-text">
                Acerca de esta opción
              </h2>
              <div
                className="p-4 bg-surface border border-border rounded-lg text-sm text-text-muted"
                data-testid="ocr-info-note"
              >
                Esta opción agrega texto buscable al PDF escaneado y puede
                optimizar imágenes. No siempre reduce el tamaño del archivo;
                en algunos casos puede aumentar ligeramente.
              </div>
              <div
                className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900"
                data-testid="ocr-signature-warning"
              >
                <strong>Importante:</strong> si el PDF tiene firma digital, el
                proceso OCR puede invalidarla. No uses esta opción si necesitás
                conservar la validez de la firma.
              </div>
            </section>
          )}

          {errorMessage && (
            <p role="alert" className="text-red-600 text-sm">
              {errorMessage}
            </p>
          )}

          {isBusy && (
            <div className="flex flex-col gap-2">
              <ProgressBar pct={progress} />
              <p className="text-sm text-text-muted" aria-live="polite">
                {statusLabel[status]}
              </p>
              <button
                type="button"
                onClick={handleCancel}
                className="self-start text-sm px-3 py-1 border border-border rounded hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Cancelar
              </button>
            </div>
          )}

          {status === "complete" && jobInfo && (
            <div className="flex flex-col gap-3">
              {mode === "ocr" && (
                <div
                  className="p-3 bg-green-50 border border-green-300 rounded-lg text-sm text-green-900"
                  data-testid="ocr-success-banner"
                >
                  {statusLabel.complete}
                </div>
              )}
              {ocrGrewNote && (
                <div
                  className="p-3 bg-blue-50 border border-blue-300 rounded-lg text-sm text-blue-900"
                  data-testid="ocr-grew-note"
                >
                  {ocrGrewNote}
                </div>
              )}
              <ResultBar
                originalBytes={originalSize}
                resultBytes={jobInfo.output_bytes ?? 0}
                onDownload={handleDownload}
              />
            </div>
          )}

          {(status === "idle" || status === "complete" || status === "error") && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!file || (mode === "compress" && !level)}
              data-testid="submit-button"
              className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mode === "ocr"
                ? status === "complete"
                  ? "Aplicar OCR de nuevo"
                  : "Aplicar OCR y descargar"
                : status === "complete"
                  ? "Comprimir de nuevo"
                  : "Comprimir y descargar"}
            </button>
          )}
        </div>
      )}
    </Layout>
  );
}
