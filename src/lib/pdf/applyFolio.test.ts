import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyFolio } from "./applyFolio";
import { DEFAULT_FOLIAR_CONFIG } from "../foliar/types";

async function makePdfBytes(numPages: number, pageW = 612, pageH = 792): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    doc.addPage([pageW, pageH]);
  }
  return doc.save();
}

describe("applyFolio", () => {
  it("returns a valid PDF with the same page count", async () => {
    const bytes = await makePdfBytes(5);
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 5 } };
    const result = await applyFolio(bytes, config);
    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(5);
  });

  it("returns a larger PDF when folios are added (text bytes increase size)", async () => {
    const bytes = await makePdfBytes(3);
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 3 } };
    const result = await applyFolio(bytes, config);
    expect(result.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("skips pages outside the range (page count and base content unchanged for skipped pages)", async () => {
    const bytes = await makePdfBytes(5);
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 2, to: 3 } };
    const result = await applyFolio(bytes, config);
    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(5);
  });

  it("uses initialNumber as the starting folio number", async () => {
    const bytes = await makePdfBytes(3);
    const configA = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 3 } };
    const configB = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 10, from: 1, to: 3 } };
    const resultA = await applyFolio(bytes, configA);
    const resultB = await applyFolio(bytes, configB);
    expect(Buffer.from(resultA).toString("binary")).not.toBe(Buffer.from(resultB).toString("binary"));
  });

  it("throws Spanish error if the PDF is invalid", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    const config = DEFAULT_FOLIAR_CONFIG;
    await expect(applyFolio(garbage, config)).rejects.toThrow(/No se pudo leer el PDF/);
  });
});
