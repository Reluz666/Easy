export type FolioPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export const FOLIO_POSITIONS: FolioPosition[] = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];

export type FolioFormatTemplate =
  | "Folio N de TOTAL"
  | "Página N de TOTAL"
  | "N / TOTAL"
  | "N";

export const FOLIO_FORMAT_TEMPLATES: FolioFormatTemplate[] = [
  "Folio N de TOTAL",
  "Página N de TOTAL",
  "N / TOTAL",
  "N",
];

export type NumberStyle = "numbers" | "letters" | "both" | "words";

export type FolioFont = "Helvetica" | "TimesRoman" | "Courier" | "Verdana" | "Georgia";

export const FOLIO_FONTS: FolioFont[] = [
  "Helvetica",
  "TimesRoman",
  "Courier",
  "Verdana",
  "Georgia",
];

export type FoliarConfig = {
  position: FolioPosition;
  format: FolioFormatTemplate;
  numberStyle: NumberStyle;
  font: FolioFont;
  fontSize: number;     // pt; range 6–72
  color: string;        // hex like "#000000"
  range: {
    initialNumber: number; // default 1
    from: number;          // page where foliado starts (1-indexed)
    to: number;            // page where foliado ends (1-indexed)
  };
};

export const DEFAULT_FOLIAR_CONFIG: FoliarConfig = {
  position: "bottom-center",
  format: "Folio N de TOTAL",
  numberStyle: "numbers",
  font: "Helvetica",
  fontSize: 12,
  color: "#000000",
  range: {
    initialNumber: 1,
    from: 1,
    to: 1, // overwritten when a PDF is loaded
  },
};

export const FOLIO_FONT_SIZE_MIN = 6;
export const FOLIO_FONT_SIZE_MAX = 72;
export const FOLIO_MARGIN_PT = 24; // distance from page edge to folio text
