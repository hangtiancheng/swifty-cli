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

import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { defineConfig, type Options } from "tsup";

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

const cliBanner = [
  "#!/usr/bin/env node",
  'import { createRequire as __swiftyCreateRequire } from "node:module";',
  "const require = __swiftyCreateRequire(import.meta.url);",
].join("\n");

// core/app.js is spawned by CLI via `node dist/core/app.js` — needs the same
// createRequire shim but no shebang (not invoked directly by users).
const coreBanner = [
  'import { createRequire as __swiftyCreateRequire } from "node:module";',
  "const require = __swiftyCreateRequire(import.meta.url);",
].join("\n");

function externalizePlugin(): NonNullable<Options["esbuildPlugins"]> {
  const builtinRe = new RegExp(`^(${builtinModules.join("|")})(/.*)?$`);
  return [
    {
      name: "externalize-node-builtins-and-optional",
      setup(build) {
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
      },
    },
  ];
}

export default defineConfig([
  {
    entry: { "cli/main": "src/cli/main.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: true,
    splitting: false,
    sourcemap: true,
    banner: { js: cliBanner },
    noExternal: [/.*/],
    define: { __SWIFTY_VERSION__: JSON.stringify(pkg.version) },
    esbuildPlugins: externalizePlugin(),
  },
  {
    entry: { "core/app": "src/core/app.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: true,
    banner: { js: coreBanner },
    noExternal: [/.*/],
    define: { __SWIFTY_VERSION__: JSON.stringify(pkg.version) },
    esbuildPlugins: externalizePlugin(),
  },
]);
