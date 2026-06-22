import { describe, it, expect } from "vitest";
import { parseRange, parseOrder, validateRange, formatRange } from "./parseRange";

describe("parseRange", () => {
  it("parses a single page", () => {
    expect(parseRange("2")).toEqual([2]);
  });

  it("parses comma-separated pages", () => {
    expect(parseRange("2,5,7")).toEqual([2, 5, 7]);
  });

  it("parses an inclusive range", () => {
    expect(parseRange("2-5")).toEqual([2, 3, 4, 5]);
  });

  it("parses mixed ranges and singles", () => {
    expect(parseRange("2-5,7,9-10")).toEqual([2, 3, 4, 5, 7, 9, 10]);
  });

  it("deduplicates and sorts", () => {
    expect(parseRange("5,2,3,2")).toEqual([2, 3, 5]);
  });

  it("tolerates whitespace", () => {
    expect(parseRange(" 2 , 5 - 7 ")).toEqual([2, 5, 6, 7]);
  });

  it("returns null for empty input", () => {
    expect(parseRange("")).toBeNull();
    expect(parseRange("   ")).toBeNull();
  });

  it("returns null for non-numeric tokens", () => {
    expect(parseRange("2,foo")).toBeNull();
    expect(parseRange("2-3,abc")).toBeNull();
  });

  it("returns null when range is inverted (left > right)", () => {
    expect(parseRange("5-2")).toBeNull();
  });

  it("returns null when a page is 0", () => {
    expect(parseRange("0,1")).toBeNull();
    expect(parseRange("0-2")).toBeNull();
  });

  it("returns null for dangling commas", () => {
    expect(parseRange("2,")).toBeNull();
    expect(parseRange(",2")).toBeNull();
  });
});

describe("validateRange", () => {
  it("returns null for valid input within bounds", () => {
    expect(validateRange("2,5", 10)).toBeNull();
    expect(validateRange("1-10", 10)).toBeNull();
  });

  it("returns Spanish error for unparseable input", () => {
    expect(validateRange("foo", 10)).toMatch(/Indicá las páginas/);
  });

  it("rejects pages above the document total", () => {
    const msg = validateRange("2,15", 10);
    expect(msg).toMatch(/fuera del rango 1\.\.10/);
    expect(msg).toContain("15");
  });
});

describe("parseOrder", () => {
  it("preserves the user-typed order", () => {
    expect(parseOrder("3,1,2")).toEqual([3, 1, 2]);
    expect(parseOrder("4,2,1,3")).toEqual([4, 2, 1, 3]);
  });

  it("expands ranges in place without sorting them globally", () => {
    expect(parseOrder("1-3,5,4")).toEqual([1, 2, 3, 5, 4]);
  });

  it("rejects duplicates (a single page can't go to two positions)", () => {
    expect(parseOrder("1,2,2")).toBeNull();
    expect(parseOrder("1-3,2")).toBeNull();
  });

  it("returns null for empty / non-numeric / inverted / zero / dangling", () => {
    expect(parseOrder("")).toBeNull();
    expect(parseOrder("  ")).toBeNull();
    expect(parseOrder("foo")).toBeNull();
    expect(parseOrder("5-2")).toBeNull();
    expect(parseOrder("0,1")).toBeNull();
    expect(parseOrder("2,")).toBeNull();
  });
});

describe("formatRange", () => {
  it("formats consecutive pages as a range", () => {
    expect(formatRange([1, 2, 3])).toBe("1-3");
  });

  it("formats consecutive singletons individually", () => {
    expect(formatRange([1, 3, 5])).toBe("1,3,5");
  });

  it("formats pairs as `a,b` not `a-b`", () => {
    expect(formatRange([1, 2])).toBe("1,2");
  });

  it("handles mixed runs", () => {
    expect(formatRange([1, 2, 3, 5, 7, 8, 9])).toBe("1-3,5,7-9");
  });

  it("returns empty string for empty input", () => {
    expect(formatRange([])).toBe("");
  });
});
