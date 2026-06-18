import * as pdfjs from "pdfjs-dist";

// El worker de pdfjs se sirve como módulo. Configuramos la ruta desde el bundle.
// En producción (build), Vite lo maneja; en dev, usamos el worker por defecto.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export type ThumbnailOptions = {
  pageNumber: number; // 1-indexed
  scale?: number;
  maxWidth?: number;
};

export async function renderThumbnail(
  file: File,
  options: ThumbnailOptions
): Promise<string> {
  const { pageNumber, scale = 1.5, maxWidth = 240 } = options;
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo crear el contexto 2D del canvas.");

    canvas.width = Math.min(viewport.width, maxWidth);
    canvas.height = viewport.height * (canvas.width / viewport.width);

    const transform = canvas.width !== viewport.width
      ? [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0]
      : undefined;

    await page.render({ canvasContext: context, viewport, transform }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    pdf.destroy();
  }
}
