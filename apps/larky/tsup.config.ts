/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { copyFileSync, cpSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Options } from "tsup";

const __dirname = dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

const cliBanner = [
  "#!/usr/bin/env node",
  // Provide a real `require` for bundled CJS modules (e.g. signal-exit)
  // that call require("assert") etc. esbuild's CJS-to-ESM shim checks
  // `typeof require !== "undefined"` and will use this instead of throwing.
  'import { createRequire as __larkyCreateRequire } from "node:module";',
  "const require = __larkyCreateRequire(import.meta.url);",
].join("\n");

// core/app.js is spawned by CLI via `node dist/core/app.js` — needs the same
// createRequire shim but no shebang (not invoked directly by users).
const coreBanner = [
  'import { createRequire as __larkyCreateRequire } from "node:module";',
  "const require = __larkyCreateRequire(import.meta.url);",
].join("\n");

// Both version macros are injected: kept larky-branded sources read
// __LARKY_VERSION__ while larky infra reads __LARKY_VERSION__.
const defines = {
  __LARKY_VERSION__: JSON.stringify(pkg.version),
};

function externalizePlugin(): NonNullable<Options["esbuildPlugins"]> {
  const builtinRe = new RegExp(`^(${builtinModules.join("|")})(/.*)?$`);
  return [
    {
      name: "externalize-node-builtins-and-optional",
      setup(build) {
        // CJS deps (e.g. signal-exit) use bare require("assert") which esbuild
        // can't shim in ESM output — externalize all Node.js built-ins
        build.onResolve({ filter: builtinRe }, (args) => ({
          path: args.path,
          external: true,
        }));
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: "react-devtools-core",
          namespace: "stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
        // @swifty.js/glob-addon is a C++ N-API addon (.node binary). esbuild
        // cannot bundle binaries — externalize it so build never breaks.
        build.onResolve({ filter: /@larky\.js\/glob-addon/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ];
}

const shared: Options = {
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  noExternal: [/.*/],
  define: defines,
  tsconfig: "tsconfig.json",
  esbuildPlugins: externalizePlugin(),
};

export default defineConfig([
  {
    ...shared,
    entry: { "cli/main": "src/cli/main.ts" },
    clean: true,
    banner: { js: cliBanner },
  },
  {
    ...shared,
    entry: { "core/app": "src/core/app.ts" },
    clean: false,
    banner: { js: coreBanner },
    onSuccess: async () => {
      // Runtime assets are built by `prebuild` (see package.json) before tsup
      // runs. Both bundles embed glob-wasm, which resolves release.wasm via
      // new URL("release.wasm", import.meta.url) — so the assets must sit
      // next to BOTH entry bundles (cli runs print/teammate/remote in-process).
      const wasmSrc = join(__dirname, "../glob-wasm/build/release.wasm");
      const addonSrc = join(__dirname, "../glob-addon/build/Release/glob_addon.node");
      for (const dir of ["dist/cli", "dist/core"]) {
        copyFileSync(wasmSrc, join(__dirname, dir, "release.wasm"));
        cpSync(join(__dirname, "src/skills/builtin"), join(__dirname, dir, "builtin"), {
          recursive: true,
        });
        copyFileSync(addonSrc, join(__dirname, dir, "glob_addon.node"));
      }
      console.log("copied release.wasm, builtin/, glob_addon.node -> dist/{cli,core}/");
    },
  },
]);
