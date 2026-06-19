import { describe, it, expect } from "vitest";
import { formatFolio, type FolioFormat, type NumberStyle } from "./format";

describe("formatFolio with words style", () => {
  it.each<[number, string]>([
    [1, "uno"],
    [2, "dos"],
    [3, "tres"],
    [9, "nueve"],
    [10, "diez"],
    [11, "once"],
    [15, "quince"],
    [16, "dieciséis"],
    [19, "diecinueve"],
    [20, "veinte"],
    [21, "veintiuno"],
    [22, "veintidós"],
    [29, "veintinueve"],
    [30, "treinta"],
    [31, "treinta y uno"],
    [45, "cuarenta y cinco"],
    [99, "noventa y nueve"],
    [100, "cien"],
    [101, "ciento uno"],
    [199, "ciento noventa y nueve"],
    [200, "doscientos"],
    [500, "quinientos"],
    [900, "novecientos"],
    [999, "novecientos noventa y nueve"],
    [1000, "mil"],
    [1001, "mil uno"],
    [1999, "mil novecientos noventa y nueve"],
    [2000, "dos mil"],
    [9999, "nueve mil novecientos noventa y nueve"],
  ])("converts %i to '%s'", (n, expected) => {
    expect(formatFolio("N", n, 10, "words")).toBe(expected);
  });
});

describe("formatFolio integration with words", () => {
  const cases: Array<{ template: FolioFormat; current: number; total: number; style: NumberStyle; expected: string }> = [
    { template: "Folio N de TOTAL", current: 3, total: 10, style: "words", expected: "Folio tres de 10" },
    { template: "Página N de TOTAL", current: 1, total: 5, style: "words", expected: "Página uno de 5" },
    { template: "N / TOTAL", current: 22, total: 100, style: "words", expected: "veintidós / 100" },
    { template: "N", current: 100, total: 100, style: "words", expected: "cien" },
  ];

  it.each(cases)("$template + words($current) = $expected", ({ template, current, total, style, expected }) => {
    expect(formatFolio(template, current, total, style)).toBe(expected);
  });
});

describe("formatFolio with other styles (regression)", () => {
  it("numbers", () => {
    expect(formatFolio("Folio N de TOTAL", 3, 10, "numbers")).toBe("Folio 3 de 10");
  });
  it("letters", () => {
    expect(formatFolio("Folio N de TOTAL", 3, 10, "letters")).toBe("Folio C de 10");
  });
  it("both", () => {
    expect(formatFolio("Folio N de TOTAL", 3, 10, "both")).toBe("Folio 3-C de 10");
  });
  it("defaults to numbers when style omitted", () => {
    expect(formatFolio("N", 5, 5)).toBe("5");
  });
});
