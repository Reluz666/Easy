import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logCompressMetric } from "./compress.metrics";

describe("logCompressMetric", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("logs the metric with a [compress] tag prefix", () => {
    logCompressMetric({
      status: "success",
      fileName: "doc.pdf",
      originalSize: 1000,
      level: "media",
      durationMs: 2000,
      resultSize: 500,
      reductionPct: 50,
      timestamp: "2026-06-22T10:00:00.000Z",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = logSpy.mock.calls[0];
    expect(tag).toBe("[compress]");
    expect(payload).toMatchObject({
      status: "success",
      fileName: "doc.pdf",
      originalSize: 1000,
      level: "media",
      durationMs: 2000,
      resultSize: 500,
      reductionPct: 50,
    });
  });

  it("logs error metrics with the error message", () => {
    logCompressMetric({
      status: "error",
      fileName: "broken.pdf",
      originalSize: 5000,
      level: "alta",
      durationMs: 8000,
      error: "Cannot enlarge memory",
      timestamp: "2026-06-22T10:01:00.000Z",
    });

    expect(logSpy.mock.calls[0][1]).toMatchObject({
      status: "error",
      error: "Cannot enlarge memory",
    });
  });

  it("does not throw when fields are missing", () => {
    expect(() =>
      logCompressMetric({
        status: "too-large",
        fileName: "huge.pdf",
        originalSize: 200 * 1024 * 1024,
        level: "media",
        timestamp: "2026-06-22T10:02:00.000Z",
      }),
    ).not.toThrow();
  });

  it("logs OCR success metrics with the same [compress] tag prefix", () => {
    logCompressMetric({
      status: "ocr-success",
      fileName: "scan.pdf",
      originalSize: 17_000_000,
      lang: "spa+eng",
      durationMs: 459_000,
      resultSize: 17_500_000,
      // OCR grew the file — reduction_pct is negative.
      reductionPct: -2.9,
      timestamp: "2026-06-22T11:00:00.000Z",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = logSpy.mock.calls[0];
    expect(tag).toBe("[compress]");
    expect(payload).toMatchObject({
      status: "ocr-success",
      fileName: "scan.pdf",
      lang: "spa+eng",
      reductionPct: -2.9,
    });
  });

  it("logs OCR failed metrics with the error message", () => {
    logCompressMetric({
      status: "ocr-failed",
      fileName: "scan.pdf",
      originalSize: 17_000_000,
      lang: "spa+eng",
      durationMs: 900_000,
      error: "OCR_TIMEOUT: El OCR tardó demasiado. El PDF puede tener imágenes muy grandes.",
      timestamp: "2026-06-22T11:05:00.000Z",
    });

    expect(logSpy.mock.calls[0][1]).toMatchObject({
      status: "ocr-failed",
      error: expect.stringContaining("OCR_TIMEOUT"),
    });
  });
});
