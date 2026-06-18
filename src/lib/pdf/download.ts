export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type NameSuffix = "foliado" | "comprimido" | "modificado";

export function suggestFileName(original: string, suffix: NameSuffix): string {
  const dot = original.lastIndexOf(".");
  if (dot === -1) return `${original}-${suffix}`;
  return `${original.slice(0, dot)}-${suffix}${original.slice(dot)}`;
}