import { PDFDocument } from "pdf-lib";

export type LoadedPdf = {
  document: PDFDocument;
  pageCount: number;
  fileName: string;
  fileSize: number;
};

export async function loadPdfFromFile(file: File): Promise<LoadedPdf> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("El archivo debe ser un PDF.");
  }

  const bytes = await file.arrayBuffer();
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (err) {
    throw new Error("No se pudo leer el PDF. Verificá que no esté protegido con contraseña ni dañado.");
  }

  return {
    document,
    pageCount: document.getPageCount(),
    fileName: file.name,
    fileSize: file.size,
  };
}
