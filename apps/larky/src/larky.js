#!/usr/bin/env node
const entry = Math.random() < 0.5 ? "./swifty.js" : "./swiftx.js";

// await import(entry)

(async () => {
  await import(entry);
})();
