# Comprimir — Plan 3 Design

**Fecha:** 2026-06-19
**Estado:** Aprobado para implementación
**Autor:** Claude (sesión de brainstorming con el usuario)
**Spec base:** `docs/superpowers/specs/2026-06-18-pdf-tool-design.md` (sección "Herramienta 2 — Comprimir")

## Propósito

Tercera herramienta del sistema PDF institucional. Permite reducir el tamaño de un PDF en tres niveles (Baja, Media, Alta) usando Ghostscript compilado a WebAssembly. El procesamiento ocurre 100% en el navegador del usuario (sin backend, sin envío de datos).

## Audiencia y contexto

Reutiliza el contexto del spec base: personal de una institución, sin login, despliegue estático, PDFs nunca salen del navegador.

## Arquitectura

```
                    UI Thread (React)
┌────────────────────────────────────────────────────┐
│ ComprimirPage.tsx                                  │
│   ├ FileBar (nombre, tamaño, "Cambiar archivo")   │
│   ├ LevelSelector (3 cards: Baja/Media/Alta)       │
│   ├ ProgressBar (durante procesamiento)            │
│   └ ResultBar (Original X MB → Y MB (-Z%))         │
│       └ [Comprimir y descargar]                    │
└──────────────┬─────────────────────────────────────┘
               │ postMessage (bytes + level)
               ▼
┌────────────────────────────────────────────────────┐
│ compress.worker.ts (Web Worker)                    │
│   ├ Carga ghostscript.wasm (lazy, primera vez)     │
│   ├ Ejecuta: gs -sDEVICE=pdfwrite                  │
│   │         -dPDFSETTINGS=/ebook (o /printer,      │
│   │         /screen según nivel) -o out.pdf        │
│   ├ Reporta progreso (% basado en tiempo/páginas)  │
│   └ Devuelve bytes del PDF comprimido              │
└────────────────────────────────────────────────────┘

   Bootstrap (primer load):
   ┌──────────────────────────────────────────┐
   │ coi-serviceworker.js (polyfill, ~5KB)   │
   │   └ Se registra solo la primera vez     │
   │   └ Recarga transparente                │
   │   └ Inyecta COOP/COEP via Service Worker│
   └──────────────────────────────────────────┘
```

### Stack técnico (reutilizado)

- React 19 + Vite 8 + TypeScript 6 + Tailwind 3 (igual que Plan 1 y 2)
- pdf-lib (sin cambios)
- pdfjs-dist (sin cambios)
- `@jspawn/ghostscript-wasm` (o equivalente a confirmar en implementación) — nueva dependencia
- `coi-serviceworker` (o equivalente a confirmar) — polyfill nuevo

## Componentes

| Componente | Responsabilidad | Reutiliza |
|---|---|---|
| `ComprimirPage.tsx` | Orquesta la herramienta, conecta UI ↔ worker | Patrón de `FoliarPage.tsx` |
| `LevelSelector.tsx` | 3 cards seleccionables (Baja/Media/Alta), una activa a la vez | Nuevo |
| `ProgressBar.tsx` | Barra de progreso + texto "Procesando..." | Nuevo |
| `ResultBar.tsx` | "Original 8.4 MB → Resultado 3.7 MB (-56%)" + botón descargar | Nuevo |
| `compress.worker.ts` | Carga WASM, ejecuta GS, reporta progreso, devuelve bytes | Nuevo |
| `compress.protocol.ts` | Tipos `CompressRequest` / `CompressResponse` (mismo shape que `foliar.protocol`) | Estructura de Foliar |
| `lib/pdf/ghostscript.ts` | Wrapper del loader WASM + ejecutor | Nuevo |
| `lib/pdf/ghostscript.test.ts` | Tests del wrapper (mockear el loader) | Nuevo |
| `lib/coi.ts` | Helper para registrar el service worker coi-serviceworker | Nuevo |

### Reglas de tamaño

Ningún archivo > 200 líneas. Si `ghostscript.ts` crece, separar en `loader.ts` (init WASM) + `runner.ts` (ejecutar comando GS).

## Flujo de datos

### Flujo normal (segunda visita en adelante, COI SW ya registrado)

1. Usuario arrastra PDF → `FileBar` lee bytes + tamaño
2. Usuario hace click en card "Media" → `LevelSelector` marca card activa, habilita botón "Comprimir y descargar"
3. UI envía al worker: `{ type: "compress", bytes, level: "media" }`
4. Worker:
   - Si WASM no está cargado → `loadGhostscript()` (tarda ~3-5s la primera vez)
   - Crea `Blob` desde los bytes del PDF como input
   - Ejecuta: `gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -dNOPAUSE -dBATCH -sOutputFile=out.pdf - input.pdf`
   - Cada X% de tiempo → `postMessage({ type: "progress", pct: 42 })`
   - Termina → `postMessage({ type: "complete", bytes: outBytes })`
5. UI:
   - Renderiza `ProgressBar` mientras `type === "progress"`
   - Al recibir `complete` → muestra `ResultBar` (tamaños antes/después)
   - Botón "Descargar" crea `Blob` y dispara descarga como `<name>-comprimido.pdf`

### Cancelación

- Usuario click "Cancelar" → UI envía `{ type: "cancel" }`
- Worker aborta GS, libera memoria, `postMessage({ type: "cancelled" }`
- UI resetea al estado inicial (selecciona nivel otra vez)

### Bootstrap (primera visita)

1. Usuario entra a `/comprimir` por primera vez
2. `lib/coi.ts` registra `coi-serviceworker.js` si no está registrado
3. Service worker recarga la página transparentemente (con COOP/COEP inyectados)
4. Segunda carga (instantánea desde caché del SW) → `SharedArrayBuffer` disponible
5. Worker carga `ghostscript.wasm` desde `/public/gs/ghostscript.wasm`

## Niveles de compresión

| Nivel | Parámetro GS | Resultado esperado |
|---|---|---|
| Baja | `-dPDFSETTINGS=/printer` (150 dpi) | ~10–20% de reducción. Casi sin pérdida visible. |
| Media (default, recomendada) | `-dPDFSETTINGS=/ebook` (100 dpi) | ~40–60% de reducción. Balance. |
| Alta | `-dPDFSETTINGS=/screen` (72 dpi) | ~70–85% de reducción. Imágenes pierden detalle. |

## Manejo de errores

| Falla | Mensaje al usuario |
|---|---|
| GS WASM no carga (red) | "No se pudo cargar el motor de compresión. Reintentá." |
| GS devuelve código != 0 | "No se pudo comprimir el PDF. El archivo puede estar protegido o dañado." |
| PDF protegido con contraseña | "No se pudo leer el PDF. Verificá que no esté protegido con contraseña ni dañado." |
| PDF > 800 MB | "Este PDF es demasiado grande para procesarlo en el navegador. Probá dividirlo primero." |
| PDF > 50 MB | Modal de aviso previo con estimación de tiempo (consistente con Foliar) |
| Usuario cancela | Silencioso |
| Navegador sin Web Workers | "Tu navegador es muy antiguo. Actualizalo a la última versión de Chrome, Firefox, Edge o Safari." |

**Sin fallback automático a pdf-lib** (YAGNI). Si GS falla, mostramos el error. Fallback es plan futuro si lo necesitamos.

## Validaciones

- El archivo debe ser PDF (verificar magic bytes `%PDF-`).
- El PDF debe parsearse correctamente con pdf-lib (sino, error de "dañado/protegido").
- Tamaño máximo: 800 MB (consistente con el spec base).

## Out of scope (futuro)

- Compresión con control fino (slider de calidad, opciones separadas).
- Compresión a tamaño objetivo ("comprimir a 2 MB").
- Fallback automático a pdf-lib si GS falla.
- Procesamiento de múltiples PDFs en batch.
- Compresión en background mientras se hacen otras operaciones.

## Testing

### Unit tests (Vitest)

- `lib/coi.ts` — registra SW si no registrado, no hace nada si ya está
- `lib/pdf/ghostscript.ts` — mockear el loader WASM, testear:
  - Mapeo nivel → `-dPDFSETTINGS` correcto (`/printer`, `/ebook`, `/screen`)
  - Cancelación aborta la ejecución
  - Errores de GS se propagan con mensaje limpio
- `compress.protocol.ts` — tipos y discriminadores

### Integration tests (con PDFs reales)

Fixtures en `src/test/fixtures/compress/`:
- `text-only-1page.pdf` (~5 KB) — compresión debería reducir <10%
- `images-10pages.pdf` (~3 MB) — compresión media debería reducir 40-60%
- `scanned-50pages.pdf` (~20 MB) — stress test, compresión alta debería reducir 70%+

Para cada fixture × cada nivel:
1. Cargar PDF
2. Llamar `runCompression(bytes, level)`
3. Verificar que el output:
   - Es un PDF válido (parseable por pdf-lib)
   - Tiene menos bytes que el original
   - Tiene la misma cantidad de páginas
   - El porcentaje de reducción está en el rango esperado (con tolerancia ±15%)

### Tests manuales (checklist pre-release)

- [ ] Comprimir PDF de 5 MB con nivel "Baja" → reducción ~10-20%, sin pérdida visible
- [ ] Comprimir PDF de 5 MB con nivel "Media" → reducción ~40-60%
- [ ] Comprimir PDF de 5 MB con nivel "Alta" → reducción ~70-85%
- [ ] Cancelar a mitad de compresión → estado limpio, sin memory leak
- [ ] Abrir el comprimido en Edge/Chrome → se ve bien, no corrupto
- [ ] Probar con PDF protegido con contraseña → mensaje de error claro
- [ ] Probar con PDF >50 MB → aparece modal de aviso previo
- [ ] Primera visita: ver la "recarga transparente" del COI SW

## Decisiones a confirmar durante implementación

1. **Paquete npm exacto para Ghostscript WASM.** El spec base sugiere `@jspawn/ghostscript-wasm` pero está con versión `^0.0.1` que es sospechosa. Investigar alternativas (`ghostscript-wasm`, compilar desde fuente) durante implementación.
2. **Polyfill exacto para COI service worker.** `coi-serviceworker` es el más conocido pero hay alternativas. Confirmar durante implementación.
3. **Estrategia de progreso.** GS no reporta progreso nativo para PDF. Decidir entre: (a) estimado por tiempo, (b) parsing de stderr para `Page N`, (c) page-count del PDF original dividido por estimación.

## Criterios de aceptación

- Usuario puede comprimir un PDF de 10 MB con nivel "Media" y obtener un PDF ~5 MB en menos de 60 segundos en una PC con 8 GB RAM.
- La UI nunca se congela durante la compresión (todo en worker).
- La aplicación funciona sin requerir config de headers HTTP en el servidor.
- El COI SW se registra una sola vez (recarga transparente única por usuario).
- Los 3 niveles producen reducciones dentro de los rangos esperados (±15%).
