import type { FoliarConfig } from "./types";
import { FOLIO_FONT_SIZE_MAX, FOLIO_FONT_SIZE_MIN } from "./types";

/**
 * Validate the foliation config + the actual PDF page count.
 *
 * Returns a Spanish error string suitable for inline display, or `null`
 * when the config is valid for a document of `totalPages` pages.
 *
 * The shape check (from_page <= to_page when both present) is duplicated
 * on the backend and rejected synchronously with PAGES_FAILED — these
 * validators are the client's first line of defense so users see the
 * error before the upload starts.
 */
export function validateFoliateConfig(
  config: FoliarConfig,
  totalPages: number | null,
): string | null {
  if (!Number.isFinite(config.initial_number) || config.initial_number < 1) {
    return "Número inicial debe ser mayor o igual a 1.";
  }
  if (
    !Number.isFinite(config.font_size) ||
    config.font_size < FOLIO_FONT_SIZE_MIN ||
    config.font_size > FOLIO_FONT_SIZE_MAX
  ) {
    return `Tamaño de fuente debe estar entre ${FOLIO_FONT_SIZE_MIN} y ${FOLIO_FONT_SIZE_MAX} pt.`;
  }
  if (totalPages === null) return null; // file not loaded yet
  if (config.range_mode === "all") return null;
  if (config.from_page === null || config.to_page === null) {
    return "Indicá desde y hasta qué página foliar.";
  }
  if (config.from_page < 1 || config.from_page > totalPages) {
    return `Desde pág. debe estar entre 1 y ${totalPages}.`;
  }
  if (config.to_page < config.from_page || config.to_page > totalPages) {
    return `Hasta pág. debe estar entre ${config.from_page} y ${totalPages}.`;
  }
  return null;
}
