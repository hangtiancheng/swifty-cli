// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync, statSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const swiftyGoDir = resolve(__dirname, "../../../swifty.go");
const swiftyCliDir = join(swiftyGoDir, "swifty_cli");
const buildSrcDir = join(swiftyCliDir, "build");
const buildDestDir = join(__dirname, "build");

/**
 *
 * @param {string} message
 */
function fail(message) {
  console.error(`[swifty-code] ${message}`);
  process.exit(1);
}

/**
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
function run(command, args, cwd) {
  console.log(`[swifty-code] $ ${command} ${args.join(" ")} (cwd: ${cwd})`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    fail(`failed to run "${command}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`"${command} ${args.join(" ")}" exited with code ${result.status}`);
  }
}

if (!existsSync(swiftyGoDir) || !statSync(swiftyGoDir).isDirectory()) {
  fail(`swifty.go directory not found: ${swiftyGoDir}`);
}

if (!existsSync(join(swiftyGoDir, "go.work"))) {
  fail(`swifty.go is not a go work monorepo (missing go.work): ${swiftyGoDir}`);
}

run("go", ["work", "sync"], swiftyGoDir);

if (!existsSync(swiftyCliDir) || !statSync(swiftyCliDir).isDirectory()) {
  fail(`swifty_cli directory not found: ${swiftyCliDir}`);
}

run("go", ["mod", "tidy"], swiftyCliDir);
run("node", ["./build.mjs"], swiftyCliDir);

if (!existsSync(buildSrcDir) || !statSync(buildSrcDir).isDirectory()) {
  fail(`build output not found: ${buildSrcDir}`);
}

try {
  rmSync(buildDestDir, { recursive: true, force: true });
  cpSync(buildSrcDir, buildDestDir, { recursive: true });
} catch (err) {
  fail(`failed to copy build output: ${err instanceof Error ? err.message : String(err)}`);
}

console.log(`[swifty-code] build copied to ${buildDestDir}`);
