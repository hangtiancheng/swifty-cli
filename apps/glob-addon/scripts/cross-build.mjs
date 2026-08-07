// @ts-check

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const NODE_VERSION = process.env.NODE_VERSION ?? `v${process.versions.node}`;

/** @type {Record<string, string>} */
const PLATFORM_MAP = { darwin: "darwin", linux: "linux", windows: "win", win: "win" };
/** @type {Record<string, string>} */
const ARCH_MAP = { arm64: "arm64", aarch64: "arm64", x64: "x64", x86_64: "x64", x86: "x64" };
/** @type {Record<string, string>} */
const TOOLCHAIN_ARCH = { arm64: "arm64", x64: "x64" };

const allTargets = [
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["windows", "arm64"],
  ["windows", "x64"],
];

const headersOnly = process.argv.includes("--headers-only");

let targets;
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (positional.length >= 2) {
  const p = PLATFORM_MAP[positional[0]];
  const a = ARCH_MAP[positional[1]];
  if (!p || !a) {
    console.error(`Unknown target: ${positional[0]}-${positional[1]}`);
    process.exit(1);
  }
  targets = [[p === "win" ? "windows" : p, a]];
} else {
  targets = allTargets;
}

for (const [platform, arch] of targets) {
  const headerPlatform = PLATFORM_MAP[platform];
  const headersBase = join(root, "cmake", "node-headers", NODE_VERSION, `${headerPlatform}-${arch}`);
  const headersDir = join(headersBase, `node-${NODE_VERSION}`, "include", "node");

  const needHeaders = !existsSync(join(headersDir, "node_api.h"));
  const needNodeLib = headerPlatform === "win"
    && !existsSync(join(headersBase, `node-${NODE_VERSION}`, "lib", "node.lib"));
  if (needHeaders || needNodeLib) {
    console.log(`\n--- Downloading Node.js ${NODE_VERSION} headers for ${headerPlatform}-${arch} ---`);
    execFileSync("cmake", [
      `-DNODE_VERSION=${NODE_VERSION}`,
      `-DTARGET_PLATFORM=${headerPlatform}`,
      `-DTARGET_ARCH=${arch}`,
      "-P",
      join(root, "cmake", "download-node-headers.cmake"),
    ], { stdio: "inherit", cwd: root });
  }

  if (headersOnly) continue;

  const toolchainFile = join(root, "cmake", "toolchains", `${platform}-${TOOLCHAIN_ARCH[arch]}.cmake`);
  const buildDir = join(root, `build-${platform}-${arch}`);

  console.log(`\n=== Building ${platform}-${arch} ===`);
  const cmakeArgs = [
    "-S", root,
    "-B", buildDir,
    "-G", "Ninja",
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`,
    `-DNODE_HEADERS_DIR=${headersDir}`,
    "-DCMAKE_BUILD_TYPE=Release",
  ];
  if (headerPlatform === "win") {
    cmakeArgs.push(`-DNODE_LIB_DIR=${join(headersBase, `node-${NODE_VERSION}`, "lib")}`);
  }
  execFileSync("cmake", cmakeArgs, { stdio: "inherit", cwd: root });
  execFileSync("cmake", ["--build", buildDir, "--config", "Release"], { stdio: "inherit", cwd: root });
  console.log(`--- ${platform}-${arch} done ---`);
}

console.log("\nAll builds complete. Outputs in prebuilds/<platform>-<arch>/");
