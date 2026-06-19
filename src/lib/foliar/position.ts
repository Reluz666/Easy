import { FOLIO_MARGIN_PT } from "./types";
import type { FolioPosition } from "./types";

export { FOLIO_MARGIN_PT };

/**
 * Calcula el (x, y) en coordenadas del MediaBox del PDF donde debe dibujarse
 * el folio, considerando la rotación de la página (/Rotate) para que el folio
 * quede visualmente en la posición solicitada (top/middle/bottom × left/center/right)
 * y con la "orientación natural" de la página: horizontal en páginas verticales
 * (/Rotate 0/180) y vertical en páginas apaisadas (/Rotate 90/270).
 *
 * El texto se dibuja siempre horizontal en el MediaBox (rotate=0); el visor
 * rota el folio junto con el resto de la página, así un folio apaisado queda
 * vertical al ver la página, y uno vertical queda horizontal.
 */
export function getFolioPdfCoords(
  position: FolioPosition,
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
  rotation: number = 0,
  margin: number = FOLIO_MARGIN_PT
): { x: number; y: number; rotate: number } {
  const rot = normalizeRotation(rotation);

  // Dimensiones visibles después de aplicar /Rotate en el visor
  const visualW = rot === 90 || rot === 270 ? pageHeight : pageWidth;
  const visualH = rot === 90 || rot === 270 ? pageWidth : pageHeight;

  const [valign, halign] = position.split("-") as [
    "top" | "middle" | "bottom",
    "left" | "center" | "right"
  ];

  // Posición del anchor (baseline-left) del texto en coordenadas visuales
  // (origen top-left, x→derecha, y→abajo)
  let visualX: number;
  if (halign === "left") visualX = margin;
  else if (halign === "right") visualX = visualW - textWidth - margin;
  else visualX = (visualW - textWidth) / 2;

  let visualYFromTop: number;
  if (valign === "top") visualYFromTop = margin + fontSize;
  else if (valign === "bottom") visualYFromTop = visualH - margin;
  else visualYFromTop = (visualH + fontSize) / 2;

  // Transformar coords visuales → coords del MediaBox (origen bottom-left)
  // según el /Rotate aplicado por el visor.
  let mediaX: number;
  let mediaY: number;
  switch (rot) {
    case 90:
      // Visual (vx, vyTop) ↔ MediaBox (vyTop, pageHeight - vx)
      mediaX = visualYFromTop;
      mediaY = pageHeight - visualX;
      break;
    case 180:
      // Visual (vx, vyTop) ↔ MediaBox (pageWidth - vx, pageHeight - vyTop)
      mediaX = pageWidth - visualX;
      mediaY = pageHeight - visualYFromTop;
      break;
    case 270:
      // Visual (vx, vyTop) ↔ MediaBox (pageWidth - vyTop, vx)
      mediaX = pageWidth - visualYFromTop;
      mediaY = visualX;
      break;
    case 0:
    default:
      mediaX = visualX;
      mediaY = pageHeight - visualYFromTop;
  }

  // El folio debe quedar en la "orientación natural" de la página: horizontal
  // en páginas verticales (/Rotate 0/180) y vertical en páginas apaisadas
  // (/Rotate 90/270). Por eso NO se contrarresta la rotación de la página:
  // se dibuja el texto horizontal en el MediaBox y el visor lo rota junto
  // con el resto de la página.
  const textRotate = 0;

  return { x: mediaX, y: mediaY, rotate: textRotate };
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  if (r === 90) return 90;
  if (r === 180) return 180;
  if (r === 270) return 270;
  return 0;
}