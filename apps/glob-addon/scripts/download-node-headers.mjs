// @ts-check

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const NODE_VERSION = process.argv[2] ?? `v${process.versions.node}`;

const targets = [
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["win", "arm64"],
  ["win", "x64"],
];

for (const [platform, arch] of targets) {
  console.log(`\n--- Downloading Node.js ${NODE_VERSION} headers for ${platform}-${arch} ---`);
  execFileSync("cmake", [
    `-DNODE_VERSION=${NODE_VERSION}`,
    `-DTARGET_PLATFORM=${platform}`,
    `-DTARGET_ARCH=${arch}`,
    "-P",
    path.join(root, "cmake", "download-node-headers.cmake"),
  ], { stdio: "inherit", cwd: root });
}

console.log("\nAll headers downloaded.");
