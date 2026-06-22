import { describe, it, expect, vi, beforeEach } from "vitest";
import { levelToGsArgs, runGhostscript } from "./ghostscript";

describe("levelToGsArgs", () => {
  it("maps 'baja' to /printer with 150 dpi image downsampling", () => {
    const args = levelToGsArgs("baja");
    expect(args).toContain("-dPDFSETTINGS=/printer");
    expect(args).toContain("-dColorImageResolution=150");
    expect(args).toContain("-dGrayImageResolution=150");
    expect(args).toContain("-dDownsampleColorImages=true");
  });

  it("maps 'media' to /ebook with 100 dpi image downsampling", () => {
    const args = levelToGsArgs("media");
    expect(args).toContain("-dPDFSETTINGS=/ebook");
    expect(args).toContain("-dColorImageResolution=100");
    expect(args).toContain("-dGrayImageResolution=100");
  });

  it("maps 'alta' to /screen with 72 dpi image downsampling", () => {
    const args = levelToGsArgs("alta");
    expect(args).toContain("-dPDFSETTINGS=/screen");
    expect(args).toContain("-dColorImageResolution=72");
    expect(args).toContain("-dGrayImageResolution=72");
    expect(args).toContain("-dJPEGQ=75");
  });

  it("enables image JPEG re-encoding on every level", () => {
    for (const level of ["baja", "media", "alta"] as const) {
      const args = levelToGsArgs(level);
      expect(args).toContain("-dEncodeColorImages=true");
      expect(args).toContain("-dEncodeGrayImages=true");
      expect(args).toContain("-dAutoFilterColorImages=true");
      expect(args).toContain("-dCompressPages=true");
      expect(args).toContain("-dSubsetFonts=true");
    }
  });
});

describe("runGhostscript", () => {
  it("invokes the GS loader with input bytes and the right args", async () => {
    const inputBytes = new Uint8Array([1, 2, 3]);
    const outputBytes = new Uint8Array([4, 5, 6]);
    const runMock = vi.fn().mockResolvedValue(outputBytes);
    const loadGhostscript = vi.fn().mockResolvedValue({
      run: runMock,
    });

    const result = await runGhostscript(inputBytes, "media", { loadGhostscript });

    expect(loadGhostscript).toHaveBeenCalledTimes(1);
    expect(result).toBe(outputBytes);

    const runArgs = runMock.mock.calls[0];
    expect(runArgs[0]).toBe(inputBytes);
    expect(runArgs[1]).toContain("-sDEVICE=pdfwrite");
    expect(runArgs[1]).toContain("-dPDFSETTINGS=/ebook");
    expect(runArgs[1]).toContain("-dNOPAUSE");
    expect(runArgs[1]).toContain("-dBATCH");
  });

  it("propagates loader errors with a clean message", async () => {
    const loadGhostscript = vi.fn().mockRejectedValue(new Error("WASM load failed"));
    await expect(
      runGhostscript(new Uint8Array([1]), "media", { loadGhostscript }),
    ).rejects.toThrow(/motor de compresión/);
  });

  it("propagates GS run errors with a clean message", async () => {
    const loadGhostscript = vi.fn().mockResolvedValue({
      run: vi.fn().mockRejectedValue(new Error("gs exited with code 1")),
    });
    await expect(
      runGhostscript(new Uint8Array([1]), "alta", { loadGhostscript }),
    ).rejects.toThrow(/No se pudo comprimir/);
  });

  it("calls onProgress at 50% then 100% on a small-input single run", async () => {
    const runMock = vi.fn().mockResolvedValue(new Uint8Array([9]));
    const loadGhostscript = vi.fn().mockResolvedValue({ run: runMock });
    const onProgress = vi.fn();

    await runGhostscript(new Uint8Array([1, 2, 3]), "media", { loadGhostscript }, { onProgress });

    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(100);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});

// We mock pdf-lib so the chunked-path tests don't need a real PDF parser.
vi.mock("pdf-lib", async () => {
  return {
    PDFDocument: {
      load: vi.fn(),
      create: vi.fn(),
    },
  };
});

import { PDFDocument } from "pdf-lib";

describe("runGhostscript (chunked path for large PDFs)", () => {
  const SIX_MB = 6 * 1024 * 1024;

  beforeEach(() => {
    vi.mocked(PDFDocument.load).mockReset();
    vi.mocked(PDFDocument.create).mockReset();
  });

  it("splits inputs above the chunk threshold into per-page-range runs", async () => {
    // 6 MB input → goes straight to the chunked path (threshold is 5 MB).
    const input = new Uint8Array(SIX_MB);

    const sourceDoc = {
      getPageCount: () => 25,
      save: vi.fn().mockResolvedValue(new Uint8Array([99])),
    };
    const chunkDocs = [
      { getPageIndices: () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { getPageIndices: () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { getPageIndices: () => [0, 1, 2, 3, 4] },
    ];
    const merged = {
      copyPages: vi
        .fn()
        .mockImplementation(async (_doc: unknown, indices: number[]) =>
          indices.map((i) => ({ page: i })),
        ),
      addPage: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array([42])),
    };

    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(sourceDoc as never)
      .mockResolvedValueOnce(chunkDocs[0] as never)
      .mockResolvedValueOnce(chunkDocs[1] as never)
      .mockResolvedValueOnce(chunkDocs[2] as never);
    vi.mocked(PDFDocument.create).mockResolvedValue(merged as never);

    const runMock = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]))
      .mockResolvedValueOnce(new Uint8Array([3]));
    const loadGhostscript = vi.fn().mockResolvedValue({ run: runMock });

    const result = await runGhostscript(input, "alta", { loadGhostscript });

    expect(result).toEqual(new Uint8Array([42]));
    expect(runMock).toHaveBeenCalledTimes(3);

    // First chunk uses 10-page range, second 10, third 5 (last pages).
    expect(runMock.mock.calls[0][1]).toContain("-sPageList=1-10");
    expect(runMock.mock.calls[1][1]).toContain("-sPageList=11-20");
    expect(runMock.mock.calls[2][1]).toContain("-sPageList=21-25");

    expect(merged.addPage).toHaveBeenCalledTimes(25);
  });

  it("falls back to smaller chunk sizes when the first chunk size OOMs", async () => {
    const input = new Uint8Array(SIX_MB);
    const sourceDoc = {
      getPageCount: () => 25,
      save: vi.fn().mockResolvedValue(new Uint8Array([88])),
    };

    const chunkDoc = { getPageIndices: () => [0] };
    const merged = {
      copyPages: vi.fn().mockResolvedValue([{ page: 0 }]),
      addPage: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array([7])),
    };

    vi.mocked(PDFDocument.load).mockImplementation(async (bytes: unknown) => {
      // First call: source doc. Subsequent calls: chunk docs (all 1 page).
      if (bytes === input) return sourceDoc as never;
      return chunkDoc as never;
    });
    vi.mocked(PDFDocument.create).mockResolvedValue(merged as never);

    // First GS run OOMs (the single-run attempt at the top of the small
    // path) and then every chunk run also OOMs, but we should still get a
    // sensible final error rather than a raw Emscripten message.
    const oomError = new Error(
      "Aborted(Cannot enlarge memory, asked to go up to 2688102400 bytes)",
    );
    const runMock = vi.fn().mockRejectedValue(oomError);
    const loadGhostscript = vi.fn().mockResolvedValue({ run: runMock });

    await expect(
      runGhostscript(input, "media", { loadGhostscript }),
    ).rejects.toThrow(/Memoria/);

    // Run was attempted multiple times: 1 single-run + 4 chunk sizes × ceil(25/size).
    expect(runMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("repairs the input via pdf-lib before passing bytes to GS in the chunked path", async () => {
    const input = new Uint8Array(SIX_MB);
    const repairedBytes = new Uint8Array([7, 7, 7, 7]);

    const sourceDoc = {
      getPageCount: () => 5,
      save: vi.fn().mockResolvedValue(repairedBytes),
    };
    const chunkDoc = { getPageIndices: () => [0] };
    const merged = {
      copyPages: vi.fn().mockResolvedValue([{ page: 0 }]),
      addPage: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array([42])),
    };

    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(sourceDoc as never)
      .mockResolvedValue(chunkDoc as never);
    vi.mocked(PDFDocument.create).mockResolvedValue(merged as never);

    const runMock = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const loadGhostscript = vi.fn().mockResolvedValue({ run: runMock });

    await runGhostscript(input, "media", { loadGhostscript });

    // Every GS run in the chunked path must receive the repaired bytes,
    // not the original (potentially corrupt) input.
    expect(runMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of runMock.mock.calls) {
      expect(call[0]).toBe(repairedBytes);
    }
    expect(sourceDoc.save).toHaveBeenCalledWith(
      expect.objectContaining({ useObjectStreams: false }),
    );
  });

  it("throws a friendly error when pdf-lib cannot load the input PDF", async () => {
    const input = new Uint8Array(SIX_MB);
    vi.mocked(PDFDocument.load).mockReset();
    vi.mocked(PDFDocument.load).mockRejectedValue(new Error("bad PDF"));

    const runMock = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const loadGhostscript = vi.fn().mockResolvedValue({ run: runMock });

    await expect(
      runGhostscript(input, "media", { loadGhostscript }),
    ).rejects.toThrow(/No se pudo cargar/);

    // GS should never be invoked if the input can't even be loaded.
    expect(runMock).not.toHaveBeenCalled();
  });
});