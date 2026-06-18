/// <reference lib="webworker" />
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatFolio } from "../../lib/format";
import { getFolioPdfCoords } from "../../lib/foliar/position";
import type { FolioFont } from "../../lib/foliar/types";
import type { FoliarRequest, FoliarResponse } from "./foliar.protocol";

const FONT_MAP: Record<FolioFont, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
  Verdana: StandardFonts.Helvetica,
  Georgia: StandardFonts.TimesRoman,
};

const BATCH_SIZE = 15;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "").match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

let cancelled = false;

self.addEventListener("message", async (e: MessageEvent<FoliarRequest>) => {
  if (e.data.type === "cancel") {
    cancelled = true;
    return;
  }

  if (e.data.type !== "process") return;
  cancelled = false;

  const { fileBytes, config } = e.data;

  try {
    const pdf = await PDFDocument.load(fileBytes, { ignoreEncryption: false });
    const totalInRange = config.range.to - config.range.from + 1;
    const font: PDFFont = await pdf.embedFont(FONT_MAP[config.font]);
    const color = hexToRgb(config.color);
    const pages = pdf.getPages();

    for (let batchStart = 0; batchStart < totalInRange; batchStart += BATCH_SIZE) {
      if (cancelled) {
        const response: FoliarResponse = { type: "cancelled" };
        self.postMessage(response);
        return;
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalInRange);
      for (let i = batchStart; i < batchEnd; i++) {
        const pageIndex = config.range.from - 1 + i;
        const page: PDFPage = pages[pageIndex];
        if (!page) continue;
        const folioNumber = config.range.initialNumber + i;
        const text = formatFolio(config.format, folioNumber, totalInRange, config.numberStyle);
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

      const progress: FoliarResponse = { type: "progress", current: batchEnd, total: totalInRange };
      self.postMessage(progress);
    }

    const bytes = await pdf.save();
    const complete: FoliarResponse = { type: "complete", bytes };
    self.postMessage(complete);
  } catch (err) {
    const error: FoliarResponse = {
      type: "error",
      message: err instanceof Error ? err.message : "Error desconocido.",
    };
    self.postMessage(error);
  }
});
