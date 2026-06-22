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
});
