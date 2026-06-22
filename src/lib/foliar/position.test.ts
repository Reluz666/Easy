import { describe, it, expect } from "vitest";
import { getFolioPdfCoords, FOLIO_MARGIN_PT } from "./position";

describe("getFolioPdfCoords (no rotation)", () => {
  const pageWidth = 612;
  const pageHeight = 792;
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
  // Test uses A4 landscape media (842 × 595) as the base dimensions, then
  // exercises all four /Rotate values by treating the function's pageWidth /
  // pageHeight args as the MediaBox (not the visual viewport).
  const mediaW = 842;
  const mediaH = 595;
  const textWidth = 30;
  const fontSize = 12;
  const margin = 24;

  it("rotation=90: rotate stays 0 (text follows page orientation)", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 90);
    expect(rotate).toBe(0);
  });

  it("rotation=180: rotate stays 0", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 180);
    expect(rotate).toBe(0);
  });

  it("rotation=270: rotate stays 0", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 270);
    expect(rotate).toBe(0);
  });

  it("rotation=-90 normalizes to 270 → rotate=0", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, -90);
    expect(rotate).toBe(0);
  });

  it("rotation=360 normalizes to 0", () => {
    const { rotate } = getFolioPdfCoords("bottom-center", mediaW, mediaH, textWidth, fontSize, 360);
    expect(rotate).toBe(0);
  });

  // Expected visual position for bottom-center:
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

  // Maps a MediaBox point (mx, my) to the visual top-left coordinate space
  // for a page with the given /Rotate, by simulating the viewer's R CCW
  // rotation around the MediaBox origin and translating to the visual
  // viewport's top-left.
  function visualFromMedia(mx: number, my: number, rotation: number) {
    const r = ((rotation % 360) + 360) % 360;
    let vx: number, vy: number;
    switch (r) {
      case 0:
        vx = mx;
        vy = mediaH - my;
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
        vy = mediaH - my;
    }
    return { vx, vy };
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
    it(`rotation=${rotation}: top-left lands at visual (margin, margin + fontSize)`, () => {
      const { x, y } = getFolioPdfCoords("top-left", mediaW, mediaH, textWidth, fontSize, rotation);
      const actual = visualFromMedia(x, y, rotation);
      expect(actual.vx).toBeCloseTo(margin, 5);
      expect(actual.vy).toBeCloseTo(margin + fontSize, 5);
    });
  }

  for (const rotation of [0, 90, 180, 270]) {
    it(`rotation=${rotation}: top-right lands at the visual top-right corner`, () => {
      const r = ((rotation % 360) + 360) % 360;
      const visualW = r === 90 || r === 270 ? mediaH : mediaW;
      const { x, y } = getFolioPdfCoords("top-right", mediaW, mediaH, textWidth, fontSize, rotation);
      const actual = visualFromMedia(x, y, rotation);
      expect(actual.vx).toBeCloseTo(visualW - textWidth - margin, 5);
      expect(actual.vy).toBeCloseTo(margin + fontSize, 5);
    });
  }
});
