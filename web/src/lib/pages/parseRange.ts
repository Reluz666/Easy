/**
 * Parse a user-typed page-list string into a 1-indexed, sorted, unique array.
 *
 * Accepted syntax:
 *   "2"          -> [2]
 *   "2,5,7"      -> [2, 5, 7]
 *   "2-5"        -> [2, 3, 4, 5]    (inclusive)
 *   "2-5,7,9-10" -> [2, 3, 4, 5, 7, 9, 10]
 *   " 2 , 5 "    -> [2, 5]           (whitespace tolerated)
 *
 * Returns `null` when the input can't be parsed at all (empty after trim,
 * non-numeric tokens, ranges whose left > right, missing endpoints).
 *
 * Why we don't accept "all" / "every page":
 *   "all" means a different op shape (delete with no `pages` key) and
 *   makes the UI's preview ambiguous. The "Seleccionar todo" button on
 *   the page builder calls `Array.from({length:n}, (_,i)=>i+1)` directly.
 */
export function parseRange(raw: string): number[] | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const out = new Set<number>();
  for (const partRaw of trimmed.split(",")) {
    const part = partRaw.trim();
    if (!part) return null;
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    const singleMatch = /^(\d+)$/.exec(part);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      if (from < 1 || to < from) return null;
      for (let i = from; i <= to; i++) out.add(i);
    } else if (singleMatch) {
      const n = Number(singleMatch[1]);
      if (n < 1) return null;
      out.add(n);
    } else {
      return null;
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Same as `parseRange`, but additionally rejects pages > `totalPages`.
 * Returns a Spanish error string suitable for inline display, or `null`
 * when the input is valid.
 */
export function validateRange(
  raw: string,
  totalPages: number,
  label = "páginas",
): string | null {
  const parsed = parseRange(raw);
  if (parsed === null) {
    return `Indicá las ${label} a editar (ej: 2,5,7-9).`;
  }
  if (parsed.length === 0) {
    return `Indicá al menos una página.`;
  }
  const over = parsed.filter((p) => p > totalPages);
  if (over.length > 0) {
    return `Estas páginas están fuera del rango 1..${totalPages}: ${over.join(", ")}.`;
  }
  return null;
}

/**
 * Parse a user-typed page list as an *order-preserving* permutation,
 * e.g. "3,1,2,4" -> [3, 1, 2, 4]. Unlike `parseRange`, this does NOT
 * sort or deduplicate — both are errors in this context:
 *
 *   - Reorder ops are permutations where position matters; the worker
 *     reads the array as "new position i ← current page order[i]".
 *   - Duplicates would mean "this old page goes to two new positions",
 *     which is meaningless.
 *
 * Accepts the same range syntax as `parseRange` (so the user can type
 * "1-3,5,4" → [1,2,3,5,4]). Returns `null` for empty input, non-numeric
 * tokens, inverted ranges, pages < 1, or duplicates.
 */
export function parseOrder(raw: string): number[] | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const out: number[] = [];
  const seen = new Set<number>();
  for (const partRaw of trimmed.split(",")) {
    const part = partRaw.trim();
    if (!part) return null;
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    const singleMatch = /^(\d+)$/.exec(part);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      if (from < 1 || to < from) return null;
      for (let i = from; i <= to; i++) {
        if (seen.has(i)) return null;
        seen.add(i);
        out.push(i);
      }
    } else if (singleMatch) {
      const n = Number(singleMatch[1]);
      if (n < 1) return null;
      if (seen.has(n)) return null;
      seen.add(n);
      out.push(n);
    } else {
      return null;
    }
  }
  return out;
}

/**
 * Format an array of 1-indexed page numbers back to the compact string
 * form, e.g. [1, 2, 3, 5, 7, 8, 9] -> "1-3,5,7-9". Used to render the
 * current selection in the UI's summary line.
 */
export function formatRange(pages: number[]): string {
  if (pages.length === 0) return "";
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j === i) {
      parts.push(String(start));
    } else if (j === i + 1) {
      parts.push(`${start},${sorted[j]}`);
    } else {
      parts.push(`${start}-${sorted[j]}`);
    }
    i = j + 1;
  }
  return parts.join(",");
}
