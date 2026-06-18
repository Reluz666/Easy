# Sistema web de manipulación de PDFs — Diseño

**Fecha:** 2026-06-18
**Estado:** Borrador para revisión
**Autor:** Claude (sesión de brainstorming con el usuario)

## Propósito

Sistema web institucional para tres operaciones sobre archivos PDF:

1. **Foliar** — numerar las páginas de un PDF con posición, formato, tipografía, color y rango configurables.
2. **Comprimir** — reducir el tamaño de un PDF en tres niveles (baja, media, alta).
3. **Manipular páginas** — eliminar, reordenar y agregar páginas (desde otro PDF o en posiciones específicas).

## Audiencia y contexto

- **Usuarios:** personal de una institución, sin login.
- **Despliegue:** dentro del dominio de la institución, sin backend de aplicación.
- **Concurrencia:** múltiples usuarios en paralelo, sin estado compartido entre sesiones.
- **Privacidad:** los PDFs nunca salen del navegador del usuario.

## Arquitectura

Single Page Application (SPA) estática. Todo el procesamiento ocurre en el navegador del usuario mediante Web Workers. La institución solo sirve archivos estáticos (HTML, JS, CSS, WASM).

### Flujo general

```
Usuario abre la app
    │
    ▼
Portal (/) con 3 tarjetas: Foliar · Comprimir · Páginas
    │
    ▼
Elige una herramienta → sube PDF → configura → procesa → descarga
    │
    ▼
PDF nunca viaja al servidor
```

### Stack técnico

- **React 18** — UI
- **Vite 5** — build y dev server
- **TypeScript** — tipado fuerte
- **Tailwind CSS** — estilos
- **React Router 6** — navegación interna (`/`, `/foliar`, `/comprimir`, `/paginas`)
- **pdf-lib** — manipulación de PDFs (folios, agregar/quitar páginas)
- **pdfjs-dist** — renderizar thumbnails
- **Ghostscript compilado a WebAssembly** (`@jspawn/ghostscript-wasm` o equivalente) — compresión de alta calidad, **lazy-loaded** solo cuando el usuario entra a Comprimir

### Estructura de directorios

```
easy/
├── public/
│   ├── gs/                      # Ghostscript WASM (cargado on-demand)
│   └── fonts/                   # Fuentes estándar embebidas
├── src/
│   ├── components/
│   │   ├── Layout.tsx           # Header con logo + botón "Inicio"
│   │   ├── Portal.tsx           # Las 3 tarjetas de herramientas
│   │   ├── UploadArea.tsx       # Drag & drop + botón "Elegir archivo"
│   │   ├── PdfPreview.tsx       # Vista previa con navegación ◀▶
│   │   └── ui/                  # Botones, selects, inputs reutilizables
│   ├── tools/
│   │   ├── Foliar/
│   │   │   ├── FoliarPage.tsx
│   │   │   ├── FoliarConfig.tsx
│   │   │   └── foliar.worker.ts
│   │   ├── Comprimir/
│   │   │   ├── ComprimirPage.tsx
│   │   │   ├── CompressLevels.tsx
│   │   │   └── compress.worker.ts
│   │   └── Paginas/
│   │       ├── PaginasPage.tsx
│   │       ├── ThumbnailGrid.tsx
│   │       └── paginas.worker.ts
│   ├── lib/
│   │   ├── pdf/
│   │   │   ├── load.ts          # Cargar PDF desde File
│   │   │   ├── thumbnail.ts     # Generar thumbnail
│   │   │   ├── ghostscript.ts   # Wrapper de GS WASM
│   │   │   └── download.ts      # Disparar descarga en navegador
│   │   └── format.ts            # Plantilla "Folio N de TOTAL" → string
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## Identidad visual

- **Estilo:** Moderno suave (validado en maqueta).
- **Paleta base:**
  - Fondo general: `#f5f7fa`
  - Tarjetas y paneles: `#ffffff`
  - Acento primario: `#2c5282` (azul institucional)
  - Acento claro: `#bee3f8`
  - Texto principal: `#1a2332`
  - Texto secundario: `#4a5568`
  - Borde: `#e2e8f0`
- **Colores institucionales reales:** a definir por la institución (logo + paleta). Se aplicarán como variables CSS que reemplazan los acentos.
- **Tipografía:** sistema (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) más las fuentes estándar embebidas que el usuario puede elegir en Foliar.
- **Logo institucional:** se mostrará en el header.

## Herramienta 1 — Foliar

### Interfaz

- **Header:** logo + botón "Inicio".
- **Barra de archivo:** muestra el nombre, tamaño y cantidad de páginas. Botón "Cambiar archivo".
- **Vista previa (izquierda):** renderiza la página actual del PDF con el folio aplicado. Navegación `◀ Página N de M ▶`. La posición y formato del folio se actualizan en vivo al cambiar opciones.
- **Panel de configuración (derecha):** todos los controles en una columna vertical con scroll si no entran.

### Controles de configuración

| Control | Tipo | Opciones / valores por defecto |
|---|---|---|
| Posición | Matriz 3×3 clickeable | 9 posiciones: 4 esquinas, 4 costados, centro. Default: abajo-centro. |
| Formato | Select | `Folio N de TOTAL` (default), `Página N de TOTAL`, `N / TOTAL`, `Solo N`. |
| Tipo de numeración | 3 botones (radio) | Números (default): `1`, `2`, `3`. Letras: `A`, `B`, `C`. Ambas: número y letra juntos, ej: `1-A`, `2-B`, `3-C`. |
| Tipo de letra | Select | Arial (default), Times New Roman, Courier New, Verdana, Georgia. |
| Tamaño | Input numérico + unidad `pt` | Default 12 pt, rango 6–72. |
| Color | Color picker (input type="color") | Default `#000000`. |
| Rango de foliado | Bloque con 3 inputs | Número inicial (default 1), Desde pág. (default 1), Hasta pág. (default última página del PDF). |

### Comportamiento

1. Usuario arrastra o elige un PDF.
2. Se renderiza la primera página en la vista previa.
3. Cualquier cambio en el panel actualiza la vista previa en vivo (re-render del canvas con el folio aplicado).
4. Al hacer clic en **"Generar PDF foliado"**:
   - Se envía el PDF y la configuración al Web Worker.
   - El worker procesa por lotes de 10–20 páginas con progreso visible.
   - Al terminar, se dispara la descarga automática del PDF resultante.
5. El archivo descargado se nombra `<original>-foliado.pdf`.

### Reglas de validación

- "Desde pág." debe ser ≥ 1 y ≤ total de páginas.
- "Hasta pág." debe ser ≥ "Desde pág." y ≤ total de páginas.
- Si los valores son inválidos, se muestra mensaje en rojo bajo el input y el botón "Generar" se deshabilita.

## Herramienta 2 — Comprimir

### Interfaz

- **Header:** logo + botón "Inicio".
- **Barra de archivo:** muestra nombre, tamaño original y cantidad de páginas. Botón "Cambiar archivo".
- **Selector de nivel:** 3 tarjetas seleccionables, una activa a la vez.
- **Comparación de tamaño:** barra horizontal que muestra `Original 8.4 MB` → `Resultado 3.7 MB (-56%)` cuando se selecciona un nivel y termina el procesamiento.
- **Botón "Comprimir y descargar".**

### Niveles de compresión

| Nivel | Cuándo se procesa | Resultado esperado |
|---|---|---|
| Baja | Al seleccionar la tarjeta | ~10–20% de reducción. Casi sin pérdida visible. |
| Media (recomendada) | Al seleccionar la tarjeta | ~40–60% de reducción. Balance. |
| Alta | Al seleccionar la tarjeta | ~70–85% de reducción. Imágenes pierden detalle. |

### Comportamiento

1. Usuario sube PDF.
2. Aparece el selector con los 3 niveles. La "Media" sale preseleccionada.
3. Al hacer clic en un nivel:
   - Se carga Ghostscript WASM (solo la primera vez; después queda en caché del navegador).
   - Se procesa en Web Worker.
   - Se muestra progreso y luego el resultado (tamaño antes/después).
4. Al hacer clic en **"Comprimir y descargar"**, se descarga el PDF comprimido con el nombre `<original>-comprimido.pdf`.

### Fallback

Si Ghostscript falla (error interno, archivo incompatible), se aplica automáticamente compresión con pdf-lib (re-codificación de imágenes + compactación de streams). Se muestra un aviso: *"Compresión limitada aplicada. Para mejores resultados, intentá nuevamente."*

## Herramienta 3 — Páginas

### Interfaz

- **Header:** logo + botón "Inicio".
- **Barra superior:** nombre del PDF, cantidad de páginas, contador `N marcadas para eliminar` (en color de aviso), botón `+ Agregar PDF`.
- **Grilla de thumbnails:** 3 columnas, scroll vertical. Cada thumbnail muestra: preview de la página, número, ícono de arrastre `⠿`. Los marcados para eliminar aparecen tachados con opacidad reducida y una `✕` roja en la esquina.
- **Barra inferior:** botón "Restablecer" (limpia cambios) y botón "Generar PDF" (muestra entre paréntesis la cantidad final de páginas).

### Comportamiento

1. Usuario sube PDF principal.
2. Se renderizan los thumbnails con **lazy loading** (`IntersectionObserver`): solo se generan los visibles en pantalla y los adyacentes al hacer scroll.
3. **Click en un thumbnail** → alterna marcado para eliminar. Confirmación visual inmediata (tachado + `✕`).
4. **Drag & drop** sobre un thumbnail → reordena. Se usa `@dnd-kit/core` o la API nativa HTML5. Mientras se arrastra, el thumbnail se eleva con sombra y un placeholder indica la posición de inserción.
5. **Click en "+ Agregar PDF"** → abre selector de archivo → las páginas del nuevo PDF se insertan al final (o donde indique un dropdown "Insertar al inicio / al final / después de la pág. N" que aparece en la barra superior). Se renderizan en verde para distinguirlas.
6. Al hacer clic en **"Generar PDF"**:
   - Se envía la lista de operaciones (eliminar, reordenar, insertar) al Web Worker.
   - Se procesa y descarga como `<original>-modificado.pdf`.

### Reglas

- No se puede "Restablecer" si no hay cambios pendientes.
- El botón "Generar PDF" se deshabilita si la cantidad de páginas resultante es 0.
- El umbral de "archivo grande" para esta herramienta es el mismo que el general: **>50 MB** dispara el modal de aviso.

## Manejo de archivos grandes

- **Web Workers** para todas las operaciones pesadas: la UI nunca se congela.
- **Lazy loading de thumbnails** en la herramienta de Páginas.
- **Aviso previo** si el PDF pesa **>50 MB**: modal con estimación de tiempo y botón "Continuar / Cancelar".
- **Procesamiento por lotes** (10–20 páginas por vez) con barra de progreso en todas las herramientas.
- **Botón "Cancelar"** visible durante cualquier proceso largo. Al cancelar, se libera la memoria inmediatamente.
- **Límite práctico estimado:** 500–800 MB en una PC con 8 GB de RAM. Por encima de ~800 MB, se muestra un mensaje sugiriendo dividir el PDF.

## Manejo de errores

| Situación | Mensaje al usuario |
|---|---|
| El archivo no es PDF | "El archivo debe ser un PDF." |
| PDF corrupto o con contraseña | "No se pudo leer el PDF. Verificá que no esté protegido con contraseña ni dañado." |
| Archivo > 800 MB | "Este PDF es demasiado grande para procesarlo en el navegador. Probá dividirlo primero." |
| Cancelación por el usuario | Silencioso (sin error). |
| Ghostscript falla | "Compresión limitada aplicada. Para mejores resultados, intentá nuevamente." (fallback automático a pdf-lib). |
| Navegador no soporta Web Workers | "Tu navegador es muy antiguo. Actualizalo a la última versión de Chrome, Firefox, Edge o Safari." |

## Testing

- **Vitest** + **@testing-library/react** para unit y component tests.
- **Unit tests** de funciones puras: `format.ts` (plantillas de folio), cálculos de rangos, validaciones.
- **Tests de integración** con PDFs de ejemplo en `src/test/fixtures/`:
  - PDF de 1 página, 10 páginas, 100 páginas.
  - PDF con imágenes y PDF solo texto.
  - PDF con y sin metadatos.
- **Tests manuales** de aceptación (checklist antes de release):
  - Foliar un PDF de 50 páginas y verificar visualmente cada página.
  - Comprimir un PDF con imágenes y verificar que la calidad sigue siendo aceptable.
  - Eliminar y reordenar páginas y verificar que el PDF resultante es correcto.
  - Probar con un PDF de 100+ páginas y verificar que la UI no se congela.

## Despliegue

1. `npm install` para instalar dependencias.
2. `npm run build` genera la carpeta `dist/` con todos los archivos estáticos.
3. La institución sube el contenido de `dist/` a su servidor web (Apache, Nginx, IIS) o a un hosting estático (Netlify, Vercel, GitHub Pages).
4. **No requiere backend, base de datos ni runtime server-side.**

### Headers requeridos en el servidor

Para que Ghostscript WASM funcione correctamente, el servidor debe enviar:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

(Si la institución no puede configurar headers, se puede usar un polyfill, pero es preferible configurar los headers.)

## Dependencias principales

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "pdf-lib": "^1.17.1",
    "pdfjs-dist": "^4.0.0",
    "@dnd-kit/core": "^6.1.0",
    "@jspawn/ghostscript-wasm": "^0.0.1"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "typescript": "^5.5.0",
    "tailwindcss": "^3.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0"
  }
}
```

> Nota: la versión exacta de `@jspawn/ghostscript-wasm` o el wrapper de Ghostscript WASM que se elija se confirmará durante la implementación.

## Alcance fuera de esta versión (futuro)

- Rangos discontinuos de foliado (ej: "foliar 3-7 y 10-15").
- Compresión con control fino (slider de calidad, opciones separadas para imágenes, metadatos, fuentes).
- Compresión a un tamaño objetivo específico (ej: "comprimir a 2 MB").
- Inserción de páginas en blanco.
- Marca de agua de texto o imagen.
- Historial de archivos procesados (requeriría backend o IndexedDB).
- Modo oscuro.
- Internacionalización (i18n) — arrancar solo en español.

## Pendientes para implementación

- Recibir logo y colores oficiales de la institución.
- Confirmar el wrapper de Ghostscript WASM a usar (revisar alternativas a `@jspawn/ghostscript-wasm` durante la implementación).
- Definir el nombre final del proyecto.
