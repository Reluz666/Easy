import type { FoliarConfig } from "./types";

export function validateFolioRange(
  range: FoliarConfig["range"],
  totalPages: number
): string | null {
  if (range.initialNumber < 1) {
    return "Número inicial debe ser mayor o igual a 1.";
  }
  if (range.from < 1 || range.from > totalPages) {
    return "Desde pág. debe estar entre 1 y el total de páginas.";
  }
  if (range.to < range.from || range.to > totalPages) {
    return "Hasta pág. debe ser mayor o igual a Desde pág. y no superar el total.";
  }
  return null;
}
