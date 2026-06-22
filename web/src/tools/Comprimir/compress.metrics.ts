import type { CompressLevel } from "../../lib/api/jobs";

/**
 * Lifecycle of a compression attempt, recorded once per attempt for
 * post-hoc debugging. Fields beyond `status` and the inputs depend on
 * which state we reach: success gets resultSize + reductionPct, error
 * and timeout get an error message, too-large and cancelled may not
 * have a durationMs.
 */
export type CompressMetric = {
  status: "success" | "error" | "timeout" | "too-large" | "cancelled";
  fileName: string;
  originalSize: number;
  level: CompressLevel;
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
