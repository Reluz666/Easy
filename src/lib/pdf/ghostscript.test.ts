import { describe, it, expect, vi } from "vitest";
import { levelToGsArgs, runGhostscript } from "./ghostscript";

describe("levelToGsArgs", () => {
  it("maps 'baja' to /printer (150 dpi)", () => {
    expect(levelToGsArgs("baja")).toEqual(["-dPDFSETTINGS=/printer"]);
  });

  it("maps 'media' to /ebook (100 dpi)", () => {
    expect(levelToGsArgs("media")).toEqual(["-dPDFSETTINGS=/ebook"]);
  });

  it("maps 'alta' to /screen (72 dpi)", () => {
    expect(levelToGsArgs("alta")).toEqual(["-dPDFSETTINGS=/screen"]);
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
});