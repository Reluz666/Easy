import type { CompressLevel } from "../../tools/Comprimir/compress.protocol";

/**
 * Maps a CompressLevel to the Ghostscript `-dPDFSETTINGS` preset:
 *   baja  → /printer (150 dpi, almost no visible loss)
 *   media → /ebook   (100 dpi, balanced)
 *   alta  → /screen  (72 dpi,  aggressive)
 */
export function levelToGsArgs(level: CompressLevel): string[] {
  switch (level) {
    case "baja":
      return ["-dPDFSETTINGS=/printer"];
    case "media":
      return ["-dPDFSETTINGS=/ebook"];
    case "alta":
      return ["-dPDFSETTINGS=/screen"];
  }
}

/**
 * The minimal interface runGhostscript needs from the loaded WASM module.
 * Declared here so tests can supply a mock without pulling in the real
 * (heavy) `@jspawn/ghostscript-wasm` package.
 */
export interface GhostscriptModule {
  run(inputBytes: Uint8Array, args: string[]): Promise<Uint8Array>;
}

export type LoadGhostscript = () => Promise<GhostscriptModule>;

/**
 * Runs Ghostscript on the given PDF bytes at the given compression level.
 * Returns the compressed PDF bytes.
 *
 * The `deps` parameter lets tests inject a mocked loader; production code
 * passes the real `loadGhostscript` from the worker (Task 6).
 */
export async function runGhostscript(
  inputBytes: Uint8Array,
  level: CompressLevel,
  deps: { loadGhostscript: LoadGhostscript },
): Promise<Uint8Array> {
  let module: GhostscriptModule;
  try {
    module = await deps.loadGhostscript();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo cargar el motor de compresión (${reason}).`);
  }

  const args = [
    "-sDEVICE=pdfwrite",
    ...levelToGsArgs(level),
    "-dNOPAUSE",
    "-dBATCH",
    "-sOutputFile=-", // stdout; we read bytes back instead of writing to disk
    "-",              // read input from stdin (the bytes we pass in)
    "-q",             // quiet mode to keep stderr clean for progress parsing
  ];

  try {
    return await module.run(inputBytes, args);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo comprimir el PDF (${reason}).`);
  }
}