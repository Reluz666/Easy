export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  // Defer cleanup so the browser has time to start reading from the blob URL.
  // Revoking too early can produce empty/truncated downloads in Chrome and Edge.
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 0);
}

export type NameSuffix = "foliado" | "comprimido" | "modificado";

export function suggestFileName(original: string, suffix: NameSuffix): string {
  const dot = original.lastIndexOf(".");
  if (dot === -1) return `${original}-${suffix}`;
  return `${original.slice(0, dot)}-${suffix}${original.slice(dot)}`;
}