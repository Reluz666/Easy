/**
 * Foliation configuration sent to POST /api/jobs/foliate.
 *
 * Mirrors the backend's `FoliateParams` exactly so the form field names
 * match what the API expects. Anything beyond this set lives on the server.
 */
export type FolioPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export const FOLIO_POSITIONS: FolioPosition[] = [
  "top-left", "top-center", "top-right",
  "bottom-left", "bottom-center", "bottom-right",
];

export type FolioRangeMode = "all" | "from-to";

export type FoliarConfig = {
  initial_number: number;       // ≥ 1; default 1
  prefix: string;               // optional, e.g. "Folio "
  position: FolioPosition;      // default "bottom-center"
  font_size: number;            // 6–72 pt; default 12
  range_mode: FolioRangeMode;   // default "all"
  from_page: number | null;     // 1-indexed; required when range_mode="from-to"
  to_page: number | null;       // 1-indexed; required when range_mode="from-to"
};

export const DEFAULT_FOLIAR_CONFIG: FoliarConfig = {
  initial_number: 1,
  prefix: "",
  position: "bottom-center",
  font_size: 12,
  range_mode: "all",
  from_page: null,
  to_page: null,
};

export const FOLIO_FONT_SIZE_MIN = 6;
export const FOLIO_FONT_SIZE_MAX = 72;
