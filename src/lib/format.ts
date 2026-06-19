export type FolioFormat =
  | "Folio N de TOTAL"
  | "Página N de TOTAL"
  | "N / TOTAL"
  | "N";

export type NumberStyle = "numbers" | "letters" | "both" | "words";

function numberToLetters(n: number): string {
  let result = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}

const UNITS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TWENTIES = ["veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function numberToWords(n: number): string {
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

function formatNumber(n: number, style: NumberStyle): string {
  if (style === "letters") return numberToLetters(n);
  if (style === "words") return numberToWords(n);
  if (style === "both") return `${n}-${numberToLetters(n)}`;
  return String(n);
}

export function formatFolio(
  template: FolioFormat,
  current: number,
  total: number,
  style: NumberStyle = "numbers"
): string {
  const n = formatNumber(current, style);
  return template.replace("N", n).replace("TOTAL", String(total));
}
