import { describe, it, expect } from "vitest";
import { formatFolio, numberToWords, type NumberStyle } from "./format";

describe("numberToWords", () => {
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
    expect(numberToWords(n)).toBe(expected);
  });
});

describe("formatFolio by style", () => {
  const cases: Array<{ style: NumberStyle; current: number; total: number; expected: string }> = [
    // numbers — solo el número de página
    { style: "numbers", current: 1, total: 10, expected: "1" },
    { style: "numbers", current: 5, total: 10, expected: "5" },
    { style: "numbers", current: 10, total: 10, expected: "10" },

    // words — solo la palabra
    { style: "words", current: 1, total: 10, expected: "uno" },
    { style: "words", current: 3, total: 10, expected: "tres" },
    { style: "words", current: 22, total: 100, expected: "veintidós" },
    { style: "words", current: 100, total: 100, expected: "cien" },

    // both — palabra + número
    { style: "both", current: 1, total: 10, expected: "uno 1" },
    { style: "both", current: 3, total: 10, expected: "tres 3" },
    { style: "both", current: 5, total: 10, expected: "cinco 5" },
    { style: "both", current: 22, total: 100, expected: "veintidós 22" },

    // n-t — número / total
    { style: "n-t", current: 1, total: 10, expected: "1/10" },
    { style: "n-t", current: 3, total: 10, expected: "3/10" },
    { style: "n-t", current: 10, total: 10, expected: "10/10" },
    { style: "n-t", current: 7, total: 20, expected: "7/20" },
  ];

  it.each(cases)("$style ($current of $total) = '$expected'", ({ style, current, total, expected }) => {
    expect(formatFolio(style, current, total)).toBe(expected);
  });
});
