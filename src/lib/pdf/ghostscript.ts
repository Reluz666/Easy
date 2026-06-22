import type { CompressLevel } from "../../tools/Comprimir/compress.protocol";

/**
 * Maps a CompressLevel to the Ghostscript `-dPDFSETTINGS` preset plus the
 * explicit image-handling flags needed to actually shrink image-heavy PDFs.
 *
 * The named presets (/printer, /ebook, /screen) are supposed to enable
 * image downsampling + JPEG re-encoding, but in practice GS 9.56 sometimes
 * keeps images in FlateDecode form when only the preset is given — so we
 * spell out the relevant flags explicitly. Image resolutions follow the
 * preset's DPI; quality is 75% across all levels for predictability.
 */
export function levelToGsArgs(level: CompressLevel): string[] {
  const preset =
    level === "baja" ? "-dPDFSETTINGS=/printer" :
    level === "media" ? "-dPDFSETTINGS=/ebook" :
    "-dPDFSETTINGS=/screen";

  const colorRes =
    level === "baja" ? "150" :
    level === "media" ? "100" :
    "72";
  const grayRes = colorRes;
  const monoRes =
    level === "baja" ? "300" :
    level === "media" ? "300" :
    "300";

  return [
    preset,
    "-dDownsampleColorImages=true",
    "-dDownsampleGrayImages=true",
    "-dDownsampleMonoImages=true",
    `-dColorImageResolution=${colorRes}`,
    `-dGrayImageResolution=${grayRes}`,
    `-dMonoImageResolution=${monoRes}`,
    "-dEncodeColorImages=true",
    "-dEncodeGrayImages=true",
    "-dEncodeMonoImages=true",
    "-dAutoFilterColorImages=true",
    "-dAutoFilterGrayImages=true",
    "-dCompressPages=true",
    "-dCompressFonts=true",
    "-dSubsetFonts=true",
    "-dOptimize=true",
    "-dJPEGQ=75",
  ];
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
 * Above this size we process the PDF in page-range chunks instead of in a
 * single Ghostscript run. The precompiled `@jspawn/ghostscript-wasm` is
 * built with a 2 GB heap cap; image-heavy PDFs above ~5 MB can exhaust the
 * heap mid-compression and emit a corrupted, oversized output.
 */
const CHUNK_THRESHOLD_BYTES = 5 * 1024 * 1024;

/** Pages per Ghostscript run when chunking. Tries smaller if a chunk OOMs. */
const CHUNK_PAGE_SIZES = [10, 5, 2, 1];

/**
 * Runs Ghostscript on the given PDF bytes at the given compression level.
 * Returns the compressed PDF bytes.
 *
 * The `deps` parameter lets tests inject a mocked loader; production code
 * passes the real `loadGhostscript` from the worker.
 *
 * For inputs above `CHUNK_THRESHOLD_BYTES`, processes the PDF in page-range
 * chunks and merges them with pdf-lib, falling back to smaller chunk sizes
 * if a chunk OOMs.
 */
export async function runGhostscript(
  inputBytes: Uint8Array,
  level: CompressLevel,
  deps: { loadGhostscript: LoadGhostscript },
  options?: { onProgress?: (pct: number) => void },
): Promise<Uint8Array> {
  let module: GhostscriptModule;
  try {
    module = await deps.loadGhostscript();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo cargar el motor de compresión (${reason}).`);
  }

  const baseArgs = [
    "-sDEVICE=pdfwrite",
    ...levelToGsArgs(level),
    "-dNOPAUSE",
    "-dBATCH",
    "-sOutputFile=-",
    "-",
    "-q",
  ];

  // Small inputs: single run is fastest and shares resources best.
  if (inputBytes.byteLength <= CHUNK_THRESHOLD_BYTES) {
    try {
      options?.onProgress?.(50);
      const out = await module.run(inputBytes, baseArgs);
      options?.onProgress?.(100);
      return out;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!isOom(reason)) throw friendlyError(reason);
      // Single-run OOMed — fall through to chunked path.
    }
  }

  // Larger inputs: chunk by page range, retrying with smaller chunks on OOM.
  options?.onProgress?.(5);
  const { PDFDocument } = await import("pdf-lib");

  // First, "repair" the PDF via pdf-lib. GS is strict about PDF structure
  // (cross-ref tables, trailer dictionaries, byte offsets) and OOMs during
  // input parsing on slightly corrupt PDFs because it has to fall back to
  // scanning the whole file. pdf-lib is tolerant: it can re-emit a clean,
  // linearized PDF that GS can stream page by page without rebuilding the
  // document in memory.
  let workingBytes: Uint8Array = inputBytes;
  let pageCount: number;
  try {
    const sourceDoc = await PDFDocument.load(inputBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    pageCount = sourceDoc.getPageCount();
    const repaired = await sourceDoc.save({ useObjectStreams: false });
    if (repaired.byteLength > 0) {
      workingBytes = repaired;
    }
  } catch {
    throw new Error(
      "No se pudo cargar el PDF. Verifica que no esté protegido con contraseña.",
    );
  }
  options?.onProgress?.(10);

  for (const chunkSize of CHUNK_PAGE_SIZES) {
    try {
      const merged = await runChunked({
        module,
        inputBytes: workingBytes,
        baseArgs,
        pageCount,
        chunkSize,
        onProgress: (pct) => options?.onProgress?.(10 + pct * 0.9),
      });
      options?.onProgress?.(100);
      return merged;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!isOom(reason)) throw friendlyError(reason);
      // Try a smaller chunk size on the next iteration.
    }
  }

  throw new Error(
    "Memoria del navegador agotada incluso procesando página por página. " +
      "El PDF probablemente tiene una sola página con una imagen muy grande.",
  );
}

function isOom(reason: string): boolean {
  return /cannot enlarge memory|out of memory/i.test(reason);
}

function friendlyError(reason: string): Error {
  if (isOom(reason)) {
    return new Error(
      "Memoria del navegador agotada durante la compresión.",
    );
  }
  return new Error(`No se pudo comprimir el PDF (${reason}).`);
}

async function runChunked(args: {
  module: GhostscriptModule;
  inputBytes: Uint8Array;
  baseArgs: string[];
  pageCount: number;
  chunkSize: number;
  onProgress: (pct: number) => void;
}): Promise<Uint8Array> {
  const { module, inputBytes, baseArgs, pageCount, chunkSize, onProgress } =
    args;

  const chunkBytes: Uint8Array[] = [];
  const totalChunks = Math.ceil(pageCount / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize + 1;
    const end = Math.min(start + chunkSize - 1, pageCount);
    const chunkArgs = [...baseArgs, `-sPageList=${start}-${end}`];
    const bytes = await module.run(inputBytes, chunkArgs);
    chunkBytes.push(bytes);
    onProgress((i + 1) / totalChunks);
  }

  // pdf-lib dynamically imported here so it only loads when chunking.
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const bytes of chunkBytes) {
    const chunkDoc = await PDFDocument.load(bytes);
    const pageIndices = chunkDoc.getPageIndices();
    const copied = await merged.copyPages(chunkDoc, pageIndices);
    copied.forEach((p) => merged.addPage(p));
  }
  return await merged.save();
}