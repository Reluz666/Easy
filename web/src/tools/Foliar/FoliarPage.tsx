import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import ProgressBar from "../Comprimir/ProgressBar";
import ResultBar from "../Comprimir/ResultBar";
import {
  type JobInfo,
  createFoliateJob,
  deleteJob,
  describeApiError,
  downloadJobResult,
  getJob,
} from "../../lib/api/jobs";
import { formatBytes } from "../../lib/format";
import { DEFAULT_FOLIAR_CONFIG, type FoliarConfig } from "../../lib/foliar/types";
import { validateFoliateConfig } from "../../lib/foliar/validation";
import FoliarConfigPanel from "./FoliarConfig";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type Status = "idle" | "uploading" | "queued" | "processing" | "complete" | "error";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Listo para foliar.",
  uploading: "Subiendo PDF…",
  queued: "En cola, esperando un worker libre…",
  processing: "Aplicando folio en el servidor…",
  complete: "Foliado. El PDF ya tiene números de página.",
  error: "Ocurrió un error.",
};

export default function FoliarPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [config, setConfig] = useState<FoliarConfig>(DEFAULT_FOLIAR_CONFIG);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const cancelledRef = useRef<boolean>(false);

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
    setConfig(DEFAULT_FOLIAR_CONFIG);
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
    setConfig(DEFAULT_FOLIAR_CONFIG);
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
        } else if (info.status === "failed") {
          stopPolling();
          setStatus("error");
          setErrorMessage(
            info.error_message ?? "El servidor rechazó el archivo o falló durante el procesamiento.",
          );
        } else if (info.status === "queued") {
          setStatus("queued");
          pollTimerRef.current = setTimeout(() => void pollOnce(jobId), 1000);
        } else {
          setStatus("processing");
          pollTimerRef.current = setTimeout(() => void pollOnce(jobId), 1000);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        stopPolling();
        setErrorMessage(describeApiError(err));
        setStatus("error");
      }
    },
    [stopPolling],
  );

  const handleSubmit = useCallback(async () => {
    if (!file) return;
    if (status !== "idle" && status !== "complete" && status !== "error") return;

    cancelledRef.current = false;
    setStatus("uploading");
    setProgress(0);
    setErrorMessage(null);
    setJobInfo(null);

    let jobId: string;
    try {
      jobId = await createFoliateJob(file, {
        initial_number: config.initial_number,
        prefix: config.prefix,
        position: config.position,
        font_size: config.font_size,
        range_mode: config.range_mode,
        from_page: config.range_mode === "from-to" ? config.from_page : null,
        to_page: config.range_mode === "from-to" ? config.to_page : null,
      });
    } catch (err) {
      setErrorMessage(describeApiError(err));
      setStatus("error");
      return;
    }

    currentJobIdRef.current = jobId;
    await pollOnce(jobId);
  }, [file, config, status, pollOnce]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    stopPolling();
    const jid = currentJobIdRef.current;
    currentJobIdRef.current = null;
    if (jid) void deleteJob(jid);
    setStatus("idle");
    setProgress(0);
  }, [stopPolling]);

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

  // Page count is unknown client-side without parsing the PDF; we let
  // the backend enforce bounds and surface out-of-range failures via
  // status=failed + INVALID_PAGE_RANGE. We *do* validate the range shape so the
  // user gets instant feedback on inverted/missing bounds without an upload.
  const rangeError = useMemo(() => validateFoliateConfig(config, null), [config]);
  const isBusy = status === "uploading" || status === "queued" || status === "processing";
  const canSubmit = !!file && !isBusy;

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-2">Foliar</h1>
      <p className="text-text-muted mb-6">Numerá las páginas de un PDF.</p>

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

          <section aria-labelledby="foliar-config-heading" className="flex flex-col gap-3">
            <h2 id="foliar-config-heading" className="text-lg font-medium text-text">
              Configuración del folio
            </h2>
            <div className="bg-surface border border-border rounded-lg p-4">
              <FoliarConfigPanel
                config={config}
                totalPages={null}
                rangeError={rangeError}
                onChange={setConfig}
                disabled={isBusy}
              />
            </div>
          </section>

          {errorMessage && (
            <p role="alert" className="text-red-600 text-sm" data-testid="foliar-error">
              {errorMessage}
            </p>
          )}

          {isBusy && (
            <div className="flex flex-col gap-2">
              <ProgressBar pct={progress} />
              <p className="text-sm text-text-muted" aria-live="polite">
                {STATUS_LABEL[status]}
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
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="submit-button"
              className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "complete" ? "Foliar de nuevo" : "Foliar y descargar"}
            </button>
          )}
        </div>
      )}
    </Layout>
  );
}
