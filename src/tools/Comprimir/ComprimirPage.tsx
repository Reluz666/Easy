import { useCallback, useEffect, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import { loadPdfFromFile } from "../../lib/pdf/load";
import { downloadBlob, suggestFileName } from "../../lib/pdf/download";
import LevelSelector, { type LevelDescriptor } from "./LevelSelector";
import ProgressBar from "./ProgressBar";
import ResultBar from "./ResultBar";
import {
  COMPRESS_TIMEOUT_MS,
  MAX_COMPRESS_BYTES,
  formatSizeLimitMessage,
  formatTimeoutMessage,
} from "./compress.limits";
import { logCompressMetric } from "./compress.metrics";
import type {
  CompressLevel,
  CompressRequest,
  CompressResponse,
} from "./compress.protocol";
// Vite's ?worker syntax: imports the worker as a constructor.
import CompressWorker from "./compress.worker.ts?worker";

const LEVELS: readonly LevelDescriptor[] = [
  { id: "baja", label: "Baja", description: "Casi sin pérdida visible (~10-20% menos)" },
  { id: "media", label: "Media", description: "Balance recomendado (~40-60% menos)" },
  { id: "alta", label: "Alta", description: "Máxima reducción (~70-85% menos)" },
];

type Status = "idle" | "compressing" | "complete" | "error";

export default function ComprimirPage() {
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [level, setLevel] = useState<CompressLevel | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [resultBytes, setResultBytes] = useState<Uint8Array | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register the COI service worker once on mount.
  useEffect(() => {
    import("../../lib/coi").then(({ registerCoiServiceWorker }) => {
      registerCoiServiceWorker();
    });
  }, []);

  // Cleanup worker and pending timeout on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const clearCompressionTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const handleFile = useCallback(async (file: File) => {
    // Size check FIRST, before allocating the file buffer. Browsers will
    // happily read 200MB into RAM just to fail a structural check, which
    // is what makes heavy-PDF cases pathological.
    if (file.size > MAX_COMPRESS_BYTES) {
      logCompressMetric({
        status: "too-large",
        fileName: file.name,
        originalSize: file.size,
        level: "media",
        timestamp: new Date().toISOString(),
        error: formatSizeLimitMessage(file.size),
      });
      setErrorMessage(formatSizeLimitMessage(file.size));
      return;
    }
    try {
      const loaded = await loadPdfFromFile(file);
      const bytes = await loaded.document.save();
      setFileBytes(bytes);
      setFileName(loaded.fileName);
      setOriginalSize(loaded.fileSize);
      setLevel(null);
      setStatus("idle");
      setResultBytes(null);
      setErrorMessage(null);
      setProgress(0);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo leer el PDF.",
      );
    }
  }, []);

  const handleClearFile = useCallback(() => {
    setFileBytes(null);
    setFileName("");
    setOriginalSize(0);
    setLevel(null);
    setStatus("idle");
    setResultBytes(null);
    setErrorMessage(null);
    setProgress(0);
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const handleCompress = useCallback(() => {
    if (status === "compressing") return;
    if (!fileBytes || !level) return;
    if (workerRef.current) workerRef.current.terminate();

    const startTime = performance.now();
    const activeLevel = level;

    // Hard timeout: if GS hasn't reported complete by COMPRESS_TIMEOUT_MS,
    // kill the worker. WASM is browser-cached so the next attempt is cheap.
    const timeoutId = setTimeout(() => {
      timeoutRef.current = null;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      const message = formatTimeoutMessage();
      const durationMs = performance.now() - startTime;
      logCompressMetric({
        status: "timeout",
        fileName,
        originalSize,
        level: activeLevel,
        durationMs,
        error: message,
        timestamp: new Date().toISOString(),
      });
      setErrorMessage(message);
      setStatus("error");
      setProgress(0);
    }, COMPRESS_TIMEOUT_MS);
    timeoutRef.current = timeoutId;

    const worker = new CompressWorker();
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<CompressResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case "progress":
          setProgress(msg.pct);
          break;
        case "complete": {
          clearCompressionTimeout();
          const resultSize = msg.bytes.byteLength;
          const reductionPct =
            originalSize > 0
              ? ((originalSize - resultSize) / originalSize) * 100
              : 0;
          logCompressMetric({
            status: "success",
            fileName,
            originalSize,
            level: activeLevel,
            durationMs: performance.now() - startTime,
            resultSize,
            reductionPct,
            timestamp: new Date().toISOString(),
          });
          setResultBytes(msg.bytes);
          setStatus("complete");
          setProgress(100);
          worker.terminate();
          workerRef.current = null;
          break;
        }
        case "error": {
          clearCompressionTimeout();
          logCompressMetric({
            status: "error",
            fileName,
            originalSize,
            level: activeLevel,
            durationMs: performance.now() - startTime,
            error: msg.message,
            timestamp: new Date().toISOString(),
          });
          setErrorMessage(msg.message);
          setStatus("error");
          setProgress(0);
          worker.terminate();
          workerRef.current = null;
          break;
        }
      }
    };

    worker.onerror = (e) => {
      clearCompressionTimeout();
      const message = e.message || "Error desconocido en el worker.";
      logCompressMetric({
        status: "error",
        fileName,
        originalSize,
        level: activeLevel,
        durationMs: performance.now() - startTime,
        error: message,
        timestamp: new Date().toISOString(),
      });
      setErrorMessage(message);
      setStatus("error");
    };

    setStatus("compressing");
    setProgress(0);
    setErrorMessage(null);
    setResultBytes(null);

    const request: CompressRequest = { type: "compress", bytes: fileBytes, level: activeLevel };
    worker.postMessage(request);
  }, [fileBytes, level, status, fileName, originalSize, clearCompressionTimeout]);

  const handleCancel = useCallback(() => {
    // worker.terminate() kills the GS process mid-run. Any in-flight
    // module.run() is interrupted; the next compression creates a fresh
    // worker (WASM is browser-cached so the cost is small).
    clearCompressionTimeout();
    logCompressMetric({
      status: "cancelled",
      fileName,
      originalSize,
      level: level ?? "media",
      timestamp: new Date().toISOString(),
    });
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus("idle");
    setProgress(0);
  }, [fileName, originalSize, level, clearCompressionTimeout]);

  const handleDownload = useCallback(() => {
    if (!resultBytes || !fileName) return;
    // Copy into a fresh ArrayBuffer so the Blob constructor accepts it
    // (Worker postMessage can return Uint8Array<SharedArrayBuffer>, which
    // BlobPart does not allow directly).
    const buf = new ArrayBuffer(resultBytes.byteLength);
    new Uint8Array(buf).set(resultBytes);
    const blob = new Blob([buf], { type: "application/pdf" });
    downloadBlob(blob, suggestFileName(fileName, "comprimido"));
  }, [resultBytes, fileName]);

  const isCompressing = status === "compressing";

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-2">Comprimir</h1>
      <p className="text-text-muted mb-4">
        Reducí el tamaño de un PDF eligiendo un nivel de compresión.
      </p>

      {!fileBytes ? (
        <UploadArea onFileSelected={handleFile} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 p-3 bg-surface border border-border rounded-lg">
            <div>
              <div className="font-medium text-text truncate">{fileName}</div>
              <div className="text-sm text-text-muted">
                {(originalSize / (1024 * 1024)).toFixed(1)} MB
              </div>
            </div>
            <button
              type="button"
              onClick={handleClearFile}
              disabled={isCompressing}
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
              disabled={isCompressing}
            />
          </section>

          {errorMessage && (
            <p role="alert" className="text-red-600 text-sm">
              {errorMessage}
            </p>
          )}

          {isCompressing && (
            <div className="flex flex-col gap-2">
              <ProgressBar pct={progress} />
              <button
                type="button"
                onClick={handleCancel}
                className="self-start text-sm px-3 py-1 border border-border rounded hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Cancelar
              </button>
            </div>
          )}

          {status === "complete" && resultBytes && (
            <ResultBar
              originalBytes={originalSize}
              resultBytes={resultBytes.byteLength}
              onDownload={handleDownload}
            />
          )}

          {status === "idle" && (
            <button
              type="button"
              onClick={handleCompress}
              disabled={!level}
              className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Comprimir y descargar
            </button>
          )}
        </div>
      )}
    </Layout>
  );
}