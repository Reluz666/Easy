/**
 * Hard limits for in-browser PDF compression.
 *
 * The browser has a 2GB Emscripten heap cap, so anything above this size
 * risks OOMing GS mid-compression with no way to recover. The limit is
 * intentionally conservative: if real-world usage shows it's too high,
 * lower it here and the error message updates automatically.
 */
export const MAX_COMPRESS_BYTES = 50 * 1024 * 1024;

/** Hard cap on compression time. If GS hasn't finished by then, terminate. */
export const COMPRESS_TIMEOUT_MS = 90_000;

export function formatSizeLimitMessage(fileSizeBytes: number): string {
  const sizeMB = (fileSizeBytes / 1024 / 1024).toFixed(1);
  const maxMB = Math.floor(MAX_COMPRESS_BYTES / 1024 / 1024);
  return `Este PDF es demasiado pesado para comprimirlo desde el navegador (${sizeMB} MB). El máximo permitido es ${maxMB} MB.`;
}

export function formatTimeoutMessage(): string {
  return `El PDF tardó demasiado en procesarse. Probá con un archivo más liviano.`;
}
