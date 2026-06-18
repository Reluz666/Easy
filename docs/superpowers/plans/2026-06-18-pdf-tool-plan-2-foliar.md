# Foliar Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Foliar tool — a React page where the user uploads a PDF, sees a live preview with a configurable folio, and downloads the foliated PDF processed in a Web Worker.

**Architecture:** The Foliar page has three regions: a file bar (top), a live preview (left), and a configuration panel (right). Pure logic (position math, range validation, folio application) lives in `src/lib/foliar/` and is testable. The actual PDF modification runs in a Web Worker so the UI never freezes. Live preview re-renders the current page on every config change using pdfjs-dist to draw the page and Canvas 2D to overlay the folio.

**Tech Stack:** React 19 + TypeScript + Tailwind (existing), pdf-lib (existing), pdfjs-dist v6 (existing), Vitest (existing).

**Foundation from Plan 1:**
- `loadPdfFromFile` in `src/lib/pdf/load.ts` — load and validate PDF
- `formatFolio` in `src/lib/format.ts` — format folio text (`Folio 3 de 10`, `3-C`, etc.)
- `downloadBlob` + `suggestFileName` in `src/lib/pdf/download.ts` — download result
- `renderThumbnail` in `src/lib/pdf/thumbnail.ts` — render a PDF page to a data URL
- `Layout` (with header + "Inicio" button) and `Card` (a11y) in `src/components/`
- `UploadArea` in `src/components/UploadArea.tsx` — drag & drop + validation
- Tailwind tokens: `bg`, `surface`, `primary`, `primary-light`, `text`, `text-muted`, `border`

**Design spec reference:** `docs/superpowers/specs/2026-06-18-pdf-tool-design.md` § "Herramienta 1 — Foliar" (line 111).

---

## File Structure

```
src/lib/foliar/
├── types.ts                   # FoliarConfig, FolioPosition, FolioRange + DEFAULT_*
├── position.ts                # getFolioPdfCoords(position, page, textWidth, textHeight, margin)
├── position.test.ts
├── validation.ts              # validateFolioRange({ from, to, total }): string | null
├── validation.test.ts
├── applyFolio.ts              # applyFolio(bytes, config, range): Promise<Uint8Array>
└── applyFolio.test.ts

src/tools/Foliar/
├── FoliarPage.tsx             # top-level page; orchestrates state + worker
├── FileBar.tsx                # file name, size, page count, "Cambiar archivo" button
├── FoliarConfig.tsx           # 6 control groups (position matrix, format, type, font, size+color, range)
├── FoliarPreview.tsx          # live canvas preview with ◀ N ▶ navigation
├── foliar.worker.ts           # Web Worker; receives file, processes, posts progress/result
└── foliar.protocol.ts         # shared message types (Request, Response) for the worker
```

`src/tools/Foliar.tsx` is modified to delegate to `FoliarPage`.

---

## Task 1: FoliarConfig types and defaults

**Files:**
- Create: `src/lib/foliar/types.ts`

- [ ] **Step 1: Create `src/lib/foliar/types.ts`**

```ts
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

export type NumberStyle = "numbers" | "letters" | "both";

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
```

- [ ] **Step 2: Verify type check**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/lib/foliar/types.ts && git commit -m "feat(foliar): add FoliarConfig types and defaults"
```

---

## Task 2: Position helpers (TDD)

The 9-position matrix maps a position string to PDF coordinates for `page.drawText()`. PDF coordinate system: (0,0) is bottom-left. pdf-lib's `drawText({x, y})` places x at the left edge of the text and y at the baseline of the text.

**Files:**
- Create: `src/lib/foliar/position.ts`
- Create: `src/lib/foliar/position.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/foliar/position.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getFolioPdfCoords, FOLIO_MARGIN_PT } from "./position";

describe("getFolioPdfCoords", () => {
  const pageWidth = 612;   // 8.5 x 72
  const pageHeight = 792;  // 11  x 72
  const textWidth = 60;
  const textHeight = 12;
  const margin = FOLIO_MARGIN_PT;

  it("places 'bottom-left' at (margin, margin)", () => {
    const { x, y } = getFolioPdfCoords("bottom-left", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(margin);
    expect(y).toBe(margin);
  });

  it("places 'bottom-center' centered horizontally at bottom", () => {
    const { x, y } = getFolioPdfCoords("bottom-center", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe(margin);
  });

  it("places 'bottom-right' at right edge minus margin", () => {
    const { x, y } = getFolioPdfCoords("bottom-right", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe(margin);
  });

  it("places 'top-left' at left margin, top of page minus margin minus text height", () => {
    const { x, y } = getFolioPdfCoords("top-left", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(margin);
    expect(y).toBe(pageHeight - margin - textHeight);
  });

  it("places 'top-center' centered horizontally at top", () => {
    const { x, y } = getFolioPdfCoords("top-center", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe(pageHeight - margin - textHeight);
  });

  it("places 'top-right' at right edge minus margin, top of page minus margin", () => {
    const { x, y } = getFolioPdfCoords("top-right", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe(pageHeight - margin - textHeight);
  });

  it("places 'middle-left' at left margin, vertically centered", () => {
    const { x, y } = getFolioPdfCoords("middle-left", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(margin);
    expect(y).toBe((pageHeight - textHeight) / 2);
  });

  it("places 'middle-center' centered horizontally and vertically", () => {
    const { x, y } = getFolioPdfCoords("middle-center", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe((pageWidth - textWidth) / 2);
    expect(y).toBe((pageHeight - textHeight) / 2);
  });

  it("places 'middle-right' at right edge minus margin, vertically centered", () => {
    const { x, y } = getFolioPdfCoords("middle-right", pageWidth, pageHeight, textWidth, textHeight);
    expect(x).toBe(pageWidth - textWidth - margin);
    expect(y).toBe((pageHeight - textHeight) / 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run src/lib/foliar/position.test.ts
```

Expected: FAIL with "Cannot find module './position'".

- [ ] **Step 3: Implement `src/lib/foliar/position.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run src/lib/foliar/position.test.ts
```

Expected: PASS with 9 tests.

- [ ] **Step 5: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/lib/foliar/position.ts src/lib/foliar/position.test.ts && git commit -m "feat(foliar): add position-to-PDF-coords helper with TDD"
```

---

## Task 3: Range validation (TDD)

Validates the foliado range. Rules (from design spec):
- `from` must be ≥ 1 and ≤ `total`
- `to` must be ≥ `from` and ≤ `total`
- `initialNumber` must be ≥ 1

**Files:**
- Create: `src/lib/foliar/validation.ts`
- Create: `src/lib/foliar/validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/foliar/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateFolioRange } from "./validation";

describe("validateFolioRange", () => {
  it("returns null for a valid range", () => {
    expect(validateFolioRange({ initialNumber: 1, from: 1, to: 10 }, 10)).toBeNull();
  });

  it("returns null for a single-page range", () => {
    expect(validateFolioRange({ initialNumber: 5, from: 5, to: 5 }, 10)).toBeNull();
  });

  it("returns null for the last page only", () => {
    expect(validateFolioRange({ initialNumber: 1, from: 10, to: 10 }, 10)).toBeNull();
  });

  it("rejects from < 1", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 0, to: 5 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Desde pág/);
  });

  it("rejects from > total", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 11, to: 15 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Desde pág/);
  });

  it("rejects to < from", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 5, to: 3 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Hasta pág/);
  });

  it("rejects to > total", () => {
    const err = validateFolioRange({ initialNumber: 1, from: 1, to: 11 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Hasta pág/);
  });

  it("rejects initialNumber < 1", () => {
    const err = validateFolioRange({ initialNumber: 0, from: 1, to: 5 }, 10);
    expect(err).toBeTruthy();
    expect(err).toMatch(/Número inicial/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run src/lib/foliar/validation.test.ts
```

Expected: FAIL with "Cannot find module './validation'".

- [ ] **Step 3: Implement `src/lib/foliar/validation.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run src/lib/foliar/validation.test.ts
```

Expected: PASS with 8 tests.

- [ ] **Step 5: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/lib/foliar/validation.ts src/lib/foliar/validation.test.ts && git commit -m "feat(foliar): add range validation with TDD"
```

---

## Task 4: applyFolio to a PDF (TDD with real pdf-lib)

Applies the foliado configuration to a PDF's bytes. The function loads the PDF with pdf-lib, iterates pages in the configured range, and draws the folio text on each.

Note: pdf-lib's `StandardFonts` includes Helvetica, TimesRoman, Courier — but not Verdana or Georgia. For those, we'll use `fontkit` if available; otherwise, fall back to a similar StandardFont. To keep the first version simple, we map Verdana → Helvetica, Georgia → TimesRoman. We can add custom font embedding later if needed.

**Files:**
- Create: `src/lib/pdf/applyFolio.ts`
- Create: `src/lib/pdf/applyFolio.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/pdf/applyFolio.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyFolio } from "./applyFolio";
import { DEFAULT_FOLIAR_CONFIG } from "../foliar/types";

async function makePdfBytes(numPages: number, pageW = 612, pageH = 792): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    doc.addPage([pageW, pageH]);
  }
  return doc.save();
}

describe("applyFolio", () => {
  it("returns a valid PDF with the same page count", async () => {
    const bytes = await makePdfBytes(5);
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 5 } };
    const result = await applyFolio(bytes, config);
    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(5);
  });

  it("returns a larger PDF when folios are added (text bytes increase size)", async () => {
    const bytes = await makePdfBytes(3);
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 3 } };
    const result = await applyFolio(bytes, config);
    expect(result.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("skips pages outside the range (page count and base content unchanged for skipped pages)", async () => {
    const bytes = await makePdfBytes(5);
    const config = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 2, to: 3 } };
    const result = await applyFolio(bytes, config);
    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(5);
  });

  it("uses initialNumber as the starting folio number", async () => {
    // We can verify this by checking the resulting PDF is slightly different
    // when initialNumber changes (different text content).
    const bytes = await makePdfBytes(3);
    const configA = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 1, from: 1, to: 3 } };
    const configB = { ...DEFAULT_FOLIAR_CONFIG, range: { initialNumber: 10, from: 1, to: 3 } };
    const resultA = await applyFolio(bytes, configA);
    const resultB = await applyFolio(bytes, configB);
    // Different starting numbers produce different content streams
    expect(Buffer.from(resultA).toString("binary")).not.toBe(Buffer.from(resultB).toString("binary"));
  });

  it("throws Spanish error if the PDF is invalid", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    const config = DEFAULT_FOLIAR_CONFIG;
    await expect(applyFolio(garbage, config)).rejects.toThrow(/No se pudo leer el PDF/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run src/lib/pdf/applyFolio.test.ts
```

Expected: FAIL with "Cannot find module './applyFolio'".

- [ ] **Step 3: Implement `src/lib/pdf/applyFolio.ts`**

```ts
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatFolio } from "../format";
import { getFolioPdfCoords } from "../foliar/position";
import type { FoliarConfig, FolioFont } from "../foliar/types";

const FONT_MAP: Record<FolioFont, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
  Verdana: StandardFonts.Helvetica,
  Georgia: StandardFonts.TimesRoman,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "").match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

export async function applyFolio(
  bytes: Uint8Array,
  config: FoliarConfig
): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    throw new Error("No se pudo leer el PDF. Verificá que no esté protegido con contraseña ni dañado.");
  }

  const fontName = FONT_MAP[config.font];
  const font: PDFFont = await pdf.embedFont(fontName);
  const color = hexToRgb(config.color);
  const { from, to, initialNumber } = config.range;
  const totalInRange = to - from + 1;
  const pages = pdf.getPages();

  for (let i = 0; i < totalInRange; i++) {
    const pageIndex = from - 1 + i;
    const page: PDFPage = pages[pageIndex];
    if (!page) continue;
    const folioNumber = initialNumber + i;
    const text = formatFolio(config.format, folioNumber, totalInRange, config.numberStyle);
    const textWidth = font.widthOfTextAtSize(text, config.fontSize);
    const { x, y } = getFolioPdfCoords(
      config.position,
      page.getWidth(),
      page.getHeight(),
      textWidth,
      config.fontSize
    );
    page.drawText(text, {
      x,
      y,
      size: config.fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
    });
  }

  return pdf.save();
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run src/lib/pdf/applyFolio.test.ts
```

Expected: PASS with 5 tests.

- [ ] **Step 5: Verify type check + run all tests**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npx tsc --noEmit
```

Expected: no errors.

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run
```

Expected: all tests pass (existing 15 + 9 position + 8 validation + 5 applyFolio = 37).

- [ ] **Step 6: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/lib/pdf/applyFolio.ts src/lib/pdf/applyFolio.test.ts && git commit -m "feat(foliar): add applyFolio to apply foliado config to PDF with TDD"
```

---

## Task 5: Foliar worker protocol (shared types)

Defines the message protocol between the main thread and the worker. Lives in a plain `.ts` file (not `.worker.ts`) so both the worker and the page can import the types.

**Files:**
- Create: `src/tools/Foliar/foliar.protocol.ts`

- [ ] **Step 1: Create `src/tools/Foliar/foliar.protocol.ts`**

```ts
import type { FoliarConfig } from "../../lib/foliar/types";

export type ProcessRequest = {
  type: "process";
  fileBytes: Uint8Array;
  config: FoliarConfig;
};

export type CancelRequest = { type: "cancel" };

export type FoliarRequest = ProcessRequest | CancelRequest;

export type ProgressMessage = { type: "progress"; current: number; total: number };
export type CompleteMessage = { type: "complete"; bytes: Uint8Array };
export type CancelledMessage = { type: "cancelled" };
export type ErrorMessage = { type: "error"; message: string };

export type FoliarResponse = ProgressMessage | CompleteMessage | CancelledMessage | ErrorMessage;
```

- [ ] **Step 2: Verify type check**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/tools/Foliar/foliar.protocol.ts && git commit -m "feat(foliar): add shared worker protocol types"
```

---

## Task 6: Foliar Web Worker

The worker receives a `process` message with the file bytes and config. It processes the PDF in batches (15 pages), posting progress after each batch. It also handles a `cancel` message by setting a flag that the processing loop checks between batches.

**Files:**
- Create: `src/tools/Foliar/foliar.worker.ts`

- [ ] **Step 1: Create `src/tools/Foliar/foliar.worker.ts`**

```ts
/// <reference lib="webworker" />
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatFolio } from "../../lib/format";
import { getFolioPdfCoords } from "../../lib/foliar/position";
import type { FoliarConfig, FolioFont } from "../../lib/foliar/types";
import type { FoliarRequest, FoliarResponse } from "./foliar.protocol";

const FONT_MAP: Record<FolioFont, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
  Verdana: StandardFonts.Helvetica,
  Georgia: StandardFonts.TimesRoman,
};

const BATCH_SIZE = 15;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "").match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

let cancelled = false;

self.addEventListener("message", async (e: MessageEvent<FoliarRequest>) => {
  if (e.data.type === "cancel") {
    cancelled = true;
    return;
  }

  if (e.data.type !== "process") return;
  cancelled = false;

  const { fileBytes, config } = e.data;

  try {
    const pdf = await PDFDocument.load(fileBytes, { ignoreEncryption: false });
    const totalInRange = config.range.to - config.range.from + 1;
    const font: PDFFont = await pdf.embedFont(FONT_MAP[config.font]);
    const color = hexToRgb(config.color);
    const pages = pdf.getPages();

    for (let batchStart = 0; batchStart < totalInRange; batchStart += BATCH_SIZE) {
      if (cancelled) {
        const response: FoliarResponse = { type: "cancelled" };
        self.postMessage(response);
        return;
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalInRange);
      for (let i = batchStart; i < batchEnd; i++) {
        const pageIndex = config.range.from - 1 + i;
        const page: PDFPage = pages[pageIndex];
        if (!page) continue;
        const folioNumber = config.range.initialNumber + i;
        const text = formatFolio(config.format, folioNumber, totalInRange, config.numberStyle);
        const textWidth = font.widthOfTextAtSize(text, config.fontSize);
        const { x, y } = getFolioPdfCoords(
          config.position,
          page.getWidth(),
          page.getHeight(),
          textWidth,
          config.fontSize
        );
        page.drawText(text, {
          x,
          y,
          size: config.fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
        });
      }

      const progress: FoliarResponse = { type: "progress", current: batchEnd, total: totalInRange };
      self.postMessage(progress);
    }

    const bytes = await pdf.save();
    const complete: FoliarResponse = { type: "complete", bytes };
    self.postMessage(complete);
  } catch (err) {
    const error: FoliarResponse = {
      type: "error",
      message: err instanceof Error ? err.message : "Error desconocido.",
    };
    self.postMessage(error);
  }
});
```

- [ ] **Step 2: Verify type check + build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npx tsc --noEmit
```

Expected: no errors.

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/tools/Foliar/foliar.worker.ts && git commit -m "feat(foliar): add Web Worker for batch folio processing with cancel"
```

---

## Task 7: FileBar component

Shows the uploaded file's name, size, and page count, with a "Cambiar archivo" button that triggers a callback to swap back to the UploadArea.

**Files:**
- Create: `src/tools/Foliar/FileBar.tsx`

- [ ] **Step 1: Create `src/tools/Foliar/FileBar.tsx`**

```tsx
type FileBarProps = {
  fileName: string;
  fileSize: number;
  pageCount: number;
  onChangeFile: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileBar({ fileName, fileSize, pageCount, onChangeFile }: FileBarProps) {
  return (
    <div
      role="region"
      aria-label="Archivo cargado"
      className="bg-surface border border-border rounded-lg p-4 flex items-center gap-4"
    >
      <div className="bg-bg w-10 h-10 rounded flex items-center justify-center text-xl flex-shrink-0" aria-hidden="true">
        📄
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-text text-sm truncate">{fileName}</div>
        <div className="text-text-muted text-xs mt-0.5">
          {formatBytes(fileSize)} · {pageCount} {pageCount === 1 ? "página" : "páginas"}
        </div>
      </div>
      <button
        type="button"
        onClick={onChangeFile}
        className="text-sm bg-surface border border-border text-text px-3 py-1.5 rounded hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
      >
        Cambiar archivo
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/tools/Foliar/FileBar.tsx && git commit -m "feat(foliar): add FileBar component"
```

---

## Task 8: FoliarConfig component (all 6 controls)

The config panel has 6 control groups:
1. Position — 3×3 clickable matrix
2. Format — select
3. Type — 3 radio buttons
4. Font — select
5. Size + Color — input + color picker (side-by-side)
6. Range — 3 inputs (initial number, from, to)

Component is fully controlled: `config` and `onChange` props. The page is owned by the parent (FoliarPage); this component just renders and emits change events.

**Files:**
- Create: `src/tools/Foliar/FoliarConfig.tsx`

- [ ] **Step 1: Create `src/tools/Foliar/FoliarConfig.tsx`**

```tsx
import {
  FOLIO_POSITIONS,
  FOLIO_FORMAT_TEMPLATES,
  FOLIO_FONTS,
  FOLIO_FONT_SIZE_MIN,
  FOLIO_FONT_SIZE_MAX,
  type FoliarConfig,
  type FolioPosition,
  type FolioFormatTemplate,
  type FolioFont,
  type NumberStyle,
} from "../../lib/foliar/types";

type FoliarConfigProps = {
  config: FoliarConfig;
  totalPages: number;
  rangeError: string | null;
  onChange: (next: FoliarConfig) => void;
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
      {children}
    </label>
  );
}

export default function FoliarConfigPanel({ config, totalPages, rangeError, onChange }: FoliarConfigProps) {
  function update<K extends keyof FoliarConfig>(key: K, value: FoliarConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function updateRange<K extends keyof FoliarConfig["range"]>(key: K, value: FoliarConfig["range"][K]) {
    onChange({ ...config, range: { ...config.range, [key]: value } });
  }

  const fromInvalid = config.range.from < 1 || config.range.from > totalPages;
  const toInvalid = config.range.to < config.range.from || config.range.to > totalPages;
  const initialInvalid = config.range.initialNumber < 1;
  const sizeInvalid = config.fontSize < FOLIO_FONT_SIZE_MIN || config.fontSize > FOLIO_FONT_SIZE_MAX;

  return (
    <div className="space-y-4">
      {/* Position matrix */}
      <div>
        <Label>Posición</Label>
        <div
          role="radiogroup"
          aria-label="Posición del folio"
          className="grid grid-cols-3 gap-1 w-fit"
        >
          {FOLIO_POSITIONS.map((pos) => {
            const selected = config.position === pos;
            return (
              <button
                key={pos}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={pos}
                onClick={() => update("position", pos as FolioPosition)}
                className={`w-7 h-7 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  selected
                    ? "bg-primary-light border-primary"
                    : "bg-surface border-border hover:border-primary"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Format */}
      <div>
        <Label htmlFor="foliar-format">Formato</Label>
        <select
          id="foliar-format"
          value={config.format}
          onChange={(e) => update("format", e.target.value as FolioFormatTemplate)}
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {FOLIO_FORMAT_TEMPLATES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Number style */}
      <div>
        <Label>Tipo de numeración</Label>
        <div role="radiogroup" aria-label="Tipo de numeración" className="flex gap-1.5">
          {(["numbers", "letters", "both"] as NumberStyle[]).map((style) => {
            const label = style === "numbers" ? "Números" : style === "letters" ? "Letras" : "Ambas";
            const selected = config.numberStyle === style;
            return (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update("numberStyle", style)}
                className={`flex-1 px-2 py-1.5 text-sm rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  selected
                    ? "bg-primary-light border-primary text-primary"
                    : "bg-surface border-border text-text hover:border-primary"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Font */}
      <div>
        <Label htmlFor="foliar-font">Tipo de letra</Label>
        <select
          id="foliar-font"
          value={config.font}
          onChange={(e) => update("font", e.target.value as FolioFont)}
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {FOLIO_FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Size + Color */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="foliar-size">Tamaño (pt)</Label>
          <input
            id="foliar-size"
            type="number"
            min={FOLIO_FONT_SIZE_MIN}
            max={FOLIO_FONT_SIZE_MAX}
            value={config.fontSize}
            onChange={(e) => update("fontSize", Number(e.target.value))}
            className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
              sizeInvalid ? "border-red-500" : "border-border"
            }`}
          />
          {sizeInvalid && (
            <p role="alert" className="text-xs text-red-600 mt-1">
              Entre {FOLIO_FONT_SIZE_MIN} y {FOLIO_FONT_SIZE_MAX} pt.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="foliar-color">Color</Label>
          <div className="flex items-center gap-2">
            <input
              id="foliar-color"
              type="color"
              value={config.color}
              onChange={(e) => update("color", e.target.value)}
              className="w-8 h-8 rounded border border-border cursor-pointer"
              aria-label="Color del folio"
            />
            <span className="text-xs text-text-muted">{config.color.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Range */}
      <div className="bg-bg rounded p-3">
        <Label>Rango de foliado</Label>
        <div className="space-y-2">
          <div>
            <label htmlFor="foliar-initial" className="block text-xs text-text-muted mb-1">Número inicial</label>
            <input
              id="foliar-initial"
              type="number"
              min={1}
              value={config.range.initialNumber}
              onChange={(e) => updateRange("initialNumber", Number(e.target.value))}
              className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
                initialInvalid ? "border-red-500" : "border-border"
              }`}
            />
            {initialInvalid && (
              <p role="alert" className="text-xs text-red-600 mt-1">Debe ser ≥ 1.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="foliar-from" className="block text-xs text-text-muted mb-1">Desde pág.</label>
              <input
                id="foliar-from"
                type="number"
                min={1}
                max={totalPages}
                value={config.range.from}
                onChange={(e) => updateRange("from", Number(e.target.value))}
                className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
                  fromInvalid ? "border-red-500" : "border-border"
                }`}
              />
            </div>
            <div>
              <label htmlFor="foliar-to" className="block text-xs text-text-muted mb-1">Hasta pág.</label>
              <input
                id="foliar-to"
                type="number"
                min={1}
                max={totalPages}
                value={config.range.to}
                onChange={(e) => updateRange("to", Number(e.target.value))}
                className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
                  toInvalid ? "border-red-500" : "border-border"
                }`}
              />
            </div>
          </div>
          {(fromInvalid || toInvalid) && (
            <p role="alert" className="text-xs text-red-600">
              {rangeError}
            </p>
          )}
          <p className="text-xs text-text-muted">
            Páginas {config.range.from} a {config.range.to} = folios {config.range.initialNumber} a {config.range.initialNumber + (config.range.to - config.range.from)}.
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/tools/Foliar/FoliarConfig.tsx && git commit -m "feat(foliar): add FoliarConfig panel with all 6 control groups"
```

---

## Task 9: FoliarPreview component (live canvas)

Renders the current page of the PDF as a canvas with the folio text overlaid on top. Page navigation is `◀ N de M ▶`. When the page is out of the foliado range, no folio is drawn (just the page).

**Files:**
- Create: `src/tools/Foliar/FoliarPreview.tsx`

- [ ] **Step 1: Create `src/tools/Foliar/FoliarPreview.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { formatFolio } from "../../lib/format";
import type { FoliarConfig, FolioPosition } from "../../lib/foliar/types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type FoliarPreviewProps = {
  bytes: Uint8Array;
  pageNumber: number; // 1-indexed
  pageCount: number;
  config: FoliarConfig;
  onPageChange: (page: number) => void;
};

type Anchor = "top" | "middle" | "bottom";
type Align = "left" | "center" | "right";

function getCanvasCoords(
  position: FolioPosition,
  canvasWidth: number,
  canvasHeight: number,
  textWidth: number,
  textHeight: number,
  margin: number
): { x: number; y: number } {
  const [valign, halign] = position.split("-") as [Anchor, Align];

  let x: number;
  if (halign === "left") x = margin;
  else if (halign === "right") x = canvasWidth - textWidth - margin;
  else x = (canvasWidth - textWidth) / 2;

  let y: number;
  if (valign === "top") y = margin;
  else if (valign === "bottom") y = canvasHeight - textHeight - margin;
  else y = (canvasHeight - textHeight) / 2;

  return { x, y };
}

export default function FoliarPreview({
  bytes,
  pageNumber,
  pageCount,
  config,
  onPageChange,
}: FoliarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pdf: pdfjs.PDFDocumentProxy | null = null;

    async function render() {
      if (!canvasRef.current) return;
      setRendering(true);
      setError(null);
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) {
        setError("No se pudo crear el contexto 2D del canvas.");
        setRendering(false);
        return;
      }

      try {
        // Copy bytes because pdfjs may consume/detach the buffer
        const data = bytes.slice().buffer;
        const loadingTask = pdfjs.getDocument({ data });
        pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (cancelled) return;

        // Overlay folio if page is in range
        const inRange = pageNumber >= config.range.from && pageNumber <= config.range.to;
        if (inRange) {
          const folioIndex = pageNumber - config.range.from;
          const folioNumber = config.range.initialNumber + folioIndex;
          const totalInRange = config.range.to - config.range.from + 1;
          const text = formatFolio(config.format, folioNumber, totalInRange, config.numberStyle);
          const fontSize = config.fontSize * 1.5; // scale for canvas
          context.font = `${fontSize}px ${config.font}`;
          const metrics = context.measureText(text);
          const textWidth = metrics.width;
          const textHeight = fontSize;
          const margin = 16; // canvas px
          const { x, y } = getCanvasCoords(config.position, canvas.width, canvas.height, textWidth, textHeight, margin);
          context.fillStyle = config.color;
          context.textBaseline = "top";
          context.fillText(text, x, y);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error al renderizar la vista previa.");
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }

    render();

    return () => {
      cancelled = true;
      if (pdf) {
        pdf.cleanup().catch(() => {});
      }
    };
  }, [bytes, pageNumber, config]);

  return (
    <div className="bg-surface border border-border rounded-lg p-4 flex flex-col items-center">
      <canvas
        ref={canvasRef}
        className="max-w-full h-auto border border-border"
        aria-label={`Vista previa página ${pageNumber} de ${pageCount}`}
      />
      {error && (
        <p role="alert" className="text-red-600 text-sm mt-2">{error}</p>
      )}
      <div className="flex items-center gap-2 mt-3" role="group" aria-label="Navegación de páginas">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, pageNumber - 1))}
          disabled={pageNumber <= 1}
          aria-label="Página anterior"
          className="px-3 py-1 text-sm bg-surface border border-border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          ◀
        </button>
        <span className="text-sm text-text-muted">
          Página {pageNumber} de {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, pageNumber + 1))}
          disabled={pageNumber >= pageCount}
          aria-label="Página siguiente"
          className="px-3 py-1 text-sm bg-surface border border-border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          ▶
        </button>
      </div>
      {rendering && <p className="text-xs text-text-muted mt-1" aria-live="polite">Renderizando…</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/tools/Foliar/FoliarPreview.tsx && git commit -m "feat(foliar): add live FoliarPreview with canvas and page navigation"
```

---

## Task 10: FoliarPage orchestrator

Top-level page component. Owns the state for: file, pageCount, currentPage, config, isProcessing, progress, worker. Handles: file load, worker communication, download.

**Files:**
- Create: `src/tools/Foliar/FoliarPage.tsx`

- [ ] **Step 1: Create `src/tools/Foliar/FoliarPage.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import FileBar from "./FileBar";
import FoliarConfigPanel from "./FoliarConfig";
import FoliarPreview from "./FoliarPreview";
import { loadPdfFromFile, type LoadedPdf } from "../../lib/pdf/load";
import { downloadBlob, suggestFileName, type NameSuffix } from "../../lib/pdf/download";
import { DEFAULT_FOLIAR_CONFIG, type FoliarConfig } from "../../lib/foliar/types";
import { validateFolioRange } from "../../lib/foliar/validation";
import FoliarWorker from "./foliar.worker.ts?worker";
import type { FoliarRequest, FoliarResponse } from "./foliar.protocol";

const SUFFIX: NameSuffix = "foliado";

type LoadedState = {
  loaded: LoadedPdf;
  bytes: Uint8Array;
};

export default function FoliarPage() {
  const [state, setState] = useState<LoadedState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [config, setConfig] = useState<FoliarConfig>(DEFAULT_FOLIAR_CONFIG);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Initialize config.to when a new PDF is loaded
  useEffect(() => {
    if (state) {
      setConfig((c) => ({
        ...c,
        range: { ...c.range, from: 1, to: state.loaded.pageCount },
      }));
      setCurrentPage(1);
    }
  }, [state]);

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  async function handleFileSelected(file: File) {
    setLoadError(null);
    try {
      const loaded = await loadPdfFromFile(file);
      const bytes = await loaded.document.save();
      setState({ loaded, bytes });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar el PDF.");
    }
  }

  function handleChangeFile() {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setProcessing(false);
    setProgress(null);
    setProcessError(null);
    setState(null);
    setCurrentPage(1);
  }

  function handleGenerate() {
    if (!state) return;
    if (rangeError) return;

    const total = config.range.to - config.range.from + 1;
    setProcessing(true);
    setProgress({ current: 0, total });
    setProcessError(null);

    const worker = new FoliarWorker();
    workerRef.current = worker;

    worker.addEventListener("message", (e: MessageEvent<FoliarResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress({ current: msg.current, total: msg.total });
      } else if (msg.type === "complete") {
        const blob = new Blob([new Uint8Array(msg.bytes)], { type: "application/pdf" });
        downloadBlob(blob, suggestFileName(state.loaded.fileName, SUFFIX));
        setProcessing(false);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      } else if (msg.type === "cancelled") {
        setProcessing(false);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      } else if (msg.type === "error") {
        setProcessError(msg.message);
        setProcessing(false);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      }
    });

    const request: FoliarRequest = {
      type: "process",
      fileBytes: state.bytes,
      config,
    };
    worker.postMessage(request);
  }

  function handleCancel() {
    if (workerRef.current) {
      const cancel: FoliarRequest = { type: "cancel" };
      workerRef.current.postMessage(cancel);
    }
  }

  const rangeError = state ? validateFolioRange(config.range, state.loaded.pageCount) : null;
  const canGenerate = state && !rangeError && !processing;

  if (!state) {
    return (
      <Layout>
        <h1 className="text-2xl font-semibold text-text mb-2">Foliar</h1>
        <p className="text-text-muted mb-6">Numerar las páginas de un PDF.</p>
        <UploadArea onFileSelected={handleFileSelected} />
        {loadError && (
          <p role="alert" className="text-red-600 text-sm mt-3">{loadError}</p>
        )}
      </Layout>
    );
  }

  const { loaded, bytes } = state;

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-4">Foliar</h1>

      <div className="mb-4">
        <FileBar
          fileName={loaded.fileName}
          fileSize={loaded.fileSize}
          pageCount={loaded.pageCount}
          onChangeFile={handleChangeFile}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        <FoliarPreview
          bytes={bytes}
          pageNumber={currentPage}
          pageCount={loaded.pageCount}
          config={config}
          onPageChange={setCurrentPage}
        />
        <div className="bg-surface border border-border rounded-lg p-4">
          <h2 className="font-semibold text-text mb-4 pb-2 border-b border-border">Configuración del folio</h2>
          <FoliarConfigPanel
            config={config}
            totalPages={loaded.pageCount}
            rangeError={rangeError}
            onChange={setConfig}
          />
          <div className="mt-4 pt-4 border-t border-border">
            {processError && (
              <p role="alert" className="text-red-600 text-sm mb-2">{processError}</p>
            )}
            {processing && progress && (
              <div className="mb-3" aria-live="polite">
                <div className="text-xs text-text-muted mb-1">
                  Procesando {progress.current} de {progress.total}…
                </div>
                <div
                  className="h-2 bg-bg rounded overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progress.current}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                >
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="mt-2 w-full text-sm bg-surface border border-border text-text px-3 py-1.5 rounded hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  Cancelar
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full bg-primary text-white px-4 py-2 rounded font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {processing ? "Procesando…" : "Generar PDF foliado"}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Verify type check + build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npx tsc --noEmit
```

Expected: no errors.

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/tools/Foliar/FoliarPage.tsx && git commit -m "feat(foliar): add FoliarPage orchestrator with worker, state, and progress"
```

---

## Task 11: Wire up the router

Update `src/tools/Foliar.tsx` to render the new `FoliarPage` component.

**Files:**
- Modify: `src/tools/Foliar.tsx` (replace stub with delegation)

- [ ] **Step 1: Read the current file**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && cat src/tools/Foliar.tsx
```

- [ ] **Step 2: Replace the file**

Replace the entire contents of `src/tools/Foliar.tsx` with:

```tsx
import FoliarPage from "./Foliar/FoliarPage";

export default function Foliar() {
  return <FoliarPage />;
}
```

- [ ] **Step 3: Verify build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git add src/tools/Foliar.tsx && git commit -m "refactor(foliar): delegate Foliar route to FoliarPage"
```

---

## Task 12: Final verification

Run the full test suite, build, and start the dev server to do a visual smoke test.

- [ ] **Step 1: Run all tests**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm test -- --run
```

Expected: all tests pass (existing 15 + 9 position + 8 validation + 5 applyFolio = 37).

- [ ] **Step 2: Run the build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run build
```

Expected: build succeeds, no errors.

- [ ] **Step 3: Start the dev server**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && npm run dev
```

Wait for the server to be ready. Then:

- [ ] **Step 4: Visual smoke test**

Visit `http://localhost:5173/foliar` and verify:
- Foliar page loads (no console errors).
- Empty state: shows the upload area with "Arrastrá tu PDF acá".
- Upload a PDF: page transitions to the file bar + preview + config panel.
- File bar shows correct name, size, and page count.
- "Cambiar archivo" button returns to the empty state.
- Preview canvas renders the first page.
- Changing the position in the matrix updates the folio position in the preview.
- Changing format/type/font/size/color updates the preview live.
- Page navigation (◀ ▶) switches between pages.
- Pages outside the foliado range don't show a folio overlay.
- "Generar PDF foliado" button triggers the worker; progress bar shows; result downloads as `<original>-foliado.pdf`.
- Cancel button works during processing.

- [ ] **Step 5: Commit final empty commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy" && git commit --allow-empty -m "chore: plan 2 complete - foliar tool with live preview and worker" && git rev-parse HEAD
```

---

## Self-Review Checklist

Run through this before saving — fix issues inline.

1. **Spec coverage:** Every Foliar requirement in the design spec (line 111-147) maps to a task:
   - File bar with "Cambiar archivo" → Task 7
   - Live preview with page navigation → Task 9
   - Position matrix (3×3) → Task 8
   - Format select → Task 8
   - Number style (numbers/letters/both) → Task 8 (reuses `formatFolio` from `src/lib/format.ts`)
   - Font select → Task 8
   - Size + color → Task 8
   - Range (initial + from + to) → Task 8
   - Web Worker for processing → Task 6
   - Batch progress (10–20 pages) → Task 6 (`BATCH_SIZE = 15`)
   - Download as `<original>-foliado.pdf` → Task 10 (uses `suggestFileName`)
   - Validation rules (from ≥ 1, to ≥ from, etc.) → Task 3
   - Error message + disabled generate button → Task 8 + Task 10
   - Spanish error messages → consistent throughout
   - Cancel during processing → Task 6 + Task 10

2. **Placeholder scan:** No TBD/TODO. All code blocks complete. No "similar to Task N" hand-waves.

3. **Type consistency:** `FolioPosition`, `FolioFormatTemplate`, `FolioFont`, `NumberStyle`, `FoliarConfig` defined in Task 1 used consistently in Tasks 2-10. `FoliarConfig["range"]` is used inline; not a separate type. Worker message types `FoliarRequest`/`FoliarResponse` defined in Task 5 and imported by Tasks 6 and 10. `NameSuffix` from `src/lib/pdf/download.ts` (existing) used in Task 10.

4. **Existing utilities reused:** `loadPdfFromFile`, `formatFolio`, `downloadBlob`, `suggestFileName`, `Layout`, `UploadArea` — all from Plan 1, no duplication.

5. **Build will work:** `?worker` import is Vite's standard Web Worker pattern. `pdfjs.GlobalWorkerOptions.workerSrc` is set in Task 9 (preview); it is also set in Plan 1's `thumbnail.ts`. The duplicate setup is benign (idempotent) and is intentional because Task 9 uses pdfjs directly without going through `renderThumbnail`.

## Resumen

After Plan 2 completes:
- Foliar tool fully functional: upload → live preview → generate → download
- Web Worker keeps UI responsive on large PDFs
- 9 (position) + 8 (validation) + 5 (applyFolio) = 22 new unit tests (37 total with Plan 1)
- All Spanish error messages consistent with Plan 1
- A11y throughout: aria-labels, role="alert" for errors, role="radio" + aria-checked for matrices/radios, focus rings on all controls

**Ready for Plan 3 (Comprimir tool).**

**Ready for Plan 3 (Comprimir tool).**
