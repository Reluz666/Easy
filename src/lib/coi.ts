/**
 * Registers the coi-serviceworker polyfill once per page load. This is
 * needed so that `SharedArrayBuffer` is available when Ghostscript WASM
 * runs in a Web Worker (which requires cross-origin isolation via the
 * COOP/COEP headers that the polyfill injects via a Service Worker).
 *
 * Safe to call multiple times: subsequent calls are no-ops via a
 * module-level flag. Errors are swallowed so the rest of the app still
 * works in environments where the SW can't be registered.
 *
 * Reference: https://github.com/gzuidhof/coi-serviceworker
 */
export async function registerCoiServiceWorker(): Promise<void> {
  if ((globalThis as Record<string, unknown>).__coiRegistered) return;

  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!sw?.register) return;

  try {
    await sw.register("/coi-serviceworker.js");
    (globalThis as Record<string, unknown>).__coiRegistered = true;
  } catch {
    // SW registration failed (e.g., third-party cookies blocked). The app
    // still works for non-WASM features; compression will fail later with
    // a clear error if SharedArrayBuffer is unavailable.
  }
}
