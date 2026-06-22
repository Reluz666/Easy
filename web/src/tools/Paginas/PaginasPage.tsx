import { useCallback, useEffect, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import ProgressBar from "../Comprimir/ProgressBar";
import {
  type JobInfo,
  type PagesOp,
  createPagesJob,
  deleteJob,
  describeApiError,
  downloadJobResult,
  getJob,
} from "../../lib/api/jobs";
import { formatBytes } from "../../lib/format";
import { parseRange, parseOrder, formatRange } from "../../lib/pages/parseRange";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type Status = "idle" | "uploading" | "queued" | "processing" | "complete" | "error";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Listo para editar las páginas.",
  uploading: "Subiendo PDF…",
  queued: "En cola, esperando un worker libre…",
  processing: "Editando las páginas en el servidor…",
  complete: "Listo. El PDF editado está listo para descargar.",
  error: "Ocurrió un error.",
};

/**
 * UI-side representation of a `PagesOp`. The user types ranges as text
 * ("2,5,7-9") and we re-parse to the JSON shape only at submit time.
 *
 * Each row carries its own random `id` so React can key the list across
 * inserts/removes without remounting unrelated rows (otherwise focus jumps
 * when the user is mid-edit).
 */
type DraftDelete = { id: string; kind: "delete"; pagesRaw: string };
type DraftInsert = {
  id: string;
  kind: "insert";
  afterRaw: string;
  source: "main" | "extra";
  pagesRaw: string;
};
type DraftRotate = {
  id: string;
  kind: "rotate";
  pagesRaw: string;
  degrees: 90 | 180 | 270;
};
type DraftReorder = { id: string; kind: "reorder"; orderRaw: string };

type DraftOp = DraftDelete | DraftInsert | DraftRotate | DraftReorder;

function newId(): string {
  // crypto.randomUUID is in jsdom and all evergreens.
  return (
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as Crypto).randomUUID()
      : Math.random().toString(36).slice(2)
  );
}

function newDelete(): DraftDelete {
  return { id: newId(), kind: "delete", pagesRaw: "" };
}
function newInsert(source: "main" | "extra" = "main"): DraftInsert {
  return { id: newId(), kind: "insert", afterRaw: "0", source, pagesRaw: "" };
}
function newRotate(): DraftRotate {
  return { id: newId(), kind: "rotate", pagesRaw: "", degrees: 90 };
}
function newReorder(): DraftReorder {
  return { id: newId(), kind: "reorder", orderRaw: "" };
}

/**
 * Convert the UI draft list to the API-level `PagesOp[]`. Returns
 * `{ ops, error }` — if any row is invalid, `ops` is `null` and `error`
 * carries a Spanish message suitable for inline display.
 *
 * We deliberately don't try to validate against the PDF page count here:
 * the worker re-validates against the *current* state of the document at
 * each step (which may differ from the upload's initial count after prior
 * ops), and the user already gets a Spanish error via the failure path.
 */
function compileDrafts(drafts: DraftOp[]): {
  ops: PagesOp[] | null;
  error: string | null;
} {
  if (drafts.length === 0) {
    return { ops: null, error: "Agregá al menos una operación." };
  }
  const out: PagesOp[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const label = `Operación ${i + 1}`;
    if (d.kind === "delete") {
      const pages = parseRange(d.pagesRaw);
      if (!pages) {
        return { ops: null, error: `${label} (eliminar): indicá las páginas (ej: 2,5,7-9).` };
      }
      out.push({ op: "delete", pages });
    } else if (d.kind === "insert") {
      const after = Number(d.afterRaw);
      if (!Number.isInteger(after) || after < 0) {
        return {
          ops: null,
          error: `${label} (insertar): "después de" debe ser un número ≥ 0 (0 = al inicio).`,
        };
      }
      const pages = parseRange(d.pagesRaw);
      if (!pages) {
        return {
          ops: null,
          error: `${label} (insertar): indicá qué páginas del PDF origen vas a insertar.`,
        };
      }
      out.push({ op: "insert", after_page: after, from_pdf: d.source, pages });
    } else if (d.kind === "rotate") {
      const pages = parseRange(d.pagesRaw);
      if (!pages) {
        return { ops: null, error: `${label} (rotar): indicá las páginas a rotar.` };
      }
      out.push({ op: "rotate", pages, degrees: d.degrees });
    } else if (d.kind === "reorder") {
      const order = parseOrder(d.orderRaw);
      if (!order) {
        return {
          ops: null,
          error: `${label} (reordenar): indicá el nuevo orden sin duplicados (ej: 3,1,2,4).`,
        };
      }
      out.push({ op: "reorder", order });
    }
  }
  return { ops: out, error: null };
}

/** True iff any compiled op needs an `extra_file` upload. */
function draftsNeedExtra(drafts: DraftOp[]): boolean {
  return drafts.some((d) => d.kind === "insert" && d.source === "extra");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PaginasPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [extraFile, setExtraFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<DraftOp[]>([]);
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
    setExtraFile(null);
    setDrafts([]);
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
        `Este PDF es demasiado pesado (${mb} MB). El máximo permitido es ${(
          MAX_UPLOAD_BYTES /
          1024 /
          1024
        ).toFixed(0)} MB.`,
      );
      return;
    }
    setFile(selected);
    setFileName(selected.name);
    setOriginalSize(selected.size);
    setDrafts([]);
    setStatus("idle");
    setProgress(0);
    setJobInfo(null);
    setErrorMessage(null);
  }, []);

  const handleExtraFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setExtraFile(null);
      return;
    }
    if (
      f.type !== "application/pdf" &&
      !f.name.toLowerCase().endsWith(".pdf")
    ) {
      setErrorMessage("El archivo adicional debe ser un PDF.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      const mb = (f.size / 1024 / 1024).toFixed(1);
      setErrorMessage(
        `El PDF adicional es demasiado pesado (${mb} MB). El máximo permitido es ${(
          MAX_UPLOAD_BYTES /
          1024 /
          1024
        ).toFixed(0)} MB.`,
      );
      e.target.value = "";
      return;
    }
    setErrorMessage(null);
    setExtraFile(f);
  }, []);

  const handleClearFile = useCallback(() => {
    stopPolling();
    const jid = currentJobIdRef.current;
    currentJobIdRef.current = null;
    cancelledRef.current = false;
    if (jid) void deleteJob(jid);
    resetAll();
  }, [stopPolling, resetAll]);

  const addOp = useCallback((kind: DraftOp["kind"]) => {
    setDrafts((prev) => {
      if (kind === "delete") return [...prev, newDelete()];
      if (kind === "insert") return [...prev, newInsert()];
      if (kind === "rotate") return [...prev, newRotate()];
      return [...prev, newReorder()];
    });
  }, []);

  const removeOp = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const updateOp = useCallback((id: string, patch: Partial<DraftOp>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? ({ ...d, ...patch } as DraftOp) : d)),
    );
  }, []);

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
            info.error_message ??
              "El servidor rechazó la operación o falló al editar las páginas.",
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

    const compiled = compileDrafts(drafts);
    if (!compiled.ops) {
      setErrorMessage(compiled.error);
      setStatus("error");
      return;
    }
    if (draftsNeedExtra(drafts) && !extraFile) {
      setErrorMessage(
        "Una de las inserciones lee de un PDF adicional, pero no cargaste ninguno.",
      );
      setStatus("error");
      return;
    }

    cancelledRef.current = false;
    setStatus("uploading");
    setProgress(0);
    setErrorMessage(null);
    setJobInfo(null);

    let jobId: string;
    try {
      jobId = await createPagesJob(file, compiled.ops, extraFile);
    } catch (err) {
      setErrorMessage(describeApiError(err));
      setStatus("error");
      return;
    }

    currentJobIdRef.current = jobId;
    await pollOnce(jobId);
  }, [file, drafts, extraFile, status, pollOnce]);

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

  const isBusy = status === "uploading" || status === "queued" || status === "processing";
  const canSubmit = !!file && !isBusy && drafts.length > 0;
  const needsExtra = draftsNeedExtra(drafts);

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-2">Páginas</h1>
      <p className="text-text-muted mb-6">
        Eliminá, insertá, rotá o reordená páginas del PDF.
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

          {needsExtra && (
            <section
              aria-labelledby="paginas-extra-heading"
              className="flex flex-col gap-2 p-4 bg-surface border border-border rounded-lg"
            >
              <h2 id="paginas-extra-heading" className="text-sm font-semibold text-text">
                PDF adicional para insertar páginas
              </h2>
              <p className="text-xs text-text-muted">
                Tenés una inserción que lee de un PDF adicional. Subí ese segundo
                archivo acá.
              </p>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleExtraFile}
                disabled={isBusy}
                data-testid="paginas-extra-file"
                className="text-sm"
              />
              {extraFile && (
                <div className="text-xs text-text-muted">
                  {extraFile.name} · {formatBytes(extraFile.size)}
                </div>
              )}
            </section>
          )}

          <section
            aria-labelledby="paginas-ops-heading"
            className="flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h2 id="paginas-ops-heading" className="text-lg font-medium text-text">
                Operaciones
              </h2>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => addOp("delete")}
                  disabled={isBusy}
                  data-testid="paginas-add-delete"
                  className="text-xs px-2 py-1 border border-border rounded hover:border-primary disabled:opacity-50"
                >
                  + Eliminar
                </button>
                <button
                  type="button"
                  onClick={() => addOp("insert")}
                  disabled={isBusy}
                  data-testid="paginas-add-insert"
                  className="text-xs px-2 py-1 border border-border rounded hover:border-primary disabled:opacity-50"
                >
                  + Insertar
                </button>
                <button
                  type="button"
                  onClick={() => addOp("rotate")}
                  disabled={isBusy}
                  data-testid="paginas-add-rotate"
                  className="text-xs px-2 py-1 border border-border rounded hover:border-primary disabled:opacity-50"
                >
                  + Rotar
                </button>
                <button
                  type="button"
                  onClick={() => addOp("reorder")}
                  disabled={isBusy}
                  data-testid="paginas-add-reorder"
                  className="text-xs px-2 py-1 border border-border rounded hover:border-primary disabled:opacity-50"
                >
                  + Reordenar
                </button>
              </div>
            </div>

            {drafts.length === 0 ? (
              <p className="text-sm text-text-muted bg-surface border border-dashed border-border rounded-lg p-4 text-center">
                Todavía no agregaste ninguna operación. Usá los botones de arriba.
              </p>
            ) : (
              <ol className="flex flex-col gap-3" data-testid="paginas-ops-list">
                {drafts.map((d, idx) => (
                  <li
                    key={d.id}
                    data-testid={`paginas-op-${idx}`}
                    className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted">#{idx + 1}</span>
                        <span className="text-sm font-medium text-text">
                          {d.kind === "delete" && "Eliminar páginas"}
                          {d.kind === "insert" && "Insertar páginas"}
                          {d.kind === "rotate" && "Rotar páginas"}
                          {d.kind === "reorder" && "Reordenar páginas"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOp(d.id)}
                        disabled={isBusy}
                        aria-label={`Quitar operación ${idx + 1}`}
                        data-testid={`paginas-op-${idx}-remove`}
                        className="text-xs px-2 py-1 border border-border rounded hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        Quitar
                      </button>
                    </div>

                    {d.kind === "delete" && (
                      <DraftDeleteRow
                        draft={d}
                        idx={idx}
                        disabled={isBusy}
                        onUpdate={(patch) => updateOp(d.id, patch)}
                      />
                    )}
                    {d.kind === "insert" && (
                      <DraftInsertRow
                        draft={d}
                        idx={idx}
                        disabled={isBusy}
                        onUpdate={(patch) => updateOp(d.id, patch)}
                      />
                    )}
                    {d.kind === "rotate" && (
                      <DraftRotateRow
                        draft={d}
                        idx={idx}
                        disabled={isBusy}
                        onUpdate={(patch) => updateOp(d.id, patch)}
                      />
                    )}
                    {d.kind === "reorder" && (
                      <DraftReorderRow
                        draft={d}
                        idx={idx}
                        disabled={isBusy}
                        onUpdate={(patch) => updateOp(d.id, patch)}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-text-muted">
              Las operaciones se aplican en orden. Los números de página se
              refieren al estado <em>actual</em> del PDF al momento de aplicar
              cada operación.
            </p>
          </section>

          {errorMessage && (
            <p role="alert" className="text-red-600 text-sm" data-testid="paginas-error">
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
            <div
              className="flex flex-col gap-3 p-4 bg-surface border border-border rounded-lg"
              data-testid="paginas-result"
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="text-text-muted">
                  Original:{" "}
                  <strong className="text-text">{formatBytes(originalSize)}</strong>
                </span>
                <span aria-hidden="true">→</span>
                <span className="text-text-muted">
                  Resultado:{" "}
                  <strong className="text-text">
                    {formatBytes(jobInfo.output_bytes ?? 0)}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={handleDownload}
                className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Descargar PDF editado
              </button>
            </div>
          )}

          {(status === "idle" || status === "complete" || status === "error") && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="paginas-submit"
              className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "complete" ? "Editar de nuevo" : "Aplicar y descargar"}
            </button>
          )}
        </div>
      )}
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Per-op editor rows
// ---------------------------------------------------------------------------
const INPUT_CLASS =
  "bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50";

function RangeHint({ raw }: { raw: string }) {
  const parsed = parseRange(raw);
  if (parsed === null) return null;
  return (
    <p className="text-xs text-text-muted">
      Páginas: {formatRange(parsed)} ({parsed.length})
    </p>
  );
}

function DraftDeleteRow({
  draft,
  idx,
  disabled,
  onUpdate,
}: {
  draft: DraftDelete;
  idx: number;
  disabled: boolean;
  onUpdate: (patch: Partial<DraftDelete>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`del-pages-${idx}`}
        className="text-xs text-text-muted"
      >
        Páginas a eliminar (ej: 2,5,7-9)
      </label>
      <input
        id={`del-pages-${idx}`}
        type="text"
        value={draft.pagesRaw}
        disabled={disabled}
        placeholder="2,5,7-9"
        onChange={(e) => onUpdate({ pagesRaw: e.target.value })}
        data-testid={`paginas-op-${idx}-pages`}
        className={INPUT_CLASS}
      />
      <RangeHint raw={draft.pagesRaw} />
    </div>
  );
}

function DraftInsertRow({
  draft,
  idx,
  disabled,
  onUpdate,
}: {
  draft: DraftInsert;
  idx: number;
  disabled: boolean;
  onUpdate: (patch: Partial<DraftInsert>) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`ins-after-${idx}`} className="text-xs text-text-muted">
          Después de la página
        </label>
        <input
          id={`ins-after-${idx}`}
          type="number"
          min={0}
          value={draft.afterRaw}
          disabled={disabled}
          onChange={(e) => onUpdate({ afterRaw: e.target.value })}
          data-testid={`paginas-op-${idx}-after`}
          className={INPUT_CLASS}
        />
        <p className="text-xs text-text-muted">0 = al inicio.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">Origen</label>
        <div className="flex gap-1" role="radiogroup" aria-label="Origen del PDF">
          {(["main", "extra"] as const).map((src) => (
            <button
              key={src}
              type="button"
              role="radio"
              aria-checked={draft.source === src}
              disabled={disabled}
              onClick={() => onUpdate({ source: src })}
              data-testid={`paginas-op-${idx}-source-${src}`}
              className={`flex-1 px-3 py-1.5 text-sm rounded border transition-colors disabled:opacity-50 ${
                draft.source === src
                  ? "bg-primary-light border-primary text-primary"
                  : "bg-surface border-border text-text hover:border-primary"
              }`}
            >
              {src === "main" ? "Mismo PDF" : "Otro PDF"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`ins-pages-${idx}`} className="text-xs text-text-muted">
          Páginas a insertar (del origen)
        </label>
        <input
          id={`ins-pages-${idx}`}
          type="text"
          value={draft.pagesRaw}
          disabled={disabled}
          placeholder="1,3-5"
          onChange={(e) => onUpdate({ pagesRaw: e.target.value })}
          data-testid={`paginas-op-${idx}-pages`}
          className={INPUT_CLASS}
        />
        <RangeHint raw={draft.pagesRaw} />
      </div>
    </div>
  );
}

function DraftRotateRow({
  draft,
  idx,
  disabled,
  onUpdate,
}: {
  draft: DraftRotate;
  idx: number;
  disabled: boolean;
  onUpdate: (patch: Partial<DraftRotate>) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`rot-pages-${idx}`} className="text-xs text-text-muted">
          Páginas a rotar
        </label>
        <input
          id={`rot-pages-${idx}`}
          type="text"
          value={draft.pagesRaw}
          disabled={disabled}
          placeholder="1-3"
          onChange={(e) => onUpdate({ pagesRaw: e.target.value })}
          data-testid={`paginas-op-${idx}-pages`}
          className={INPUT_CLASS}
        />
        <RangeHint raw={draft.pagesRaw} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">Grados</label>
        <div className="flex gap-1" role="radiogroup" aria-label="Grados">
          {([90, 180, 270] as const).map((deg) => (
            <button
              key={deg}
              type="button"
              role="radio"
              aria-checked={draft.degrees === deg}
              disabled={disabled}
              onClick={() => onUpdate({ degrees: deg })}
              data-testid={`paginas-op-${idx}-degrees-${deg}`}
              className={`flex-1 px-3 py-1.5 text-sm rounded border transition-colors disabled:opacity-50 ${
                draft.degrees === deg
                  ? "bg-primary-light border-primary text-primary"
                  : "bg-surface border-border text-text hover:border-primary"
              }`}
            >
              {deg}°
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DraftReorderRow({
  draft,
  idx,
  disabled,
  onUpdate,
}: {
  draft: DraftReorder;
  idx: number;
  disabled: boolean;
  onUpdate: (patch: Partial<DraftReorder>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`reo-order-${idx}`} className="text-xs text-text-muted">
        Nuevo orden (permutación completa, ej: 3,1,2,4)
      </label>
      <input
        id={`reo-order-${idx}`}
        type="text"
        value={draft.orderRaw}
        disabled={disabled}
        placeholder="3,1,2,4"
        onChange={(e) => onUpdate({ orderRaw: e.target.value })}
        data-testid={`paginas-op-${idx}-order`}
        className={INPUT_CLASS}
      />
      <p className="text-xs text-text-muted">
        Debe incluir cada página del PDF actual exactamente una vez.
      </p>
    </div>
  );
}
