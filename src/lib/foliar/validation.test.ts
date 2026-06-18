import { describe, it, expect } from "vitest";
import { validateFolioRange } from "./validation";

describe("validateFolioRange", () => {
  it("returns null for a valid range", () => {
    expect(validateFolioRange({ initialNumber: 1, from: 1, to: 10 }, 10)).toBeNull();
  });

  it("returns null for a single-page range", () => {
    expect(validateFolioRange({ initialNumber: 5, from: 5, to: 5 }, 10)).toBeNull();
  });

  it("returns null for the last page only", () => {
    expect(validateFolioRange({ initialNumber: 1, from: 10, to: 10 }, 10)).toBeNull();
  });

  it("rejects from < 1", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 0, to: 5 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Desde pág/);
  });

  it("rejects from > total", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 11, to: 15 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Desde pág/);
  });

  it("rejects to < from", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 5, to: 3 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Hasta pág/);
  });

  it("rejects to > total", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 1, to: 11 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Hasta pág/);
  });

  it("rejects initialNumber < 1", () => {
    const err = validateFolioRange({ initialNumber: 0, from: 1, to: 5 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Número inicial/);
  });
});
