import { describe, it, expect } from "vitest";
import { validateFoliateConfig } from "./validation";
import { DEFAULT_FOLIAR_CONFIG } from "./types";

describe("validateFoliateConfig", () => {
  it("returns null for default config when file is loaded", () => {
    expect(validateFoliateConfig(DEFAULT_FOLIAR_CONFIG, 10)).toBeNull();
  });

  it("returns null when no PDF has been loaded yet (totalPages === null)", () => {
    expect(validateFoliateConfig(DEFAULT_FOLIAR_CONFIG, null)).toBeNull();
  });

  it("rejects initial_number < 1", () => {
    const err = validateFoliateConfig(
      { ...DEFAULT_FOLIAR_CONFIG, initial_number: 0 },
      10,
    );
    expect(err).toMatch(/Número inicial/);
  });

  it("rejects font_size below minimum", () => {
    const err = validateFoliateConfig(
      { ...DEFAULT_FOLIAR_CONFIG, font_size: 4 },
      10,
    );
    expect(err).toMatch(/Tamaño de fuente/);
  });

  it("rejects font_size above maximum", () => {
    const err = validateFoliateConfig(
      { ...DEFAULT_FOLIAR_CONFIG, font_size: 100 },
      10,
    );
    expect(err).toMatch(/Tamaño de fuente/);
  });

  it("accepts a valid from-to range", () => {
    const err = validateFoliateConfig(
      {
        ...DEFAULT_FOLIAR_CONFIG,
        range_mode: "from-to",
        from_page: 2,
        to_page: 5,
      },
      10,
    );
    expect(err).toBeNull();
  });

  it("rejects from-to with missing bounds", () => {
    const err = validateFoliateConfig(
      { ...DEFAULT_FOLIAR_CONFIG, range_mode: "from-to", from_page: null, to_page: 5 },
      10,
    );
    expect(err).toMatch(/Indicá desde y hasta/);
  });

  it("rejects from_page > totalPages", () => {
    const err = validateFoliateConfig(
      { ...DEFAULT_FOLIAR_CONFIG, range_mode: "from-to", from_page: 50, to_page: 60 },
      10,
    );
    expect(err).toMatch(/Desde pág/);
  });

  it("rejects to_page < from_page", () => {
    const err = validateFoliateConfig(
      { ...DEFAULT_FOLIAR_CONFIG, range_mode: "from-to", from_page: 5, to_page: 3 },
      10,
    );
    expect(err).toMatch(/Hasta pág/);
  });
});
