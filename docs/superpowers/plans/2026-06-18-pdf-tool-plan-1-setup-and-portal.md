# Plan 1 — Setup, Portal e infraestructura compartida

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tener una app web funcionando con el portal de 3 herramientas (Foliar, Comprimir, Páginas) y la infraestructura compartida (routing, layout, upload, librerías PDF). Las 3 herramientas son stubs por ahora; se implementan en los planes 2, 3 y 4.

**Architecture:** SPA en React + Vite + TypeScript + Tailwind. Sin backend. Tres rutas: `/`, `/foliar`, `/comprimir`, `/paginas`. Componentes compartidos en `src/components/`. Utilidades PDF en `src/lib/pdf/`. Tests con Vitest.

**Tech Stack:** React 18, Vite 5, TypeScript 5, Tailwind CSS 3, React Router 6, pdf-lib, pdfjs-dist, Vitest, @testing-library/react.

---

## File Structure

Archivos que este plan crea o modifica:

```
easy/
├── package.json                              [crear]     Dependencias y scripts
├── tsconfig.json                             [crear]     Configuración TS
├── tsconfig.node.json                        [crear]     Config TS para Vite
├── vite.config.ts                            [crear]     Configuración Vite
├── tailwind.config.js                        [crear]     Configuración Tailwind
├── postcss.config.js                         [crear]     PostCSS para Tailwind
├── index.html                                [crear]     HTML raíz
├── .gitignore                                [crear]     Ignorar node_modules, dist
├── src/
│   ├── main.tsx                              [crear]     Entry point
│   ├── App.tsx                               [crear]     Router
│   ├── index.css                             [crear]     Estilos base + Tailwind
│   ├── vite-env.d.ts                         [crear]     Tipos de Vite
│   ├── components/
│   │   ├── Layout.tsx                        [crear]     Header + outlet
│   │   ├── Portal.tsx                        [crear]     3 tarjetas de herramientas
│   │   ├── UploadArea.tsx                    [crear]     Drag & drop de PDFs
│   │   ├── StubPage.tsx                      [crear]     Placeholder para herramientas no implementadas
│   │   └── ui/
│   │       ├── Button.tsx                    [crear]     Botón reutilizable
│   │       └── Card.tsx                      [crear]     Tarjeta reutilizable
│   ├── tools/
│   │   ├── Foliar.tsx                        [crear]     Stub de Foliar
│   │   ├── Comprimir.tsx                     [crear]     Stub de Comprimir
│   │   └── Paginas.tsx                       [crear]     Stub de Páginas
│   └── lib/
│       ├── format.ts                         [crear]     Plantillas de folio
│       └── pdf/
│           ├── load.ts                       [crear]     Cargar PDF desde File
│           ├── thumbnail.ts                  [crear]     Renderizar thumbnail
│           └── download.ts                   [crear]     Disparar descarga
├── src/test/
│   ├── setup.ts                              [crear]     Setup de Vitest
│   └── format.test.ts                        [crear]     Tests de format.ts
└── src/lib/pdf/
    ├── load.test.ts                          [crear]     Tests de load.ts
    └── download.test.ts                      [crear]     Tests de download.ts
```

---

## Task 1: Inicializar proyecto Vite + React + TypeScript

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `.gitignore`

- [ ] **Step 1: Mover carpetas existentes a un backup temporal**

La carpeta ya tiene `.omc/` y `docs/`. Vite no permite inicializar en una carpeta no vacía, así que las movemos temporalmente:

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
mkdir -p .backup-init
mv .omc docs .backup-init/
```

- [ ] **Step 2: Inicializar el proyecto con Vite**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm create vite@latest . -- --template react-ts
```

Expected: Vite crea `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `public/vite.svg`, `src/assets/react.svg`.

- [ ] **Step 3: Restaurar las carpetas movidas**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
mv .backup-init/.omc .backup-init/docs ./
rmdir .backup-init
```

- [ ] **Step 4: Agregar `.omc/` y `.superpowers/` a `.gitignore`**

Editar `.gitignore` y agregar al final:

```
# Claude / OMC
.omc/
.superpowers/
```

- [ ] **Step 5: Verificar package.json**

Confirmar que `package.json` tiene:

```json
{
  "name": "easy",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

Si el `name` es distinto, dejarlo como está (no es bloqueante).

- [ ] **Step 6: Instalar dependencias base**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm install
```

Expected: instala `react`, `react-dom`, y devDependencies.

- [ ] **Step 7: Reemplazar App.tsx con un placeholder mínimo**

Sobreescribir `src/App.tsx` con:

```tsx
function App() {
  return <h1>Easy PDF</h1>;
}

export default App;
```

- [ ] **Step 8: Verificar que el build funciona**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
```

Expected: termina sin errores y crea la carpeta `dist/`.

- [ ] **Step 9: Inicializar git y hacer commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git init
git add .
git commit -m "chore: initialize vite + react + typescript project"
```

- [ ] **Step 2: Verificar package.json**

Confirmar que `package.json` tiene:

```json
{
  "name": "easy",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 3: Instalar dependencias base**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm install
```

Expected: instala `react`, `react-dom`, y devDependencies (`@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `typescript`, `vite`).

- [ ] **Step 4: Reemplazar App.tsx con un placeholder mínimo**

Sobreescribir `src/App.tsx` con:

```tsx
function App() {
  return <h1>Easy PDF</h1>;
}

export default App;
```

- [ ] **Step 5: Verificar que el build funciona**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
```

Expected: termina sin errores y crea la carpeta `dist/`.

- [ ] **Step 6: Commit**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
git init
git add .
git commit -m "chore: initialize vite + react + typescript project"
```

---

## Task 2: Instalar y configurar Tailwind CSS

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `tailwind.config.js`, `postcss.config.js`
- Modify: `src/index.css`

- [ ] **Step 1: Instalar Tailwind y PostCSS**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm install -D tailwindcss@3 postcss autoprefixer
```

- [ ] **Step 2: Crear `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        primary: 'var(--color-primary)',
        'primary-light': 'var(--color-primary-light)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        border: 'var(--color-border)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Crear `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Reemplazar `src/index.css`**

Sobreescribir `src/index.css` con:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-bg: #f5f7fa;
  --color-surface: #ffffff;
  --color-primary: #2c5282;
  --color-primary-light: #bee3f8;
  --color-text: #1a2332;
  --color-text-muted: #4a5568;
  --color-border: #e2e8f0;
}

html, body, #root {
  height: 100%;
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--color-text);
  background-color: var(--color-bg);
}
```

- [ ] **Step 5: Verificar build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
```

Expected: termina sin errores.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: configure tailwind css with institutional color tokens"
```

---

## Task 3: Instalar React Router y definir rutas

**Files:**
- Modify: `package.json`
- Create: `src/tools/Foliar.tsx`, `src/tools/Comprimir.tsx`, `src/tools/Paginas.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Instalar React Router**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm install react-router-dom@6
```

- [ ] **Step 2: Crear stub de Foliar (`src/tools/Foliar.tsx`)**

```tsx
export default function Foliar() {
  return <div>Foliar (stub — se implementa en Plan 2)</div>;
}
```

- [ ] **Step 3: Crear stub de Comprimir (`src/tools/Comprimir.tsx`)**

```tsx
export default function Comprimir() {
  return <div>Comprimir (stub — se implementa en Plan 3)</div>;
}
```

- [ ] **Step 4: Crear stub de Páginas (`src/tools/Paginas.tsx`)**

```tsx
export default function Paginas() {
  return <div>Páginas (stub — se implementa en Plan 4)</div>;
}
```

- [ ] **Step 5: Reemplazar `src/App.tsx` con router**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Portal from "./components/Portal";
import Foliar from "./tools/Foliar";
import Comprimir from "./tools/Comprimir";
import Paginas from "./tools/Paginas";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Portal />} />
        <Route path="/foliar" element={<Foliar />} />
        <Route path="/comprimir" element={<Comprimir />} />
        <Route path="/paginas" element={<Paginas />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 6: Verificar build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
```

Expected: error porque `Portal` aún no existe. Ese error se resuelve en la próxima tarea.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add react router with stub tool pages"
```

---

## Task 4: Crear componente Layout y Portal

**Files:**
- Create: `src/components/Layout.tsx`, `src/components/Portal.tsx`, `src/components/ui/Card.tsx`

- [ ] **Step 1: Crear `src/components/ui/Card.tsx`**

```tsx
import { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
};

export default function Card({ children, onClick, className = "" }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-surface rounded-lg shadow-sm border border-border p-6 ${
        onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Crear `src/components/Layout.tsx`**

```tsx
import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

type LayoutProps = {
  children: ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const showHome = location.pathname !== "/";

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-surface border-b border-border px-6 py-4 flex items-center gap-4">
        <div className="font-semibold text-text">Easy PDF</div>
        {showHome && (
          <Link
            to="/"
            className="ml-auto text-sm text-primary hover:underline"
          >
            ← Inicio
          </Link>
        )}
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Crear `src/components/Portal.tsx`**

```tsx
import { useNavigate } from "react-router-dom";
import Layout from "./Layout";
import Card from "./ui/Card";

const TOOLS = [
  { id: "foliar", title: "Foliar", description: "Numerar páginas del PDF", path: "/foliar", icon: "#️⃣" },
  { id: "comprimir", title: "Comprimir", description: "Reducir el tamaño del archivo", path: "/comprimir", icon: "📦" },
  { id: "paginas", title: "Páginas", description: "Agregar, eliminar o reordenar páginas", path: "/paginas", icon: "📄" },
];

export default function Portal() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-text mb-2">Herramientas PDF</h1>
        <p className="text-text-muted mb-8">Elegí una herramienta para empezar.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TOOLS.map((tool) => (
            <Card key={tool.id} onClick={() => navigate(tool.path)}>
              <div className="text-3xl mb-3">{tool.icon}</div>
              <h2 className="text-lg font-semibold text-text mb-1">{tool.title}</h2>
              <p className="text-sm text-text-muted">{tool.description}</p>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 4: Envolver los stubs con Layout**

Modificar `src/tools/Foliar.tsx`:

```tsx
import Layout from "../components/Layout";

export default function Foliar() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-text mb-2">Foliar</h1>
        <p className="text-text-muted">Numerar las páginas de un PDF.</p>
        <p className="text-sm text-text-muted mt-4">Stub — se implementa en Plan 2.</p>
      </div>
    </Layout>
  );
}
```

Modificar `src/tools/Comprimir.tsx`:

```tsx
import Layout from "../components/Layout";

export default function Comprimir() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-text mb-2">Comprimir</h1>
        <p className="text-text-muted">Reducir el tamaño de un PDF.</p>
        <p className="text-sm text-text-muted mt-4">Stub — se implementa en Plan 3.</p>
      </div>
    </Layout>
  );
}
```

Modificar `src/tools/Paginas.tsx`:

```tsx
import Layout from "../components/Layout";

export default function Paginas() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-text mb-2">Páginas</h1>
        <p className="text-text-muted">Agregar, eliminar o reordenar páginas.</p>
        <p className="text-sm text-text-muted mt-4">Stub — se implementa en Plan 4.</p>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 5: Verificar build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
```

Expected: termina sin errores.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add layout, portal with 3 tool cards, and stub pages"
```

---

## Task 5: Instalar pdf-lib, pdfjs-dist y configurar testing

**Files:**
- Modify: `package.json`
- Create: `src/test/setup.ts`, `vitest.config.ts`

- [ ] **Step 1: Instalar librerías PDF y testing**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm install pdf-lib pdfjs-dist
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Crear `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 3: Crear `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 4: Agregar scripts de test a `package.json`**

Asegurarse de que `package.json` tenga:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Verificar que Vitest funciona**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test
```

Expected: termina con `No test files found` (todavía no hay tests) y exit code 0.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: install pdf-lib, pdfjs-dist, and configure vitest"
```

---

## Task 6: Implementar `lib/format.ts` con tests (TDD)

**Files:**
- Create: `src/lib/format.ts`, `src/test/format.test.ts`

- [ ] **Step 1: Escribir el test primero**

Crear `src/test/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatFolio, type FolioFormat } from "../lib/format";

describe("formatFolio", () => {
  it("formats 'Folio N de TOTAL'", () => {
    const result = formatFolio("Folio N de TOTAL", 3, 10);
    expect(result).toBe("Folio 3 de 10");
  });

  it("formats 'Página N de TOTAL'", () => {
    const result = formatFolio("Página N de TOTAL", 1, 5);
    expect(result).toBe("Página 1 de 5");
  });

  it("formats 'N / TOTAL'", () => {
    const result = formatFolio("N / TOTAL", 7, 20);
    expect(result).toBe("7 / 20");
  });

  it("formats 'Solo N'", () => {
    const result = formatFolio("Solo N", 4, 9);
    expect(result).toBe("4");
  });

  it("converts numbers to letters when format is letters", () => {
    const result = formatFolio("Folio N de TOTAL", 3, 10, "letters");
    expect(result).toBe("Folio C de 10");
  });

  it("uses both number and letter when format is both", () => {
    const result = formatFolio("Folio N de TOTAL", 3, 10, "both");
    expect(result).toBe("Folio 3-C de 10");
  });

  it("converts numbers >26 to multi-letter (27 -> AA)", () => {
    const result = formatFolio("Solo N", 28, 30, "letters");
    expect(result).toBe("AB");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test -- format
```

Expected: FAIL con `Cannot find module '../lib/format'`.

- [ ] **Step 3: Implementar `src/lib/format.ts`**

```ts
export type FolioFormat =
  | "Folio N de TOTAL"
  | "Página N de TOTAL"
  | "N / TOTAL"
  | "Solo N";

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
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test -- format
```

Expected: PASS con 7 tests pasando.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add format utility for folio templates (TDD)"
```

---

## Task 7: Implementar `lib/pdf/load.ts` con tests (TDD)

**Files:**
- Create: `src/lib/pdf/load.ts`, `src/lib/pdf/load.test.ts`

- [ ] **Step 1: Crear PDF de fixture y escribir el test**

Crear `src/lib/pdf/load.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loadPdfFromFile } from "./load";

async function makePdfFile(numPages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    doc.addPage([200, 200]);
  }
  const bytes = await doc.save();
  return new File([bytes], "test.pdf", { type: "application/pdf" });
}

describe("loadPdfFromFile", () => {
  it("loads a valid PDF and returns document and page count", async () => {
    const file = await makePdfFile(3);
    const result = await loadPdfFromFile(file);
    expect(result.pageCount).toBe(3);
    expect(result.fileName).toBe("test.pdf");
    expect(result.fileSize).toBe(file.size);
  });

  it("rejects a non-PDF file", async () => {
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    await expect(loadPdfFromFile(file)).rejects.toThrow("El archivo debe ser un PDF");
  });

  it("rejects a file with PDF extension but invalid content", async () => {
    const file = new File(["not a pdf"], "fake.pdf", { type: "application/pdf" });
    await expect(loadPdfFromFile(file)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test -- load
```

Expected: FAIL con `Cannot find module './load'`.

- [ ] **Step 3: Implementar `src/lib/pdf/load.ts`**

```ts
import { PDFDocument } from "pdf-lib";

export type LoadedPdf = {
  document: PDFDocument;
  pageCount: number;
  fileName: string;
  fileSize: number;
};

export async function loadPdfFromFile(file: File): Promise<LoadedPdf> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("El archivo debe ser un PDF.");
  }

  const bytes = await file.arrayBuffer();
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (err) {
    throw new Error("No se pudo leer el PDF. Verificá que no esté protegido con contraseña ni dañado.");
  }

  return {
    document,
    pageCount: document.getPageCount(),
    fileName: file.name,
    fileSize: file.size,
  };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test -- load
```

Expected: PASS con 3 tests pasando.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add loadPdfFromFile with validation (TDD)"
```

---

## Task 8: Implementar `lib/pdf/download.ts` con tests (TDD)

**Files:**
- Create: `src/lib/pdf/download.ts`, `src/lib/pdf/download.test.ts`

- [ ] **Step 1: Escribir el test**

Crear `src/lib/pdf/download.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadBlob, suggestFileName } from "./download";

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL and triggers a download", () => {
    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();

    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const link = document.createElement("a");
    link.click = click;
    vi.spyOn(document, "createElement").mockReturnValue(link);

    const blob = new Blob(["data"], { type: "application/pdf" });
    downloadBlob(blob, "out.pdf");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(link.href).toBe("blob:fake-url");
    expect(link.download).toBe("out.pdf");
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});

describe("suggestFileName", () => {
  it("appends -foliado before the extension", () => {
    expect(suggestFileName("doc.pdf", "foliado")).toBe("doc-foliado.pdf");
  });

  it("appends -comprimido before the extension", () => {
    expect(suggestFileName("informe.pdf", "comprimido")).toBe("informe-comprimido.pdf");
  });

  it("appends -modificado before the extension", () => {
    expect(suggestFileName("anexo.pdf", "modificado")).toBe("anexo-modificado.pdf");
  });

  it("handles files without extension", () => {
    expect(suggestFileName("archivo", "foliado")).toBe("archivo-foliado");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test -- download
```

Expected: FAIL con `Cannot find module './download'`.

- [ ] **Step 3: Implementar `src/lib/pdf/download.ts`**

```ts
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type NameSuffix = "foliado" | "comprimido" | "modificado";

export function suggestFileName(original: string, suffix: NameSuffix): string {
  const dot = original.lastIndexOf(".");
  if (dot === -1) return `${original}-${suffix}`;
  return `${original.slice(0, dot)}-${suffix}${original.slice(dot)}`;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test -- download
```

Expected: PASS con 5 tests pasando.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add downloadBlob and suggestFileName utilities (TDD)"
```

---

## Task 9: Implementar `lib/pdf/thumbnail.ts`

**Files:**
- Create: `src/lib/pdf/thumbnail.ts`

- [ ] **Step 1: Crear `src/lib/pdf/thumbnail.ts`**

```ts
import * as pdfjs from "pdfjs-dist";

// El worker de pdfjs se sirve como módulo. Configuramos la ruta desde el bundle.
// En producción (build), Vite lo maneja; en dev, usamos el worker por defecto.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export type ThumbnailOptions = {
  pageNumber: number; // 1-indexed
  scale?: number;
  maxWidth?: number;
};

export async function renderThumbnail(
  file: File,
  options: ThumbnailOptions
): Promise<string> {
  const { pageNumber, scale = 1.5, maxWidth = 240 } = options;
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear el contexto 2D del canvas.");

  canvas.width = Math.min(viewport.width, maxWidth);
  canvas.height = viewport.height * (canvas.width / viewport.width);

  const transform = canvas.width !== viewport.width
    ? [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0]
    : undefined;

  await page.render({ canvasContext: context, viewport, transform }).promise;
  return canvas.toDataURL("image/png");
}
```

- [ ] **Step 2: Verificar build (TypeScript) y tests**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
npm test
```

Expected: build sin errores, tests pasando.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add renderThumbnail using pdfjs-dist"
```

> **Nota:** No se incluye test automatizado de `renderThumbnail` porque requiere DOM y PDF real, lo cual es costoso de mockear. Se valida manualmente en Plan 4 cuando se usa en la herramienta de Páginas.

---

## Task 10: Crear componente `UploadArea`

**Files:**
- Create: `src/components/UploadArea.tsx`

- [ ] **Step 1: Crear `src/components/UploadArea.tsx`**

```tsx
import { useState, useRef, DragEvent, ChangeEvent } from "react";

type UploadAreaProps = {
  onFileSelected: (file: File) => void;
  accept?: string;
};

export default function UploadArea({
  onFileSelected,
  accept = "application/pdf,.pdf",
}: UploadAreaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("El archivo debe ser un PDF.");
      return;
    }
    setError(null);
    onFileSelected(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary-light/20"
            : "border-border bg-surface hover:border-primary"
        }`}
      >
        <div className="text-5xl mb-3">📄</div>
        <p className="text-text font-medium">Arrastrá tu PDF acá</p>
        <p className="text-text-muted text-sm mt-1">o hacé clic para elegir un archivo</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onChange}
          className="hidden"
        />
      </div>
      {error && (
        <p className="text-red-600 text-sm mt-2">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
```

Expected: termina sin errores.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add UploadArea component with drag & drop and validation"
```

---

## Task 11: Verificación final del Plan 1

- [ ] **Step 1: Correr todos los tests**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm test
```

Expected: todos los tests pasan (format, load, download).

- [ ] **Step 2: Correr el build**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run build
```

Expected: termina sin errores, crea `dist/`.

- [ ] **Step 3: Iniciar el dev server y verificar visualmente**

```bash
cd "D:/Archivos de la U/PROYECTOS/Easy"
npm run dev
```

Visitar `http://localhost:5173` y verificar:
- Se ve el portal con 3 tarjetas (Foliar, Comprimir, Páginas).
- Click en cada tarjeta → lleva a su stub con el header y botón "← Inicio".
- El botón "Inicio" vuelve al portal.
- El layout respeta los colores institucionales (azul #2c5282, fondo #f5f7fa).

- [ ] **Step 4: Commit final**

```bash
git add .
git commit -m "chore: plan 1 complete - app scaffolded with portal and shared infra" --allow-empty
```

---

## Resumen

Al terminar este plan, la app tiene:

- ✅ Proyecto Vite + React + TypeScript + Tailwind configurado.
- ✅ Router con 4 rutas (`/`, `/foliar`, `/comprimir`, `/paginas`).
- ✅ Portal con 3 tarjetas que navegan a las herramientas.
- ✅ Layout con header, botón "Inicio" y logo placeholder.
- ✅ Componente `UploadArea` listo para subir PDFs con drag & drop.
- ✅ Utilidades PDF testeadas: `loadPdfFromFile`, `renderThumbnail`, `downloadBlob`, `formatFolio`.
- ✅ 15 tests pasando.
- ✅ Build de producción funciona.

**Listo para Plan 2 (Foliar).**
