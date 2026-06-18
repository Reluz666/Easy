import { describe, it, expect } from "vitest";
import { formatFolio } from "../lib/format";

describe("formatFolio", () => {
  it("formats 'Folio N de TOTAL'", () => {
    const result = formatFolio("Folio N de TOTAL", 3, 10);
    expect(result).toBe("Folio 3 de 10");
  });

  it("formats 'Página N de TOTAL'", () => {
    const result = formatFolio("Página N de TOTAL", 1, 5);
    expect(result).toBe("Página 1 de 5");
  });

  it("formats 'N / TOTAL'", () => {
    const result = formatFolio("N / TOTAL", 7, 20);
    expect(result).toBe("7 / 20");
  });

  it("formats 'N' (solo number)", () => {
    const result = formatFolio("N", 4, 9);
    expect(result).toBe("4");
  });

  it("converts numbers to letters when format is letters", () => {
    const result = formatFolio("Folio N de TOTAL", 3, 10, "letters");
    expect(result).toBe("Folio C de 10");
  });

  it("uses both number and letter when format is both", () => {
    const result = formatFolio("Folio N de TOTAL", 3, 10, "both");
    expect(result).toBe("Folio 3-C de 10");
  });

  it("converts numbers >26 to multi-letter (27 -> AA)", () => {
    const result = formatFolio("N", 28, 30, "letters");
    expect(result).toBe("AB");
  });
});
