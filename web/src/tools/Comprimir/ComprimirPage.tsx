import { useCallback, useEffect, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import LevelSelector, { type LevelDescriptor } from "./LevelSelector";
import ProgressBar from "./ProgressBar";
import ResultBar from "./ResultBar";
import {
  type CompressLevel,
  type JobInfo,
  createCompressJob,
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

type Status =
  | "idle"
  | "uploading"
  | "queued"
  | "processing"
  | "complete"
  | "error";

export default function ComprimirPage() {
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
        } else if (info.status === "failed") {
          stopPolling();
          setStatus("error");
          const backendMsg =
            info.error_message ??
            "El servidor rechazó el archivo o falló durante el procesamiento.";
          logCompressMetric({
            status: "error",
            fileName,
            originalSize,
            level: level ?? "media",
            durationMs: info.duration_ms ?? undefined,
            error: `${info.error_code ?? "UNKNOWN"}: ${backendMsg}`,
            timestamp: new Date().toISOString(),
          });
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
          status: "error",
          fileName,
          originalSize,
          level: level ?? "media",
          error: message,
          timestamp: new Date().toISOString(),
        });
        setErrorMessage(message);
        setStatus("error");
      }
    },
    [fileName, originalSize, level, stopPolling],
  );

  const handleCompress = useCallback(async () => {
    if (!file || !level) return;
    if (status !== "idle" && status !== "complete" && status !== "error") return;

    cancelledRef.current = false;
    setStatus("uploading");
    setProgress(0);
    setErrorMessage(null);
    setJobInfo(null);

    const startTime = performance.now();
    let jobId: string;
    try {
      jobId = await createCompressJob(file, level);
    } catch (err) {
      const message = describeApiError(err);
      logCompressMetric({
        status: "error",
        fileName,
        originalSize,
        level,
        durationMs: performance.now() - startTime,
        error: message,
        timestamp: new Date().toISOString(),
      });
      setErrorMessage(message);
      setStatus("error");
      return;
    }

    currentJobIdRef.current = jobId;
    // Move straight to the queued/processing poll loop — the upload itself
    // has already completed at this point.
    await pollOnce(jobId);
  }, [file, level, status, fileName, originalSize, pollOnce]);

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
      timestamp: new Date().toISOString(),
    });
    setStatus("idle");
    setProgress(0);
  }, [fileName, originalSize, level, stopPolling]);

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

  const statusLabel: Record<Status, string> = {
    idle: "Listo para comprimir.",
    uploading: "Subiendo archivo…",
    queued: "En cola, esperando un worker libre…",
    processing: "Procesando en el servidor…",
    complete: "Listo.",
    error: "Ocurrió un error.",
  };

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-2">Comprimir</h1>
      <p className="text-text-muted mb-4">
        Reducí el tamaño de un PDF eligiendo un nivel de compresión.
      </p>

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
            <ResultBar
              originalBytes={originalSize}
              resultBytes={jobInfo.output_bytes ?? 0}
              onDownload={handleDownload}
            />
          )}

          {(status === "idle" || status === "complete" || status === "error") && (
            <button
              type="button"
              onClick={handleCompress}
              disabled={!level || !file}
              className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "complete" ? "Comprimir de nuevo" : "Comprimir y descargar"}
            </button>
          )}
        </div>
      )}
    </Layout>
  );
}