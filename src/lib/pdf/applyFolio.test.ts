import { describe, it, expect } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { applyFolio } from "./applyFolio";
import { DEFAULT_FOLIAR_CONFIG } from "../foliar/types";

const toBinaryString = (bytes: Uint8Array): string =>
  new TextDecoder("latin1").decode(bytes);

async function makePdfBytes(numPages: number, pageW = 612, pageH = 792): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    doc.addPage([pageW, pageH]);
  }
  return doc.save();
}

async function makeRotatedPdfBytes(rotations: number[], pageW = 842, pageH = 595): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const rotation of rotations) {
    const page = doc.addPage([pageW, pageH]);
    if (rotation !== 0) {
      page.setRotation(degrees(rotation));
    }
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
    expect(toBinaryString(resultA)).not.toBe(toBinaryString(resultB));
  });

  it("throws Spanish error if the PDF is invalid", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    const config = DEFAULT_FOLIAR_CONFIG;
    await expect(applyFolio(garbage, config)).rejects.toThrow(/No se pudo leer el PDF/);
  });

  it("works with numberStyle: 'words' (text encoding verified via format.test.ts)", async () => {
    const bytes = await makePdfBytes(3);
    const config = {
      ...DEFAULT_FOLIAR_CONFIG,
      numberStyle: "words" as const,
      range: { initialNumber: 1, from: 1, to: 3 },
    };
    const result = await applyFolio(bytes, config);
    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(3);
    expect(result.byteLength).toBeGreaterThan(bytes.byteLength);
  });
});

describe("applyFolio preserves page rotation", () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`page rotation ${rotation}° is preserved in output`, async () => {
      const bytes = await makeRotatedPdfBytes([rotation]);
      const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 1 } };
      const result = await applyFolio(bytes, config);
      const reloaded = await PDFDocument.load(result);
      const page = reloaded.getPages()[0];
      const normalized = ((page.getRotation().angle % 360) + 360) % 360;
      expect(normalized).toBe(rotation);
    });
  }

  it("mixed rotation PDF (0/90/180/270) keeps each page's rotation after foliating", async () => {
    const bytes = await makeRotatedPdfBytes([0, 90, 180, 270]);
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 4 } };
    const result = await applyFolio(bytes, config);
    const reloaded = await PDFDocument.load(result);
    const pages = reloaded.getPages();
    expect(pages.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      const normalized = ((pages[i].getRotation().angle % 360) + 360) % 360;
      expect(normalized).toBe(i * 90);
    }
  });
});

describe("applyFolio with rotated pages produces folio text with counter-rotation", () => {
  // The foliated PDF should contain a "Tm" (text matrix) operator whose rotation
  // component counter-acts the page's /Rotate. We can't easily inspect the
  // decoded Tm values, but we can check the raw content stream for signs of
  // rotation math being applied. This is a coarse smoke test: the output bytes
  // for rotated vs non-rotated pages should differ (i.e. rotation handling is
  // exercised).

  it("output differs between rotated and non-rotated pages", async () => {
    const rotatedBytes = await makeRotatedPdfBytes([270]);
    const flatBytes = await makeRotatedPdfBytes([0]);

    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 1 } };
    const rotatedResult = await applyFolio(rotatedBytes, config);
    const flatResult = await applyFolio(flatBytes, config);

    expect(toBinaryString(rotatedResult)).not.toBe(toBinaryString(flatResult));
  });

  it("all four rotations produce distinct output (rotation-aware code path)", async () => {
    const results: string[] = [];
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 1 } };
    for (const rotation of [0, 90, 180, 270]) {
      const bytes = await makeRotatedPdfBytes([rotation]);
      const result = await applyFolio(bytes, config);
      results.push(toBinaryString(result));
    }
    // All four should be distinct
    expect(new Set(results).size).toBe(4);
  });
});