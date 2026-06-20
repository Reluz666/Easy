/// <reference lib="webworker" />
import { runGhostscript } from "../../lib/pdf/ghostscript";
import type { CompressRequest, CompressResponse } from "./compress.protocol";

let cancelled = false;

self.addEventListener("message", async (e: MessageEvent<CompressRequest>) => {
  if (e.data.type === "cancel") {
    cancelled = true;
    return;
  }

  if (e.data.type !== "compress") return;
  cancelled = false;

  const { bytes, level } = e.data;

  // Import the WASM loader dynamically so it only loads when Comprimir is used.
  const { default: loadGhostscript } = await import("./compress.wasm-loader");

  try {
    // Synthetic progress: 0% at start, jump to 50% once WASM is loaded,
    // 100% when GS finishes. GS does not report per-page progress for PDF
    // compression, so this is the best we can do without parsing stderr.
    postMessage({ type: "progress", pct: 5 } satisfies CompressResponse);

    // Mark 50% once GS is initialized (before run). We can't easily hook
    // into the loader, so we just emit at the boundaries.
    postMessage({ type: "progress", pct: 50 } satisfies CompressResponse);

    const outBytes = await runGhostscript(bytes, level, { loadGhostscript });

    if (cancelled) {
      const response: CompressResponse = { type: "cancelled" };
      self.postMessage(response);
      return;
    }

    postMessage({ type: "progress", pct: 100 } satisfies CompressResponse);
    const complete: CompressResponse = { type: "complete", bytes: outBytes };
    self.postMessage(complete);
  } catch (err) {
    if (cancelled) {
      const response: CompressResponse = { type: "cancelled" };
      self.postMessage(response);
      return;
    }
    const error: CompressResponse = {
      type: "error",
      message: err instanceof Error ? err.message : "Error desconocido.",
    };
    self.postMessage(error);
  }
});
