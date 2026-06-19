import { describe, it, expect } from "vitest";
import { getFolioPdfCoords, FOLIO_MARGIN_PT } from "./position";

describe("getFolioPdfCoords (no rotation)", () => {
  const pageWidth = 612;   // 8.5 x 72
  const pageHeight = 792;  // 11  x 72
  const textWidth = 60;
  const fontSize = 12;
  const margin = FOLIO_MARGIN_PT;

  it("places 'bottom-left' at (margin, margin)", () => {
    const { x, y } = getFolioPdfCoords("bottom-left", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe(margin);
    expect(y).toBe(margin);
  });

  it("places 'bottom-center' centered horizontally at bottom", () => {
    const { x, y } = getFolioPdfCoords("bottom-center", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe(margin);
  });

  it("places 'bottom-right' at right edge minus margin", () => {
    const { x, y } = getFolioPdfCoords("bottom-right", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe(margin);
  });

  it("places 'top-left' at left margin, top of page minus margin minus font size", () => {
    const { x, y } = getFolioPdfCoords("top-left", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe(margin);
    expect(y).toBe(pageHeight - margin - fontSize);
  });

  it("places 'top-center' centered horizontally at top", () => {
    const { x, y } = getFolioPdfCoords("top-center", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe(pageHeight - margin - fontSize);
  });

  it("places 'top-right' at right edge minus margin, top of page minus margin", () => {
    const { x, y } = getFolioPdfCoords("top-right", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe(pageHeight - margin - fontSize);
  });

  it("places 'middle-left' at left margin, vertically centered", () => {
    const { x, y } = getFolioPdfCoords("middle-left", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe(margin);
    expect(y).toBe((pageHeight - fontSize) / 2);
  });

  it("places 'middle-center' centered horizontally and vertically", () => {
    const { x, y } = getFolioPdfCoords("middle-center", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe((pageHeight - fontSize) / 2);
  });

  it("places 'middle-right' at right edge minus margin, vertically centered", () => {
    const { x, y } = getFolioPdfCoords("middle-right", pageWidth, pageHeight, textWidth, fontSize);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe((pageHeight - fontSize) / 2);
  });

  it("returns rotate=0 when rotation is 0", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", pageWidth, pageHeight, textWidth, fontSize, 0);
    expect(rotate).toBe(0);
  });
});

describe("getFolioPdfCoords with page rotation", () => {
  const mediaW = 842; // A4 landscape
  const mediaH = 595;
  const textWidth = 30;
  const fontSize = 12;
  const margin = 24;

  it("rotation=90: counter-rotates text by -90", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 90);
    expect(rotate).toBe(-90);
  });

  it("rotation=180: counter-rotates text by -180", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 180);
    expect(rotate).toBe(-180);
  });

  it("rotation=270: counter-rotates text by -270", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 270);
    expect(rotate).toBe(-270);
  });

  it("rotation=-90 normalizes to 270 → rotate=-270", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, -90);
    expect(rotate).toBe(-270);
  });

  it("rotation=360 normalizes to 0", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 360);
    expect(rotate).toBe(0);
  });

  // Visual position for bottom-center:
  //   visualW = (rotation 90 or 270) ? mediaH : mediaW
  //   visualH = (rotation 90 or 270) ? mediaW : mediaH
  //   visualX = (visualW - textWidth) / 2
  //   visualYFromTop = visualH - margin
  function expectedVisualBottomCenter(rotation: number) {
    const r = ((rotation % 360) + 360) % 360;
    const visualW = r === 90 || r === 270 ? mediaH : mediaW;
    const visualH = r === 90 || r === 270 ? mediaW : mediaH;
    return {
      vx: (visualW - textWidth) / 2,
      vy: visualH - margin,
    };
  }

  // Simulates the viewer's R CCW rotation around MediaBox origin, returning
  // the visual top-left coords.
  function visualFromMedia(mx: number, my: number, rotation: number) {
    const r = ((rotation % 360) + 360) % 360;
    let vx: number, vy: number;
    switch (r) {
      case 0:
        vx = mx;
        vy = my;
        break;
      case 90:
        vx = mediaH - my;
        vy = mx;
        break;
      case 180:
        vx = mediaW - mx;
        vy = mediaH - my;
        break;
      case 270:
        vx = my;
        vy = mediaW - mx;
        break;
      default:
        vx = mx;
        vy = my;
    }
    const visualH = r === 90 || r === 270 ? mediaW : mediaH;
    return { vx, vy: visualH - vy };
  }

  for (const rotation of [0, 90, 180, 270]) {
    it(`rotation=${rotation}: bottom-center lands at the same visual position`, () => {
      const { x, y } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, rotation);
      const expected = expectedVisualBottomCenter(rotation);
      const actual = visualFromMedia(x, y, rotation);
      expect(actual.vx).toBeCloseTo(expected.vx, 5);
      expect(actual.vy).toBeCloseTo(expected.vy, 5);
    });
  }

  for (const rotation of [0, 90, 180, 270]) {
    it(`rotation=${rotation}: top-left lands at visual (margin, margin)`, () => {
      const { x, y } = getFolioPdfCoords("top-left", mediaW, mediaH, textWidth, fontSize, rotation);
      const r = ((rotation % 360) + 360) % 360;
      const visualW = r === 90 || r === 270 ? mediaH : mediaW;
      const visualH = r === 90 || r === 270 ? mediaW : mediaH;
      const actual = visualFromMedia(x, y, rotation);
      expect(actual.vx).toBeCloseTo(margin, 5);
      // top-left: visual y_top = margin + fontSize (baseline)
      expect(actual.vy).toBeCloseTo(margin + fontSize, 5);
      void visualW;
      void visualH;
    });
  }
});