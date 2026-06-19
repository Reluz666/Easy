import type { NumberStyle } from "./foliar/types";

export type { NumberStyle };

const UNITS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TWENTIES = ["veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

export function numberToWords(n: number): string {
  if (n < 0) return "";
  if (n === 0) return "cero";
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return TWENTIES[n - 20];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const unit = n % 10;
    return unit === 0 ? TENS[tens] : `${TENS[tens]} y ${UNITS[unit]}`;
  }
  if (n === 100) return "cien";
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return rest === 0 ? HUNDREDS[hundreds] : `${HUNDREDS[hundreds]} ${numberToWords(rest)}`;
  }
  if (n === 1000) return "mil";
  if (n < 10000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const thousandsWord = thousands === 1 ? "mil" : `${UNITS[thousands]} mil`;
    if (rest === 0) return thousandsWord;
    return `${thousandsWord} ${numberToWords(rest)}`;
  }
  return String(n);
}

export function formatFolio(style: NumberStyle, current: number, total: number): string {
  switch (style) {
    case "numbers":
      return String(current);
    case "words":
      return numberToWords(current);
    case "both":
      return `${numberToWords(current)} ${current}`;
    case "n-t":
      return `${current}/${total}`;
  }
}
