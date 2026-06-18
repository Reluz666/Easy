import { describe, it, expect } from "vitest";
import { getFolioPdfCoords, FOLIO_MARGIN_PT } from "./position";

describe("getFolioPdfCoords", () => {
  const pageWidth = 612;   // 8.5 x 72
  const pageHeight = 792;  // 11  x 72
  const textWidth = 60;
  const textHeight = 12;
  const margin = FOLIO_MARGIN_PT;

  it("places 'bottom-left' at (margin, margin)", () => {
    const { x, y } = getFolioPdfCoords("bottom-left", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(margin);
    expect(y).toBe(margin);
  });

  it("places 'bottom-center' centered horizontally at bottom", () => {
    const { x, y } = getFolioPdfCoords("bottom-center", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe(margin);
  });

  it("places 'bottom-right' at right edge minus margin", () => {
    const { x, y } = getFolioPdfCoords("bottom-right", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe(margin);
  });

  it("places 'top-left' at left margin, top of page minus margin minus text height", () => {
    const { x, y } = getFolioPdfCoords("top-left", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(margin);
    expect(y).toBe(pageHeight - margin - textHeight);
  });

  it("places 'top-center' centered horizontally at top", () => {
    const { x, y } = getFolioPdfCoords("top-center", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe(pageHeight - margin - textHeight);
  });

  it("places 'top-right' at right edge minus margin, top of page minus margin", () => {
    const { x, y } = getFolioPdfCoords("top-right", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe(pageHeight - margin - textHeight);
  });

  it("places 'middle-left' at left margin, vertically centered", () => {
    const { x, y } = getFolioPdfCoords("middle-left", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(margin);
    expect(y).toBe((pageHeight - textHeight) / 2);
  });

  it("places 'middle-center' centered horizontally and vertically", () => {
    const { x, y } = getFolioPdfCoords("middle-center", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe((pageHeight - textHeight) / 2);
  });

  it("places 'middle-right' at right edge minus margin, vertically centered", () => {
    const { x, y } = getFolioPdfCoords("middle-right", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe((pageHeight - textHeight) / 2);
  });
});
