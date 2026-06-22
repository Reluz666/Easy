import gsJsSource from "@jspawn/ghostscript-wasm/gs.js?raw";
import type { GhostscriptModule } from "../../lib/pdf/ghostscript";

/**
 * Minimal subset of the Emscripten Module API we rely on.
 * Declared structurally so we don't need to pull in Emscripten types
 * (and so the wrapper keeps working if the upstream shim changes).
 */
interface EmscriptenFs {
  writeFile(path: string, data: Uint8Array, opts?: unknown): void;
  readFile(path: string, opts?: { encoding?: string }): Uint8Array;
  unlink(path: string): void;
}

interface EmscriptenModule {
  callMain(args: string[]): number;
  FS: EmscriptenFs;
}

/**
 * Wraps the Emscripten-compiled `@jspawn/ghostscript-wasm` package and exposes
 * the small `GhostscriptModule.run(bytes, args)` shape that `runGhostscript`
 * expects.
 *
 * The upstream package is built with Emscripten's MODULARIZE + ENVIRONMENT=web
 * mode. Its `gs.mjs` wrapper uses a side-channel via `globalThis.exports.Module`
 * to bridge `gs.js` (which sets `exports["Module"] = Module` for classic-script
 * loading) into the ESM world — that pattern works when `gs.js` is loaded as a
 * classic script where `exports === globalThis.exports`, but breaks when Vite
 * bundles `gs.js` as ESM (where `exports` is module-local and the export
 * branches never fire, leaving `createModuleFromExports` undefined and the
 * fallback `createModule` triggering `ReferenceError: createModule is not
 * defined`).
 *
 * Workaround: import `gs.js` as raw text via Vite's `?raw` query and eval it
 * in a scope where `exports` resolves to `globalThis.exports`. The package is
 * built with ENVIRONMENT=web, so the Node-specific code paths in `gs.js`
 * (guarded by an internal `p` flag that is false in browser builds) are
 * skipped — no shim needed for `require`.
 *
 * We can't use `-sOutputFile=-` + stdin piping in a Web Worker easily
 * (Emscripten's stdin pipe is awkward to hook synchronously), so we write the
 * input bytes to a unique virtual file and read the output from another.
 */
export default async function loadGhostscript(): Promise<GhostscriptModule> {
  const g = globalThis as Record<string, unknown>;
  g.exports = {};

  const createModule = new Function(
    gsJsSource + "\nreturn Module;",
  )() as (opts?: {
    locateFile?: (path: string, scriptDirectory: string) => string;
  }) => Promise<EmscriptenModule>;

  delete g.exports;

  // Emscripten's MODULARIZE returns the createModule function; calling it
  // returns a Promise that resolves to the initialized Module. Tell it where
  // to find the .wasm file (copied from @jspawn/ghostscript-wasm to public/gs/
  // during install, preserving its original name `gs.wasm`).
  const Module = await createModule({
    locateFile: (path: string) => `/gs/${path}`,
  });

  return {
    async run(inputBytes: Uint8Array, args: string[]): Promise<Uint8Array> {
      const inputPath = "/in.pdf";
      // Replace the `-sOutputFile=-` (stdout) and `-` (stdin) that
      // `runGhostscript` emits with real virtual-file paths so Emscripten's
      // MEMFS backs them. Otherwise GS runs with no input and produces an
      // empty PDF.
      const cleanedArgs = args.map((a) => {
        if (a === "-sOutputFile=-") return "-sOutputFile=/out.pdf";
        if (a === "-") return inputPath;
        return a;
      });

      try {
        Module.FS.writeFile(inputPath, inputBytes);
        const code = Module.callMain(cleanedArgs);
        if (code !== 0) {
          throw new Error(`Ghostscript salió con código ${code}.`);
        }
        return Module.FS.readFile("/out.pdf");
      } finally {
        // Best-effort cleanup so a long-lived module doesn't leak files
        // across runs.
        try {
          Module.FS.unlink(inputPath);
        } catch {
          /* ignore */
        }
        try {
          Module.FS.unlink("/out.pdf");
        } catch {
          /* ignore */
        }
      }
    },
  };
}