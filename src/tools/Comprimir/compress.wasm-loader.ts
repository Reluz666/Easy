import createGhostscriptModule from "@jspawn/ghostscript-wasm/gs.mjs";
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
 * mode, so calling the default export returns a Promise<Module> where the
 * module has a virtual `FS` and a `callMain(args)` entry point.
 *
 * We can't use `-sOutputFile=-` + stdin piping in a Web Worker easily
 * (Emscripten's stdin pipe is awkward to hook synchronously), so we write the
 * input bytes to a unique virtual file and read the output from another.
 */
export default async function loadGhostscript(): Promise<GhostscriptModule> {
  const Module = (await createGhostscriptModule()) as unknown as EmscriptenModule;

  return {
    async run(inputBytes: Uint8Array, args: string[]): Promise<Uint8Array> {
      const inputPath = "/in.pdf";
      // Replace the `-sOutputFile=-` and trailing `-` that `runGhostscript`
      // emits so the output is written to a real virtual file we can read.
      const fixedArgs = args.map((a) =>
        a === "-sOutputFile=-" ? "-sOutputFile=/out.pdf" : a,
      );
      const cleanedArgs = fixedArgs.filter((a) => a !== "-");

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
