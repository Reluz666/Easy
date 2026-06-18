export type FolioFormat =
  | "Folio N de TOTAL"
  | "Página N de TOTAL"
  | "N / TOTAL"
  | "N";

export type NumberStyle = "numbers" | "letters" | "both";

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

function formatNumber(n: number, style: NumberStyle): string {
  if (style === "letters") return numberToLetters(n);
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
