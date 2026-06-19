import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadBlob, suggestFileName } from "./download";

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates an object URL and triggers a download", () => {
    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();

    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const link = document.createElement("a");
    link.click = click;
    vi.spyOn(document, "createElement").mockReturnValue(link);

    const blob = new Blob(["data"], { type: "application/pdf" });
    downloadBlob(blob, "out.pdf");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(link.href).toBe("blob:fake-url");
    expect(link.download).toBe("out.pdf");
    expect(click).toHaveBeenCalled();
    // Revoke is deferred so the browser has time to start reading the blob URL
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});

describe("suggestFileName", () => {
  it("appends -foliado before the extension", () => {
    expect(suggestFileName("doc.pdf", "foliado")).toBe("doc-foliado.pdf");
  });

  it("appends -comprimido before the extension", () => {
    expect(suggestFileName("informe.pdf", "comprimido")).toBe("informe-comprimido.pdf");
  });

  it("appends -modificado before the extension", () => {
    expect(suggestFileName("anexo.pdf", "modificado")).toBe("anexo-modificado.pdf");
  });

  it("handles files without extension", () => {
    expect(suggestFileName("archivo", "foliado")).toBe("archivo-foliado");
  });
});