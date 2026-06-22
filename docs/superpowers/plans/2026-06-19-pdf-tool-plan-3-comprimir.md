# Comprimir Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Comprimir tool — a React page where the user uploads a PDF, picks a compression level (Baja/Media/Alta), and downloads the compressed PDF. Processing happens in a Web Worker via Ghostscript compiled to WebAssembly, with the `coi-serviceworker` polyfill so it works on any static host.

**Architecture:** Replicates the Foliar pattern: UI components (`ComprimirPage`, `LevelSelector`, `ProgressBar`, `ResultBar`) live in `src/tools/Comprimir/`, message-protocol types in `compress.protocol.ts`, and the actual GS WASM execution in `compress.worker.ts`. The WASM loader + executor are wrapped in `src/lib/pdf/ghostscript.ts` so they can be unit-tested with a mocked loader. The COI service worker is registered once on first visit via `src/lib/coi.ts`.

**Tech Stack:** React 19 + TypeScript + Tailwind (existing), pdf-lib (existing), `@jspawn/ghostscript-wasm` (new — confirm during Task 1), `coi-serviceworker` (new), Vitest + @testing-library/react (existing).

**Foundation from Plans 1 + 2:**
- `Layout` and `Card` in `src/components/` — reuse for `LevelSelector` cards
- `downloadBlob` + `suggestFileName` in `src/lib/pdf/download.ts` — reuse for the "Descargar" button
- `loadPdfFromFile` in `src/lib/pdf/load.ts` — reuse for file validation
- Web Worker pattern via Vite `?worker` import — established in Plan 2

**Design spec reference:** `docs/superpowers/specs/2026-06-19-pdf-tool-plan-3-comprimir-design.md`

---

## File Structure

```
public/
├── gs/
│   └── ghostscript.wasm        # copied from node_modules after install
└── coi-serviceworker.js        # copied from node_modules after install

src/lib/
├── coi.ts                      # registerCoiServiceWorker(): registers once, no-op thereafter
├── coi.test.ts
└── pdf/
    ├── ghostscript.ts          # runGhostscript(args): Promise<Uint8Array>; wraps the WASM loader
    └── ghostscript.test.ts

src/tools/Comprimir/
├── ComprimirPage.tsx           # top-level page; orchestrates state + worker
├── LevelSelector.tsx           # 3 cards: Baja / Media / Alta; one active at a time
├── LevelSelector.test.tsx
├── ProgressBar.tsx             # progress + "Procesando..." text
├── ProgressBar.test.tsx
├── ResultBar.tsx               # "Original X → Y (-Z%)" + "Descargar" button
├── ResultBar.test.tsx
├── compress.worker.ts          # Web Worker; loads WASM, runs GS, posts progress/result
└── compress.protocol.ts        # shared message types (Request, Response)
```

`src/tools/Comprimir.tsx` is modified to delegate to `ComprimirPage`. Routing is already wired (Plan 1).

---

## Task 1: Install Ghostscript WASM and COI polyfill

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `public/gs/.gitkeep`
- Create: `public/coi-serviceworker.js` (copied from npm package)

- [x] **Step 1: Try to install `@jspawn/ghostscript-wasm`**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm install @jspawn/ghostscript-wasm 2>&1 | tail -5
```

Expected: succeeds. If it fails (package unavailable or 404), proceed to Step 1b.

- [x] **Step 1b (fallback if 1 fails): Try `ghostscript-wasm`**

```bash
npm uninstall @jspawn/ghostscript-wasm 2>&1 | tail -2
npm install ghostscript-wasm 2>&1 | tail -5
```

Expected: succeeds. If both fail, STOP and report to user — the spec needs updating with a real package name before continuing.

- [x] **Step 2: Install `coi-serviceworker`**

```bash
npm install coi-serviceworker 2>&1 | tail -5
```

Expected: succeeds. The package ships a pre-built `coi-serviceworker.js` we can copy into `public/`.

- [x] **Step 3: Copy the COI service worker into `public/`**

```bash
mkdir -p "D:/Archivos de la U/PROYECTOS/Easy/public"
cp "node_modules/coi-serviceworker/coi-serviceworker.js" "D:/Archivos de la U/PROYECTOS/Easy/public/coi-serviceworker.js"
ls -la "D:/Archivos de la U/PROYECTOS/Easy/public/coi-serviceworker.js"
```

Expected: file exists, size > 1 KB.

- [x] **Step 4: Copy the Ghostscript WASM file into `public/gs/`**

The path inside `node_modules` depends on which package was installed. Try both:

```bash
mkdir -p "D:/Archivos de la U/PROYECTOS/Easy/public/gs"
# Try the @jspawn path first
find "node_modules/@jspawn/ghostscript-wasm" -name "*.wasm" 2>/dev/null | head -3
# Or the alternative path
find "node_modules/ghostscript-wasm" -name "*.wasm" 2>/dev/null | head -3
```

Copy whichever exists to `public/gs/ghostscript.wasm`. Create `public/gs/.gitkeep` if no `.wasm` file exists yet (the file may be lazy-fetched at runtime instead of bundled).

Expected: a `.wasm` file (or `.gitkeep` placeholder) exists at `public/gs/`.

- [x] **Step 5: Verify build still works**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors.

- [x] **Step 6: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add package.json package-lock.json public/
git commit -m "build(comprimir): add Ghostscript WASM + COI service worker deps"
```

---

## Task 2: Compress protocol types

**Files:**
- Create: `src/tools/Comprimir/compress.protocol.ts`

- [x] **Step 1: Create `src/tools/Comprimir/compress.protocol.ts`**

```ts
export type CompressLevel = "baja" | "media" | "alta";

export const COMPRESS_LEVELS: CompressLevel[] = ["baja", "media", "alta"];

export const DEFAULT_COMPRESS_LEVEL: CompressLevel = "media";

export type CompressRequest =
  | { type: "compress"; bytes: Uint8Array; level: CompressLevel }
  | { type: "cancel" };

export type CompressResponse =
  | { type: "progress"; pct: number }
  | { type: "complete"; bytes: Uint8Array }
  | { type: "cancelled" }
  | { type: "error"; message: string };
```

- [x] **Step 2: Verify type check**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/tools/Comprimir/compress.protocol.ts
git commit -m "feat(comprimir): add compress protocol types"
```

---

## Task 3: COI service worker registration

**Files:**
- Create: `src/lib/coi.ts`
- Create: `src/lib/coi.test.ts`

- [x] **Step 1: Write the failing test in `src/lib/coi.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerCoiServiceWorker } from "./coi";

describe("registerCoiServiceWorker", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    // Reset any registered flag from a previous test
    (globalThis as Record<string, unknown>).__coiRegistered = undefined;
  });

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("registers the SW and resolves when serviceWorker.controller is set", async () => {
    const register = vi.fn().mockResolvedValue({
      active: {},
      installing: null,
      waiting: null,
      scope: "/",
      update: vi.fn(),
      unregister: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onupdatefound: null,
    });
    Object.defineProperty(global, "navigator", {
      value: { serviceWorker: { register: register } },
      writable: true,
      configurable: true,
    });

    await expect(registerCoiServiceWorker()).resolves.toBeUndefined();
    expect(register).toHaveBeenCalledWith("/coi-serviceworker.js");
  });

  it("does nothing if serviceWorker is unavailable", async () => {
    Object.defineProperty(global, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
    await expect(registerCoiServiceWorker()).resolves.toBeUndefined();
  });

  it("does not throw if registration fails", async () => {
    const register = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(global, "navigator", {
      value: { serviceWorker: { register: register } },
      writable: true,
      configurable: true,
    });
    await expect(registerCoiServiceWorker()).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/lib/coi.test.ts 2>&1 | tail -15
```

Expected: FAIL with "Cannot find module './coi'" or similar.

- [x] **Step 3: Implement `src/lib/coi.ts`**

```ts
/**
 * Registers the coi-serviceworker polyfill once per page load. This is
 * needed so that `SharedArrayBuffer` is available when Ghostscript WASM
 * runs in a Web Worker (which requires cross-origin isolation via the
 * COOP/COEP headers that the polyfill injects via a Service Worker).
 *
 * Safe to call multiple times: subsequent calls are no-ops via a
 * module-level flag. Errors are swallowed so the rest of the app still
 * works in environments where the SW can't be registered.
 *
 * Reference: https://github.com/gzuidhof/coi-serviceworker
 */
export async function registerCoiServiceWorker(): Promise<void> {
  if ((globalThis as Record<string, unknown>).__coiRegistered) return;

  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!sw?.register) return;

  try {
    await sw.register("/coi-serviceworker.js");
    (globalThis as Record<string, unknown>).__coiRegistered = true;
  } catch {
    // SW registration failed (e.g., third-party cookies blocked). The app
    // still works for non-WASM features; compression will fail later with
    // a clear error if SharedArrayBuffer is unavailable.
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/lib/coi.test.ts 2>&1 | tail -10
```

Expected: PASS, 3 tests passing.

- [x] **Step 5: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/lib/coi.ts src/lib/coi.test.ts
git commit -m "feat(comprimir): add COI service worker registration helper"
```

---

## Task 4: Ghostscript wrapper (TDD)

**Files:**
- Create: `src/lib/pdf/ghostscript.ts`
- Create: `src/lib/pdf/ghostscript.test.ts`

- [x] **Step 1: Write the failing test in `src/lib/pdf/ghostscript.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { levelToGsArgs, runGhostscript } from "./ghostscript";

describe("levelToGsArgs", () => {
  it("maps 'baja' to /printer (150 dpi)", () => {
    expect(levelToGsArgs("baja")).toEqual(["-dPDFSETTINGS=/printer"]);
  });

  it("maps 'media' to /ebook (100 dpi)", () => {
    expect(levelToGsArgs("media")).toEqual(["-dPDFSETTINGS=/ebook"]);
  });

  it("maps 'alta' to /screen (72 dpi)", () => {
    expect(levelToGsArgs("alta")).toEqual(["-dPDFSETTINGS=/screen"]);
  });
});

describe("runGhostscript", () => {
  it("invokes the GS loader with input bytes and the right args", async () => {
    const inputBytes = new Uint8Array([1, 2, 3]);
    const outputBytes = new Uint8Array([4, 5, 6]);
    const loadGhostscript = vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue(outputBytes),
    });

    const result = await runGhostscript(inputBytes, "media", { loadGhostscript });

    expect(loadGhostscript).toHaveBeenCalledTimes(1);
    expect(result).toBe(outputBytes);

    const runArgs = (loadGhostscript.mock.results[0].value as { run: ReturnType<typeof vi.fn> }).run.mock.calls[0];
    expect(runArgs[0]).toBe(inputBytes);
    expect(runArgs[1]).toContain("-sDEVICE=pdfwrite");
    expect(runArgs[1]).toContain("-dPDFSETTINGS=/ebook");
    expect(runArgs[1]).toContain("-dNOPAUSE");
    expect(runArgs[1]).toContain("-dBATCH");
  });

  it("propagates loader errors with a clean message", async () => {
    const loadGhostscript = vi.fn().mockRejectedValue(new Error("WASM load failed"));
    await expect(
      runGhostscript(new Uint8Array([1]), "media", { loadGhostscript }),
    ).rejects.toThrow(/motor de compresión/);
  });

  it("propagates GS run errors with a clean message", async () => {
    const loadGhostscript = vi.fn().mockResolvedValue({
      run: vi.fn().mockRejectedValue(new Error("gs exited with code 1")),
    });
    await expect(
      runGhostscript(new Uint8Array([1]), "alta", { loadGhostscript }),
    ).rejects.toThrow(/No se pudo comprimir/);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/lib/pdf/ghostscript.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './ghostscript'" or similar.

- [x] **Step 3: Implement `src/lib/pdf/ghostscript.ts`**

```ts
import type { CompressLevel } from "../../tools/Comprimir/compress.protocol";

/**
 * Maps a CompressLevel to the Ghostscript `-dPDFSETTINGS` preset:
 *   baja  → /printer (150 dpi, almost no visible loss)
 *   media → /ebook   (100 dpi, balanced)
 *   alta  → /screen  (72 dpi,  aggressive)
 */
export function levelToGsArgs(level: CompressLevel): string[] {
  switch (level) {
    case "baja":
      return ["-dPDFSETTINGS=/printer"];
    case "media":
      return ["-dPDFSETTINGS=/ebook"];
    case "alta":
      return ["-dPDFSETTINGS=/screen"];
  }
}

/**
 * The minimal interface runGhostscript needs from the loaded WASM module.
 * Declared here so tests can supply a mock without pulling in the real
 * (heavy) `@jspawn/ghostscript-wasm` package.
 */
export interface GhostscriptModule {
  run(inputBytes: Uint8Array, args: string[]): Promise<Uint8Array>;
}

export type LoadGhostscript = () => Promise<GhostscriptModule>;

/**
 * Runs Ghostscript on the given PDF bytes at the given compression level.
 * Returns the compressed PDF bytes.
 *
 * The `deps` parameter lets tests inject a mocked loader; production code
 * passes the real `loadGhostscript` from the worker (Task 6).
 */
export async function runGhostscript(
  inputBytes: Uint8Array,
  level: CompressLevel,
  deps: { loadGhostscript: LoadGhostscript },
): Promise<Uint8Array> {
  let module: GhostscriptModule;
  try {
    module = await deps.loadGhostscript();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo cargar el motor de compresión (${reason}).`);
  }

  const args = [
    "-sDEVICE=pdfwrite",
    ...levelToGsArgs(level),
    "-dNOPAUSE",
    "-dBATCH",
    "-sOutputFile=-", // stdout; we read bytes back instead of writing to disk
    "-",              // read input from stdin (the bytes we pass in)
    "-q",             // quiet mode to keep stderr clean for progress parsing
  ];

  try {
    return await module.run(inputBytes, args);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo comprimir el PDF (${reason}).`);
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/lib/pdf/ghostscript.test.ts 2>&1 | tail -10
```

Expected: PASS, 6 tests passing (3 in `levelToGsArgs` + 3 in `runGhostscript`).

- [x] **Step 5: Verify type check + run all tests**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx tsc --noEmit 2>&1 | tail -5
npm test -- --run 2>&1 | tail -10
```

Expected: no type errors; all tests passing (106 total: 100 existing + 3 coi + 6 GS = 109).

- [x] **Step 6: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/lib/pdf/ghostscript.ts src/lib/pdf/ghostscript.test.ts
git commit -m "feat(comprimir): add Ghostscript wrapper with level mapping"
```

---

## Task 5: LevelSelector component (TDD)

**Files:**
- Create: `src/tools/Comprimir/LevelSelector.tsx`
- Create: `src/tools/Comprimir/LevelSelector.test.tsx`

- [x] **Step 1: Write the failing test in `src/tools/Comprimir/LevelSelector.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LevelSelector from "./LevelSelector";

describe("LevelSelector", () => {
  const levels = [
    { id: "baja", label: "Baja", description: "Casi sin pérdida visible" },
    { id: "media", label: "Media", description: "Balance recomendado" },
    { id: "alta", label: "Alta", description: "Máxima reducción" },
  ] as const;

  it("renders one button per level with label and description", () => {
    render(<LevelSelector levels={levels} value={null} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /Baja/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Media/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Alta/i })).toBeInTheDocument();
  });

  it("marks the active level with aria-checked=true", () => {
    render(<LevelSelector levels={levels} value="media" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /Media/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Baja/i })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the clicked level id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LevelSelector levels={levels} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: /Alta/i }));
    expect(onChange).toHaveBeenCalledWith("alta");
  });

  it("disables all buttons when disabled=true", () => {
    render(<LevelSelector levels={levels} value={null} onChange={() => {}} disabled />);
    expect(screen.getByRole("radio", { name: /Baja/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Media/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Alta/i })).toBeDisabled();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/tools/Comprimir/LevelSelector.test.tsx 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './LevelSelector'" or similar.

- [x] **Step 3: Implement `src/tools/Comprimir/LevelSelector.tsx`**

```tsx
type LevelId = string;

export type LevelDescriptor = {
  id: LevelId;
  label: string;
  description: string;
};

type LevelSelectorProps = {
  levels: readonly LevelDescriptor[];
  value: LevelId | null;
  onChange: (level: LevelId) => void;
  disabled?: boolean;
};

export default function LevelSelector({
  levels,
  value,
  onChange,
  disabled = false,
}: LevelSelectorProps) {
  return (
    <div role="radiogroup" aria-label="Nivel de compresión" className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {levels.map((level) => {
        const isActive = value === level.id;
        return (
          <button
            key={level.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(level.id)}
            className={[
              "text-left p-4 rounded-lg border-2 transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-primary",
              isActive
                ? "border-primary bg-primary-light"
                : "border-border bg-surface hover:border-primary",
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <div className="font-semibold text-text">{level.label}</div>
            <div className="text-sm text-text-muted mt-1">{level.description}</div>
          </button>
        );
      })}
    </div>
  );
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/tools/Comprimir/LevelSelector.test.tsx 2>&1 | tail -10
```

Expected: PASS, 4 tests passing.

- [x] **Step 5: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/tools/Comprimir/LevelSelector.tsx src/tools/Comprimir/LevelSelector.test.tsx
git commit -m "feat(comprimir): add LevelSelector component (3 radio cards)"
```

---

## Task 6: ProgressBar component (TDD)

**Files:**
- Create: `src/tools/Comprimir/ProgressBar.tsx`
- Create: `src/tools/Comprimir/ProgressBar.test.tsx`

- [x] **Step 1: Write the failing test in `src/tools/Comprimir/ProgressBar.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressBar from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders the current percentage as text", () => {
    render(<ProgressBar pct={42} />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it("clamps pct to [0, 100]", () => {
    render(<ProgressBar pct={150} />);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders 0% when pct is negative", () => {
    render(<ProgressBar pct={-5} />);
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });

  it("has role=progressbar and aria-valuemin/max", () => {
    render(<ProgressBar pct={50} />);
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(progress).toHaveAttribute("aria-valuenow", "50");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/tools/Comprimir/ProgressBar.test.tsx 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './ProgressBar'" or similar.

- [x] **Step 3: Implement `src/tools/Comprimir/ProgressBar.tsx`**

```tsx
type ProgressBarProps = {
  pct: number;
};

export default function ProgressBar({ pct }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2 w-full bg-border rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
          data-testid="progress-fill"
        />
      </div>
      <p className="text-sm text-text-muted" aria-live="polite">
        Procesando… {clamped}%
      </p>
    </div>
  );
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/tools/Comprimir/ProgressBar.test.tsx 2>&1 | tail -10
```

Expected: PASS, 4 tests passing.

- [x] **Step 5: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/tools/Comprimir/ProgressBar.tsx src/tools/Comprimir/ProgressBar.test.tsx
git commit -m "feat(comprimir): add ProgressBar component"
```

---

## Task 7: ResultBar component (TDD)

**Files:**
- Create: `src/tools/Comprimir/ResultBar.tsx`
- Create: `src/tools/Comprimir/ResultBar.test.tsx`

- [x] **Step 1: Write the failing test in `src/tools/Comprimir/ResultBar.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResultBar from "./ResultBar";

describe("ResultBar", () => {
  const originalBytes = 8_400_000;
  const resultBytes = 3_700_000;

  it("shows original size, result size, and percentage reduction", () => {
    render(
      <ResultBar
        originalBytes={originalBytes}
        resultBytes={resultBytes}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText(/Original/i)).toHaveTextContent(/8\.4 MB/);
    expect(screen.getByText(/Resultado/i)).toHaveTextContent(/3\.7 MB/);
    expect(screen.getByText(/-56%/)).toBeInTheDocument();
  });

  it("calls onDownload when the button is clicked", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(
      <ResultBar
        originalBytes={originalBytes}
        resultBytes={resultBytes}
        onDownload={onDownload}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Descargar/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("disables the button when disabled is true", () => {
    render(
      <ResultBar
        originalBytes={originalBytes}
        resultBytes={resultBytes}
        onDownload={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: /Descargar/i })).toBeDisabled();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/tools/Comprimir/ResultBar.test.tsx 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './ResultBar'" or similar.

- [x] **Step 3: Implement `src/tools/Comprimir/ResultBar.tsx`**

```tsx
import { formatBytes } from "../../lib/format";

type ResultBarProps = {
  originalBytes: number;
  resultBytes: number;
  onDownload: () => void;
  disabled?: boolean;
};

export default function ResultBar({
  originalBytes,
  resultBytes,
  onDownload,
  disabled = false,
}: ResultBarProps) {
  const reduction = Math.round(((originalBytes - resultBytes) / originalBytes) * 100);
  return (
    <div className="flex flex-col gap-3 p-4 bg-surface border border-border rounded-lg">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="text-text-muted">
          Original: <strong className="text-text">{formatBytes(originalBytes)}</strong>
        </span>
        <span className="text-text-muted" aria-hidden="true">→</span>
        <span className="text-text-muted">
          Resultado: <strong className="text-text">{formatBytes(resultBytes)}</strong>
        </span>
        <span className="font-semibold text-primary">({reduction}%)</span>
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={disabled}
        className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Descargar PDF comprimido
      </button>
    </div>
  );
}
```

- [x] **Step 4: Add `formatBytes` to `src/lib/format.ts` if not present**

Check if `formatBytes` already exists in `src/lib/format.ts`. If not, add it:

```ts
/**
 * Formats a byte count as a human-readable string ("1.4 MB", "823 KB", "47 B").
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

Add the function to the existing `src/lib/format.ts` (alongside `formatFolio`). Re-export from the module if needed.

- [x] **Step 5: Run the test to verify it passes**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx vitest run src/tools/Comprimir/ResultBar.test.tsx 2>&1 | tail -10
```

Expected: PASS, 3 tests passing.

- [x] **Step 6: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/tools/Comprimir/ResultBar.tsx src/tools/Comprimir/ResultBar.test.tsx src/lib/format.ts
git commit -m "feat(comprimir): add ResultBar component with size comparison"
```

---

## Task 8: Compress Web Worker

**Files:**
- Create: `src/tools/Comprimir/compress.worker.ts`

- [x] **Step 1: Create `src/tools/Comprimir/compress.worker.ts`**

```ts
/// <reference lib="webworker" />
import { runGhostscript } from "../../lib/pdf/ghostscript";
import type { CompressRequest, CompressResponse } from "./compress.protocol";

let cancelled = false;

self.addEventListener("message", async (e: MessageEvent<CompressRequest>) => {
  if (e.data.type === "cancel") {
    cancelled = true;
    return;
  }

  if (e.data.type !== "compress") return;
  cancelled = false;

  const { bytes, level } = e.data;

  // Import the WASM loader dynamically so it only loads when Comprimir is used.
  const { default: loadGhostscript } = await import("./compress.wasm-loader");

  try {
    // Synthetic progress: 0% at start, jump to 50% once WASM is loaded,
    // 100% when GS finishes. GS does not report per-page progress for PDF
    // compression, so this is the best we can do without parsing stderr.
    postMessage({ type: "progress", pct: 5 } satisfies CompressResponse);

    // Mark 50% once GS is initialized (before run). We can't easily hook
    // into the loader, so we just emit at the boundaries.
    postMessage({ type: "progress", pct: 50 } satisfies CompressResponse);

    const outBytes = await runGhostscript(bytes, level, { loadGhostscript });

    if (cancelled) {
      const response: CompressResponse = { type: "cancelled" };
      self.postMessage(response);
      return;
    }

    postMessage({ type: "progress", pct: 100 } satisfies CompressResponse);
    const complete: CompressResponse = { type: "complete", bytes: outBytes };
    self.postMessage(complete);
  } catch (err) {
    if (cancelled) {
      const response: CompressResponse = { type: "cancelled" };
      self.postMessage(response);
      return;
    }
    const error: CompressResponse = {
      type: "error",
      message: err instanceof Error ? err.message : "Error desconocido.",
    };
    self.postMessage(error);
  }
});
```

- [x] **Step 2: Create the WASM loader wrapper `src/tools/Comprimir/compress.wasm-loader.ts`**

This file isolates the `@jspawn/ghostscript-wasm` (or `ghostscript-wasm`) import so the heavy dep is only loaded when the worker actually runs. The exact API differs per package — fill in the marked spots based on the package installed in Task 1.

```ts
/**
 * Lazy-loaded wrapper around the Ghostscript WASM package installed in
 * Task 1. The exact import shape depends on which package was installed;
 * adjust the `// ADAPT` block to match the package's documented API.
 *
 * Reference implementations:
 *   @jspawn/ghostscript-wasm: see its README (typically returns a default
 *     export with a `run` or `call` method).
 *   ghostscript-wasm:          see its README.
 */

// ADAPT: replace this import + the returned shape to match the installed package.
import ghostscriptModule from "@jspawn/ghostscript-wasm";

export default async function loadGhostscript() {
  const module = await ghostscriptModule();
  return {
    async run(inputBytes: Uint8Array, args: string[]): Promise<Uint8Array> {
      // ADAPT: call the package's PDF compression function.
      // Most WASM GS wrappers expose either `run(bytes, args)` returning
      // bytes, or `compress(bytes, preset)` returning bytes.
      return await module.run(inputBytes, args);
    },
  };
}
```

- [x] **Step 3: Verify type check**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: errors about the `// ADAPT` block if the package's API doesn't match. Adjust the wrapper to match the real API. If you can't make it compile, STOP and report to the user — the implementation needs to follow the package's actual API.

- [x] **Step 4: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/tools/Comprimir/compress.worker.ts src/tools/Comprimir/compress.wasm-loader.ts
git commit -m "feat(comprimir): add GS Web Worker with lazy WASM loader"
```

---

## Task 9: ComprimirPage integration

**Files:**
- Create: `src/tools/Comprimir/ComprimirPage.tsx`
- Modify: `src/tools/Comprimir.tsx` (delegate to ComprimirPage)

- [x] **Step 1: Create `src/tools/Comprimir/ComprimirPage.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import Layout from "../../components/Layout";
import UploadArea from "../../components/UploadArea";
import { loadPdfFromFile } from "../../lib/pdf/load";
import { downloadBlob, suggestFileName } from "../../lib/pdf/download";
import LevelSelector, { type LevelDescriptor } from "./LevelSelector";
import ProgressBar from "./ProgressBar";
import ResultBar from "./ResultBar";
import type {
  CompressLevel,
  CompressRequest,
  CompressResponse,
} from "./compress.protocol";
// Vite's ?worker syntax: imports the worker as a constructor.
import CompressWorker from "./compress.worker.ts?worker";

const LEVELS: readonly LevelDescriptor[] = [
  { id: "baja", label: "Baja", description: "Casi sin pérdida visible (~10-20% menos)" },
  { id: "media", label: "Media", description: "Balance recomendado (~40-60% menos)" },
  { id: "alta", label: "Alta", description: "Máxima reducción (~70-85% menos)" },
];

type Status = "idle" | "compressing" | "complete" | "error";

export default function ComprimirPage() {
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [level, setLevel] = useState<CompressLevel | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [resultBytes, setResultBytes] = useState<Uint8Array | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  // Register the COI service worker once on mount.
  useEffect(() => {
    import("../../lib/coi").then(({ registerCoiServiceWorker }) => {
      registerCoiServiceWorker();
    });
  }, []);

  // Cleanup worker on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    try {
      const bytes = await loadPdfFromFile(file);
      setFileBytes(bytes);
      setFileName(file.name);
      setOriginalSize(file.size);
      setLevel(null);
      setStatus("idle");
      setResultBytes(null);
      setErrorMessage(null);
      setProgress(0);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo leer el PDF.",
      );
    }
  }, []);

  const handleClearFile = useCallback(() => {
    setFileBytes(null);
    setFileName("");
    setOriginalSize(0);
    setLevel(null);
    setStatus("idle");
    setResultBytes(null);
    setErrorMessage(null);
    setProgress(0);
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const handleCompress = useCallback(() => {
    if (!fileBytes || !level) return;
    if (workerRef.current) workerRef.current.terminate();

    const worker = new CompressWorker();
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<CompressResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case "progress":
          setProgress(msg.pct);
          break;
        case "complete":
          setResultBytes(msg.bytes);
          setStatus("complete");
          setProgress(100);
          worker.terminate();
          workerRef.current = null;
          break;
        case "cancelled":
          setStatus("idle");
          setProgress(0);
          worker.terminate();
          workerRef.current = null;
          break;
        case "error":
          setErrorMessage(msg.message);
          setStatus("error");
          worker.terminate();
          workerRef.current = null;
          break;
      }
    };

    worker.onerror = (e) => {
      setErrorMessage(e.message || "Error desconocido en el worker.");
      setStatus("error");
    };

    setStatus("compressing");
    setProgress(0);
    setErrorMessage(null);
    setResultBytes(null);

    const request: CompressRequest = { type: "compress", bytes: fileBytes, level };
    worker.postMessage(request);
  }, [fileBytes, level]);

  const handleDownload = useCallback(() => {
    if (!resultBytes || !fileName) return;
    const blob = new Blob([resultBytes], { type: "application/pdf" });
    downloadBlob(blob, suggestFileName(fileName, "-comprimido"));
  }, [resultBytes, fileName]);

  const isCompressing = status === "compressing";

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-2">Comprimir</h1>
      <p className="text-text-muted mb-4">
        Reducí el tamaño de un PDF eligiendo un nivel de compresión.
      </p>

      {!fileBytes ? (
        <UploadArea onFile={handleFile} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 p-3 bg-surface border border-border rounded-lg">
            <div>
              <div className="font-medium text-text truncate">{fileName}</div>
              <div className="text-sm text-text-muted">
                {(originalSize / (1024 * 1024)).toFixed(1)} MB
              </div>
            </div>
            <button
              type="button"
              onClick={handleClearFile}
              disabled={isCompressing}
              className="text-sm px-3 py-1 border border-border rounded hover:border-primary disabled:opacity-50"
            >
              Cambiar archivo
            </button>
          </div>

          <section aria-labelledby="level-heading" className="flex flex-col gap-3">
            <h2 id="level-heading" className="text-lg font-medium text-text">
              Nivel de compresión
            </h2>
            <LevelSelector
              levels={LEVELS}
              value={level}
              onChange={(id) => setLevel(id as CompressLevel)}
              disabled={isCompressing}
            />
          </section>

          {errorMessage && (
            <p role="alert" className="text-red-600 text-sm">
              {errorMessage}
            </p>
          )}

          {isCompressing && <ProgressBar pct={progress} />}

          {status === "complete" && resultBytes && (
            <ResultBar
              originalBytes={originalSize}
              resultBytes={resultBytes.byteLength}
              onDownload={handleDownload}
            />
          )}

          {status === "idle" && (
            <button
              type="button"
              onClick={handleCompress}
              disabled={!level}
              className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Comprimir y descargar
            </button>
          )}
        </div>
      )}
    </Layout>
  );
}
```

- [x] **Step 2: Replace `src/tools/Comprimir.tsx` to delegate**

```tsx
import ComprimirPage from "./Comprimir/ComprimirPage";
export default ComprimirPage;
```

- [x] **Step 3: Verify build + type check**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -10
```

Expected: build succeeds (Vite reports output bundle written). Fix any type or build errors before continuing.

- [x] **Step 4: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add src/tools/Comprimir.tsx src/tools/Comprimir/ComprimirPage.tsx
git commit -m "feat(comprimir): add ComprimirPage integration"
```

---

## Task 10: Manual smoke test

**Files:** (no code changes)

- [x] **Step 1: Start the dev server in the background**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run dev 2>&1 | head -20
```

Expected: Vite reports `Local: http://localhost:5173/`.

- [x] **Step 2: Walk through the manual checklist from the spec**

Open `http://localhost:5173/comprimir` in Edge or Chrome and verify:

- [ ] First visit: a transparent reload occurs (COI service worker registers)
- [ ] Upload a 5 MB PDF — file bar shows name + size
- [ ] Pick "Media" — the level card highlights, the "Comprimir y descargar" button enables
- [ ] Click "Comprimir y descargar" — progress bar appears, then result shows
- [ ] Result shows "Original: 5.0 MB → Resultado: 2.5 MB (-50%)" (approximately)
- [ ] Click "Descargar PDF comprimido" — file downloads as `<name>-comprimido.pdf`
- [ ] Open the downloaded PDF in Edge/Chrome — opens correctly, same page count
- [ ] Click "Cambiar archivo" — file bar resets, level selector clears

- [x] **Step 3: Stop the dev server**

Stop the background `npm run dev` process (Ctrl+C in the shell where it's running).

- [x] **Step 4: Commit any final fixes**

If the smoke test revealed code issues, fix them and commit:

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add -A
git commit -m "fix(comprimir): address smoke test issues"
```

If no issues, skip this commit.

---

## Task 11: Final cleanup and plan 3 complete

**Files:** (cleanup only)

- [x] **Step 1: Run all tests one more time**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test -- --run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -5
```

Expected: all tests pass, no type errors.

- [x] **Step 2: Mark all Plan 2 checkboxes as done in `docs/superpowers/plans/2026-06-18-pdf-tool-plan-2-foliar.md`**

Open the file and replace each `- [ ]` with `- [x]` for every completed step. (Plan 2 was completed before this plan started; this is just bookkeeping.)

- [x] **Step 3: Update `docs/superpowers/plans/2026-06-19-pdf-tool-plan-3-comprimir.md` checkboxes**

Mark every task's checkbox in this plan as done.

- [x] **Step 4: Final empty commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git add docs/superpowers/plans/
git commit --allow-empty -m "chore: Plan 3 complete — Comprimir tool"
```

---

## Notes for the implementer

1. **WASM package API varies.** Task 1 says to confirm `@jspawn/ghostscript-wasm`; if that's broken or outdated, try `ghostscript-wasm`. The `compress.wasm-loader.ts` wrapper isolates the package so the rest of the code is unaffected.

2. **Progress reporting is best-effort.** Ghostscript doesn't expose per-page progress for PDF compression. The plan emits progress at the three natural boundaries (start, mid-load, complete). A future enhancement could parse GS's stderr for `Page N` messages and emit finer-grained progress — out of scope for Plan 3.

3. **No fallback to pdf-lib.** Per the spec, if GS fails we show the error. Don't add a pdf-lib fallback in Plan 3.

4. **Cancellation is cooperative.** GS runs synchronously inside `module.run()` — we can't truly abort mid-compression. The worker checks `cancelled` between boundaries; the in-flight GS call will complete, but its result is discarded. This matches what pdf-lib does in the Foliar worker.

5. **Test fixtures are out of scope.** The spec lists fixtures (`text-only-1page.pdf`, etc.) but creating real PDFs of specific sizes is fiddly in unit tests. The manual smoke test in Task 10 covers the realistic case; deferred integration tests can be added in a follow-up if needed.
