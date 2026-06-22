import { describe, it, expect } from "vitest";
import {
  COMPRESS_TIMEOUT_MS,
  MAX_COMPRESS_BYTES,
  formatSizeLimitMessage,
  formatTimeoutMessage,
} from "./compress.limits";

describe("compress.limits constants", () => {
  it("caps input size at 50 MB", () => {
    expect(MAX_COMPRESS_BYTES).toBe(50 * 1024 * 1024);
  });

  it("caps compression time at 90 seconds", () => {
    expect(COMPRESS_TIMEOUT_MS).toBe(90_000);
  });
});

describe("formatSizeLimitMessage", () => {
  it("includes the offending file size and the configured limit", () => {
    const message = formatSizeLimitMessage(60 * 1024 * 1024);
    expect(message).toContain("60.0 MB");
    expect(message).toContain("50 MB");
    expect(message).toMatch(/demasiado pesado para comprimirlo desde el navegador/);
  });

  it("rounds to one decimal", () => {
    // Use 75.7 (not 75.55) to dodge JS's 75.55 → 75.54999… float artifact.
    expect(formatSizeLimitMessage(75.7 * 1024 * 1024)).toContain("75.7 MB");
  });
});

describe("formatTimeoutMessage", () => {
  it("uses the timeout phrasing", () => {
    expect(formatTimeoutMessage()).toMatch(/tardó demasiado en procesarse/);
  });
});
