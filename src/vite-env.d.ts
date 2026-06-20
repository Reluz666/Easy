/// <reference types="vite/client" />

// The `@jspawn/ghostscript-wasm` package ships no type definitions. We
// consume only the default export and treat it as a function that returns
// the Emscripten Module promise; the loader narrows the shape it needs.
declare module "@jspawn/ghostscript-wasm/gs.mjs" {
  const createModule: (...args: unknown[]) => Promise<unknown>;
  export default createModule;
}
