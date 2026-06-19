import { useEffect, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import FileBar from "./FileBar";
import FoliarConfigPanel from "./FoliarConfig";
import FoliarPreview from "./FoliarPreview";
import { loadPdfFromFile, type LoadedPdf } from "../../lib/pdf/load";
import { downloadBlob, suggestFileName, type NameSuffix } from "../../lib/pdf/download";
import { DEFAULT_FOLIAR_CONFIG, type FoliarConfig } from "../../lib/foliar/types";
import { validateFolioRange } from "../../lib/foliar/validation";
import FoliarWorker from "./foliar.worker.ts?worker";
import type { FoliarRequest, FoliarResponse } from "./foliar.protocol";

const SUFFIX: NameSuffix = "foliado";

type LoadedState = {
  loaded: LoadedPdf;
  bytes: Uint8Array;
};

export default function FoliarPage() {
  const [state, setState] = useState<LoadedState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [config, setConfig] = useState<FoliarConfig>(DEFAULT_FOLIAR_CONFIG);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Initialize config.to when a new PDF is loaded
  useEffect(() => {
    if (state) {
      setConfig((c) => ({
        ...c,
        range: { ...c.range, from: 1, to: state.loaded.pageCount },
      }));
      setCurrentPage(1);
    }
  }, [state]);

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  async function handleFileSelected(file: File) {
    setLoadError(null);
    try {
      const loaded = await loadPdfFromFile(file);
      const bytes = await loaded.document.save();
      setState({ loaded, bytes });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar el PDF.");
    }
  }

  function handleChangeFile() {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setProcessing(false);
    setProgress(null);
    setProcessError(null);
    setState(null);
    setCurrentPage(1);
  }

  function handleGenerate() {
    if (!state) return;
    if (rangeError) return;

    const total = config.range.to - config.range.from + 1;
    setProcessing(true);
    setProgress({ current: 0, total });
    setProcessError(null);

    const worker = new FoliarWorker();
    workerRef.current = worker;

    worker.addEventListener("message", (e: MessageEvent<FoliarResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress({ current: msg.current, total: msg.total });
      } else if (msg.type === "complete") {
        const blob = new Blob([msg.bytes], { type: "application/pdf" });
        downloadBlob(blob, suggestFileName(state.loaded.fileName, SUFFIX));
        setProcessing(false);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      } else if (msg.type === "cancelled") {
        setProcessing(false);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      } else if (msg.type === "error") {
        setProcessError(msg.message);
        setProcessing(false);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      }
    });

    const request: FoliarRequest = {
      type: "process",
      fileBytes: state.bytes,
      config,
    };
    worker.postMessage(request);
  }

  function handleCancel() {
    if (workerRef.current) {
      const cancel: FoliarRequest = { type: "cancel" };
      workerRef.current.postMessage(cancel);
    }
  }

  const rangeError = state ? validateFolioRange(config.range, state.loaded.pageCount) : null;
  const canGenerate = state && !rangeError && !processing;

  if (!state) {
    return (
      <Layout>
        <h1 className="text-2xl font-semibold text-text mb-2">Foliar</h1>
        <p className="text-text-muted mb-6">Numerar las páginas de un PDF.</p>
        <UploadArea onFileSelected={handleFileSelected} />
        {loadError && (
          <p role="alert" className="text-red-600 text-sm mt-3">{loadError}</p>
        )}
      </Layout>
    );
  }

  const { loaded, bytes } = state;

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-4">Foliar</h1>

      <div className="mb-4">
        <FileBar
          fileName={loaded.fileName}
          fileSize={loaded.fileSize}
          pageCount={loaded.pageCount}
          onChangeFile={handleChangeFile}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        <FoliarPreview
          bytes={bytes}
          pageNumber={currentPage}
          pageCount={loaded.pageCount}
          config={config}
          onPageChange={setCurrentPage}
        />
        <div className="bg-surface border border-border rounded-lg p-4">
          <h2 className="font-semibold text-text mb-4 pb-2 border-b border-border">Configuración del folio</h2>
          <FoliarConfigPanel
            config={config}
            totalPages={loaded.pageCount}
            rangeError={rangeError}
            onChange={setConfig}
          />
          <div className="mt-4 pt-4 border-t border-border">
            {processError && (
              <p role="alert" className="text-red-600 text-sm mb-2">{processError}</p>
            )}
            {processing && progress && (
              <div className="mb-3" aria-live="polite">
                <div className="text-xs text-text-muted mb-1">
                  Procesando {progress.current} de {progress.total}…
                </div>
                <div
                  className="h-2 bg-bg rounded overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progress.current}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                >
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="mt-2 w-full text-sm bg-surface border border-border text-text px-3 py-1.5 rounded hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  Cancelar
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full bg-primary text-white px-4 py-2 rounded font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {processing ? "Procesando…" : "Generar PDF foliado"}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
