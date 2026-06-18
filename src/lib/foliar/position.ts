import { FOLIO_MARGIN_PT } from "./types";
import type { FolioPosition } from "./types";

export { FOLIO_MARGIN_PT };

export function getFolioPdfCoords(
  position: FolioPosition,
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  textHeight: number,
  margin: number = FOLIO_MARGIN_PT
): { x: number; y: number } {
  const [valign, halign] = position.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];

  let x: number;
  if (halign === "left") x = margin;
  else if (halign === "right") x = pageWidth - textWidth - margin;
  else x = (pageWidth - textWidth) / 2;

  let y: number;
  if (valign === "bottom") y = margin;
  else if (valign === "top") y = pageHeight - textHeight - margin;
  else y = (pageHeight - textHeight) / 2;

  return { x, y };
}
