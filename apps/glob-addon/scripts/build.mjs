// @ts-check

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"darwin" | "linux" | "windows"} Platform */
/** @typedef {"arm64" | "x64"} Arch */
/** @typedef {string} RustTarget */
/** @typedef {[Platform, Arch, RustTarget]} Target */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/** @type {Target[]} */
const targets = [
  ["darwin", "arm64", "aarch64-apple-darwin"],
  ["darwin", "x64", "x86_64-apple-darwin"],
  ["linux", "arm64", "aarch64-unknown-linux-gnu"],
  ["linux", "x64", "x86_64-unknown-linux-gnu"],
  ["windows", "arm64", "aarch64-pc-windows-gnullvm"],
  ["windows", "x64", "x86_64-pc-windows-gnu"],
];

/** @type {Record<string, Platform>} */
const platformMap = { darwin: "darwin", linux: "linux", windows: "windows", win: "windows" };
/** @type {Record<string, Arch>} */
const archMap = { arm64: "arm64", aarch64: "arm64", x64: "x64", x86_64: "x64", x86: "x64" };

/** @returns {Target} */
function nativeTarget() {
  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  const target = targets.find(([p, a]) => p === platform && a === arch)?.[2];
  if (!platform || !arch || !target) {
    throw new Error(`Unsupported native platform: ${process.platform}-${process.arch}`);
  }
  return [platform, arch, target];
}

/**
 * @param {RustTarget} target
 * @returns {string}
 */
function artifactName(target) {
  if (target.includes("windows")) {
    return "glob_addon.dll";
  }
  if (target.includes("apple")) {
    return "libglob_addon.dylib";
  }
  return "libglob_addon.so";
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {void}
 */
function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

/**
 * @param {Platform} platform
 * @param {Arch} arch
 * @param {RustTarget} target
 * @param {boolean} native
 * @returns {void}
 */
function build(platform, arch, target, native) {
  console.log(`\n=== Building ${platform}-${arch} (${target}) ===`);
  run("rustup", ["target", "add", target]);
  run("cargo", ["build", "--release", "--target", target]);

  const source = join(root, "target", target, "release", artifactName(target));
  const prebuildDir = join(root, "prebuilds", `${platform}-${arch}`);
  mkdirSync(prebuildDir, { recursive: true });
  copyFileSync(source, join(prebuildDir, "glob_addon.node"));

  if (native) {
    const releaseDir = join(root, "build", "Release");
    mkdirSync(releaseDir, { recursive: true });
    copyFileSync(source, join(releaseDir, "glob_addon.node"));
  }
}

const args = process.argv.slice(2);
if (args.includes("--clean")) {
  rmSync(join(root, "build"), { recursive: true, force: true });
  rmSync(join(root, "prebuilds"), { recursive: true, force: true });
}

if (args.includes("--all")) {
  for (const [platform, arch, target] of targets) {
    build(platform, arch, target, false);
  }
} else if (args.length >= 2) {
  const platform = platformMap[args[0]];
  const arch = archMap[args[1]];
  const target = targets.find(([p, a]) => p === platform && a === arch)?.[2];
  if (!platform || !arch || !target) {
    throw new Error(`Unknown target: ${args[0]}-${args[1]}`);
  }
  build(platform, arch, target, false);
} else {
  const [platform, arch, target] = nativeTarget();
  build(platform, arch, target, true);
}

console.log("\nBuild complete.");
