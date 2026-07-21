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
import { defineConfig } from "tsup";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/main.tsx"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  minify: true,
  banner: {
    js: [
      "#!/usr/bin/env node",
      // Provide a real `require` for bundled CJS modules (e.g. signal-exit)
      // that call require("assert") etc. esbuild's CJS-to-ESM shim checks
      // `typeof require !== "undefined"` and will use this instead of throwing.
      'import { createRequire as __swiftyCreateRequire } from "node:module";',
      "const require = __swiftyCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  noExternal: [/.*/],
  define: { __SWIFTY_VERSION__: JSON.stringify(pkg.version) },
  tsconfig: "tsconfig.json",
  esbuildPlugins: [
    {
      name: "externalize-node-builtins",
      setup(build) {
        // CJS deps (e.g. signal-exit) use bare require("assert") which esbuild
        // can't shim in ESM output — externalize all Node.js built-ins
        const re = new RegExp(`^(${builtinModules.join("|")})(/.*)?$`);
        build.onResolve({ filter: re }, (args) => ({
          path: args.path,
          external: true,
        }));
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: "react-devtools-core",
          external: true,
        }));
        // @swifty.js/glob-addon is a C++ N-API addon (.node binary). esbuild
        // cannot bundle binaries — externalize it so build never breaks.
        // Currently addon/*.ts is dead code (tree-shaken), but this guard
        // prevents a build crash if someone imports it in the future.
        build.onResolve({ filter: /@swifty\.js\/glob-addon/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
  onSuccess: async () => {
    // Runtime assets are built by `prebuild` (see package.json) before tsup
    // runs. Copy them into dist/ so the bundle is self-contained. If a file
    // is missing, copyFileSync throws ENOENT — run `pnpm build` (which
    // triggers prebuild) instead of calling `tsup` directly.

    // 1. release.wasm — loaded by glob-wasm via new URL("release.wasm", import.meta.url)
    const wasmSrc = join(__dirname, "../../glob-wasm/build/release.wasm");
    copyFileSync(wasmSrc, join(__dirname, "dist/release.wasm"));

    // 2. builtin skills — SKILL.md + references, read by loadBuiltinFile()
    cpSync(join(__dirname, "src/skills/builtin"), join(__dirname, "dist/builtin"), {
      recursive: true,
    });

    // 3. glob_addon.node — native addon (platform-specific). Currently dead
    //    code but copied for future use. Cross-platform npm distribution
    //    would need per-platform prebuilt packages instead.
    copyFileSync(
      join(__dirname, "../../glob-addon/build/Release/glob_addon.node"),
      join(__dirname, "dist/glob_addon.node"),
    );

    console.log("copied release.wasm, builtin/, glob_addon.node -> dist/");
  },
});
