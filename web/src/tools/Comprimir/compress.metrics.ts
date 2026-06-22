import type { CompressLevel, OcrLang } from "../../lib/api/jobs";

/**
 * Lifecycle of a compression or OCR attempt, recorded once per attempt
 * for post-hoc debugging. Fields beyond `status` and the inputs depend
 * on which state we reach: success gets resultSize + reductionPct,
 * error and timeout get an error message, too-large and cancelled may
 * not have a durationMs.
 *
 * `level` is required for compress mode; for OCR mode the page passes
 * the chosen language in `lang` and `level` is left undefined.
 */
export type CompressMetric = {
  status:
    | "success"
    | "error"
    | "timeout"
    | "too-large"
    | "cancelled"
    | "ocr-success"
    | "ocr-failed";
  fileName: string;
  originalSize: number;
  level?: CompressLevel;
  lang?: OcrLang;
  timestamp: string;
  durationMs?: number;
  resultSize?: number;
  reductionPct?: number;
  error?: string;
};

/**
 * Emits a single `[compress]` line to the console. We use a tag prefix
 * so the entries are easy to filter in DevTools and in user-shared
 * screenshots.
 */
export function logCompressMetric(metric: CompressMetric): void {
  console.log("[compress]", metric);
}
