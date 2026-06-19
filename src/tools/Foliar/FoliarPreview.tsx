import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { formatFolio } from "../../lib/format";
import type { FoliarConfig, FolioPosition } from "../../lib/foliar/types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type FoliarPreviewProps = {
  bytes: Uint8Array;
  pageNumber: number; // 1-indexed
  pageCount: number;
  config: FoliarConfig;
  onPageChange: (page: number) => void;
};

type Anchor = "top" | "middle" | "bottom";
type Align = "left" | "center" | "right";

function getCanvasCoords(
  position: FolioPosition,
  canvasWidth: number,
  canvasHeight: number,
  textWidth: number,
  textHeight: number,
  margin: number
): { x: number; y: number } {
  const [valign, halign] = position.split("-") as [Anchor, Align];

  let x: number;
  if (halign === "left") x = margin;
  else if (halign === "right") x = canvasWidth - textWidth - margin;
  else x = (canvasWidth - textWidth) / 2;

  let y: number;
  if (valign === "top") y = margin;
  else if (valign === "bottom") y = canvasHeight - textHeight - margin;
  else y = (canvasHeight - textHeight) / 2;

  return { x, y };
}

export default function FoliarPreview({
  bytes,
  pageNumber,
  pageCount,
  config,
  onPageChange,
}: FoliarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pdf: pdfjs.PDFDocumentProxy | null = null;

    async function render() {
      if (!canvasRef.current) return;
      setRendering(true);
      setError(null);
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) {
        setError("No se pudo crear el contexto 2D del canvas.");
        setRendering(false);
        return;
      }

      try {
        // Copy bytes because pdfjs may consume/detach the buffer
        const data = bytes.slice().buffer;
        const loadingTask = pdfjs.getDocument({ data });
        pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (cancelled) return;

        // Overlay folio if page is in range
        const inRange = pageNumber >= config.range.from && pageNumber <= config.range.to;
        if (inRange) {
          const folioIndex = pageNumber - config.range.from;
          const folioNumber = config.range.initialNumber + folioIndex;
          const totalInRange = config.range.to - config.range.from + 1;
          const text = formatFolio(config.numberStyle, folioNumber, totalInRange);
          const fontSize = config.fontSize * 1.5; // scale for canvas
          context.font = `${fontSize}px ${config.font}`;
          const metrics = context.measureText(text);
          const textWidth = metrics.width;
          const textHeight = fontSize;
          const margin = 16; // canvas px
          const { x, y } = getCanvasCoords(config.position, canvas.width, canvas.height, textWidth, textHeight, margin);
          context.fillStyle = config.color;
          context.textBaseline = "top";
          context.fillText(text, x, y);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error al renderizar la vista previa.");
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }

    render();

    return () => {
      cancelled = true;
      if (pdf) {
        pdf.cleanup().catch(() => {});
      }
    };
  }, [bytes, pageNumber, config]);

  return (
    <div className="bg-surface border border-border rounded-lg p-4 flex flex-col items-center">
      <canvas
        ref={canvasRef}
        className="max-w-full h-auto border border-border"
        aria-label={`Vista previa página ${pageNumber} de ${pageCount}`}
      />
      {error && (
        <p role="alert" className="text-red-600 text-sm mt-2">{error}</p>
      )}
      <div className="flex items-center gap-2 mt-3" role="group" aria-label="Navegación de páginas">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, pageNumber - 1))}
          disabled={pageNumber <= 1}
          aria-label="Página anterior"
          className="px-3 py-1 text-sm bg-surface border border-border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          ◀
        </button>
        <span className="text-sm text-text-muted">
          Página {pageNumber} de {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, pageNumber + 1))}
          disabled={pageNumber >= pageCount}
          aria-label="Página siguiente"
          className="px-3 py-1 text-sm bg-surface border border-border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          ▶
        </button>
      </div>
      {rendering && <p className="text-xs text-text-muted mt-1" aria-live="polite">Renderizando…</p>}
    </div>
  );
}
