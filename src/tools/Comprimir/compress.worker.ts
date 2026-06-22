/// <reference lib="webworker" />
import { runGhostscript } from "../../lib/pdf/ghostscript";
import type { CompressRequest, CompressResponse } from "./compress.protocol";

self.addEventListener("message", async (e: MessageEvent<CompressRequest>) => {
  const { bytes, level } = e.data;

  // Import the WASM loader dynamically so it only loads when Comprimir is used.
  const { default: loadGhostscript } = await import("./compress.wasm-loader");

  try {
    postMessage({ type: "progress", pct: 5 } satisfies CompressResponse);
    postMessage({ type: "progress", pct: 50 } satisfies CompressResponse);

    const outBytes = await runGhostscript(bytes, level, { loadGhostscript }, {
      onProgress: (pct) =>
        postMessage({ type: "progress", pct } satisfies CompressResponse),
    });

    // If the page called worker.terminate() while GS was running, postMessage
    // throws — the worker is being torn down, just exit silently.
    postMessage({ type: "progress", pct: 100 } satisfies CompressResponse);
    const complete: CompressResponse = { type: "complete", bytes: outBytes };
    self.postMessage(complete);
  } catch (err) {
    // Same as above: if the worker is being terminated, exit silently.
    if (err instanceof Error && /terminated/i.test(err.message)) return;
    const error: CompressResponse = {
      type: "error",
      message: err instanceof Error ? err.message : "Error desconocido.",
    };
    self.postMessage(error);
  }
});
