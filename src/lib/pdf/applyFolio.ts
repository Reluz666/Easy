import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    throw new Error("No se pudo leer el PDF. Verificá que no esté protegido con contraseña ni dañado.");
  }

  const fontName = FONT_MAP[config.font];
  const font: PDFFont = await pdf.embedFont(fontName);
  const color = hexToRgb(config.color);
  const { from, to, initialNumber } = config.range;
  const totalInRange = to - from + 1;
  const pages = pdf.getPages();

  for (let i = 0; i < totalInRange; i++) {
    const pageIndex = from - 1 + i;
    const page: PDFPage = pages[pageIndex];
    if (!page) continue;
    const folioNumber = initialNumber + i;
    const text = formatFolio(config.numberStyle, folioNumber, totalInRange);
    const textWidth = font.widthOfTextAtSize(text, config.fontSize);
    const { x, y } = getFolioPdfCoords(
      config.position,
      page.getWidth(),
      page.getHeight(),
      textWidth,
      config.fontSize
    );
    page.drawText(text, {
      x,
      y,
      size: config.fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
    });
  }

  return pdf.save({ useObjectStreams: false });
}
