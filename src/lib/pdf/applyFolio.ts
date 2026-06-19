import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont } from "pdf-lib";
import { formatFolio } from "../format";
import { getFolioPdfCoords } from "../foliar/position";
import type { FoliarConfig, FolioFont } from "../foliar/types";

const FONT_MAP: Record<FolioFont, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
  Verdana: StandardFonts.Helvetica,
  Georgia: StandardFonts.TimesRoman,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "").match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

export async function applyFolio(
  bytes: Uint8Array,
  config: FoliarConfig
): Promise<Uint8Array> {
  let sourcePdf: PDFDocument;
  try {
    sourcePdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    throw new Error("No se pudo leer el PDF. Verificá que no esté protegido con contraseña ni dañado.");
  }

  const { from, to, initialNumber } = config.range;
  const totalInRange = to - from + 1;

  // Copy pages to a fresh document instead of modifying the source in place.
  // pdf-lib's in-place modify + save can corrupt content streams on pages
  // 2..N of PDFs with xref streams, incremental updates, or font subsets
  // (those pages render blank after the round-trip in Edge / Chrome).
  const targetPdf = await PDFDocument.create();
  const pageIndices = sourcePdf.getPageIndices();
  const copiedPages = await targetPdf.copyPages(sourcePdf, pageIndices);
  copiedPages.forEach((page) => targetPdf.addPage(page));

  const fontName = FONT_MAP[config.font];
  const font: PDFFont = await targetPdf.embedFont(fontName);
  const color = hexToRgb(config.color);
  const targetPages = targetPdf.getPages();

  for (let i = 0; i < totalInRange; i++) {
    const pageIndex = from - 1 + i;
    const page = targetPages[pageIndex];
    if (!page) continue;
    const folioNumber = initialNumber + i;
    const text = formatFolio(config.numberStyle, folioNumber, totalInRange);
    const textWidth = font.widthOfTextAtSize(text, config.fontSize);
    const { width: mediaW, height: mediaH } = page.getSize();
    const { x, y, rotate } = getFolioPdfCoords(
      config.position,
      mediaW,
      mediaH,
      textWidth,
      config.fontSize,
      page.getRotation().angle
    );
    page.drawText(text, {
      x,
      y,
      size: config.fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
      rotate: degrees(rotate),
    });
  }

  return targetPdf.save({ useObjectStreams: false });
}