import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loadPdfFromFile } from "./load";

async function makePdfFile(numPages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    doc.addPage([200, 200]);
  }
  const bytes = await doc.save();
  return new File([new Blob([bytes], { type: "application/pdf" })], "test.pdf", { type: "application/pdf" });
}

describe("loadPdfFromFile", () => {
  it("loads a valid PDF and returns document and page count", async () => {
    const file = await makePdfFile(3);
    const result = await loadPdfFromFile(file);
    expect(result.pageCount).toBe(3);
    expect(result.fileName).toBe("test.pdf");
    expect(result.fileSize).toBe(file.size);
  });

  it("rejects a non-PDF file", async () => {
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    await expect(loadPdfFromFile(file)).rejects.toThrow("El archivo debe ser un PDF");
  });

  it("rejects a file with PDF extension but invalid content", async () => {
    const file = new File(["not a pdf"], "fake.pdf", { type: "application/pdf" });
    await expect(loadPdfFromFile(file)).rejects.toThrow();
  });
});
