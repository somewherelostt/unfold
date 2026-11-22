import { existsSync, readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** Executes the actual server modules with only the external auth/model boundaries replaced. */
export function sourceLoader(dependencies = {}, env = {}) {
  const cache = new Map();
  const load = (file) => {
    const filename = path.resolve(file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} };
    cache.set(filename, loaded);
    const require = createRequire(filename);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    runInNewContext(output, {
      module: loaded, exports: loaded.exports, Buffer, URL, Headers, Request, Response, File, FormData, crypto: webcrypto,
      AbortController, AbortSignal, ReadableStream, TextEncoder, setInterval, clearInterval, setTimeout, clearTimeout, console,
      process: { ...process, env: { NODE_ENV: "test", ...env } },
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        if (name === "server-only") return {};
        if (name === "@unfold/core") return load(fileURLToPath(new URL("../../../../packages/core/src/index.ts", import.meta.url)));
        if (name === "@unfold/video/review") return load(fileURLToPath(new URL("../../../../packages/video/src/review.ts", import.meta.url)));
        if (name.startsWith("@/")) return load(fileURLToPath(new URL(`../${name.slice(2)}.ts`, import.meta.url)));
        if (name.startsWith(".")) {
          const relative = path.resolve(path.dirname(filename), name);
          return load(existsSync(relative) ? relative : `${relative}.ts`);
        }
        return require(name);
      },
    }, { filename });
    return loaded.exports;
  };
  return (relative) => load(fileURLToPath(new URL(relative, import.meta.url)));
}
