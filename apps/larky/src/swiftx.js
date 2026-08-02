#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const entry = require.resolve("@swifty.js/swiftx/src/index.js");

// await import(pathToFileURL(entry).href);

(async () => {
  await import(pathToFileURL(entry).href);
})();
