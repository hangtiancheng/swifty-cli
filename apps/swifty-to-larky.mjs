#!/usr/bin/env node
/**
 * swifty-to-larky.mjs — 从 apps/swifty 拷贝业务代码到 apps/larky 的迁移同步脚本。
 *
 * 用法（在仓库任意位置执行）：
 *   node apps/swifty-to-larky.mjs           # 默认 dry-run：只打印将要发生的操作
 *   node apps/swifty-to-larky.mjs --write   # 实际落盘拷贝
 *
 * ⚠️ larky 侧已做过品牌替换（.swifty→.larky、Swifty→Larky 等）；
 *    --write 覆盖会把这些改名回退为 swifty 命名，执行前请先看 dry-run 的 update 清单。
 *
 * 行为约定（见 apps/migrate.md）：
 *   - 拷贝范围：swifty/src 下 28 个业务模块目录 + print-mode.ts/teammate.ts/main.tsx，
 *     以及 swifty/tests 下的 *.test.ts + run-e2e.mjs + run-failing.mjs。
 *   - larky 侧已被双进程改造的文件（PROTECTED 清单）**永不覆盖**，
 *     结尾会明确打印这些未拷贝的文件；不提供强制覆盖开关。
 *   - 其余文件一律覆盖（新文件标 new，覆盖标 update，内容相同标 same）。
 *   - 递归拷贝时排除 node_modules/.DS_Store。
 *
 * 注意：main.tsx 已被 larky 的 cli/main.ts 替代；拷入后会因新版 <App> props
 * 变化导致 typecheck 失败，脚本会对此打印警告。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SWIFTY = path.join(APPS_DIR, "swifty");
const LARKY = path.join(APPS_DIR, "larky");

// 安全默认：不带 --write 一律 dry-run（防止覆盖回退 larky 侧的品牌替换）
const DRY_RUN = !process.argv.includes("--write");

// 28 个业务模块目录（与 migrate.md §2.3 一致）
const SRC_DIRS = [
  "agent", "llm", "conversation", "tools", "tool-result", "prompt",
  "permissions", "sandbox", "config", "session", "compact", "memory",
  "skills", "commands", "subagent", "teams", "hooks", "mcp", "worktree",
  "code-review", "file-history", "plan-file", "todo", "history", "logger",
  "utils", "tui", "remote",
];

// 顶层单文件
const SRC_FILES = ["print-mode.ts", "teammate.ts", "main.tsx"];

// larky 侧已被双进程架构改造、永不覆盖的文件（相对 larky 根目录）
const PROTECTED = new Set([
  "src/tui/app.tsx",   // 重写为 SocketClient 事件驱动的 TUI
  "src/tui/index.tsx", // launchTUI：alt-screen + SocketClient 装配
  "src/teams/team.ts", // teammate 外部后端入口重定向到 cli/main
]);

// 递归拷贝时忽略的目录/文件名
const IGNORE = new Set(["node_modules", ".DS_Store"]);

const stats = { new: 0, update: 0, same: 0 };
const skippedProtected = [];
const missingSources = [];

function sameContent(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/** 拷贝单个文件（带保护清单/dry-run/统计）。 */
function copyFile(src, dest) {
  const relDest = path.relative(LARKY, dest);
  if (PROTECTED.has(relDest)) {
    skippedProtected.push(relDest);
    return;
  }
  const exists = existsSync(dest);
  if (exists && sameContent(src, dest)) {
    stats.same++;
    return;
  }
  const kind = exists ? "update" : "new";
  stats[kind]++;
  console.log(`  [${kind.padEnd(6)}] ${relDest}`);
  if (!DRY_RUN) {
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

/** 递归拷贝目录。 */
function copyDir(srcDir, destDir) {
  for (const entry of readdirSync(srcDir)) {
    if (IGNORE.has(entry)) continue;
    const src = path.join(srcDir, entry);
    const dest = path.join(destDir, entry);
    if (statSync(src).isDirectory()) {
      copyDir(src, dest);
    } else {
      copyFile(src, dest);
    }
  }
}

function main() {
  if (!existsSync(SWIFTY) || !existsSync(LARKY)) {
    console.error(`error: 需要同时存在 ${SWIFTY} 与 ${LARKY}`);
    process.exit(1);
  }
  console.log(`swifty → larky 拷贝${DRY_RUN ? "（dry-run，不落盘）" : ""}\n`);

  // 1. src 业务模块目录
  console.log("== src 业务模块 ==");
  for (const dir of SRC_DIRS) {
    const src = path.join(SWIFTY, "src", dir);
    if (!existsSync(src)) {
      missingSources.push(`src/${dir}`);
      continue;
    }
    copyDir(src, path.join(LARKY, "src", dir));
  }

  // 2. src 顶层单文件
  for (const file of SRC_FILES) {
    const src = path.join(SWIFTY, "src", file);
    if (!existsSync(src)) {
      missingSources.push(`src/${file}`);
      continue;
    }
    copyFile(src, path.join(LARKY, "src", file));
  }

  // 3. tests：*.test.ts + run-e2e.mjs + run-failing.mjs
  console.log("\n== tests ==");
  const testsDir = path.join(SWIFTY, "tests");
  for (const entry of readdirSync(testsDir)) {
    if (!/\.test\.ts$/.test(entry) && entry !== "run-e2e.mjs" && entry !== "run-failing.mjs") {
      continue;
    }
    copyFile(path.join(testsDir, entry), path.join(LARKY, "tests", entry));
  }

  // 4. 汇总
  console.log("\n== 汇总 ==");
  console.log(`  新增 ${stats.new}  覆盖 ${stats.update}  内容相同跳过 ${stats.same}`);
  if (missingSources.length > 0) {
    console.log(`  swifty 侧缺失（未拷贝）: ${missingSources.join(", ")}`);
  }
  if (skippedProtected.length > 0) {
    console.log("\n== 受保护、未拷贝的文件（larky 双进程改造版本，保持不动） ==");
    for (const f of skippedProtected) console.log(`  [skip  ] ${f}`);
  }
  if (stats.new + stats.update > 0 || DRY_RUN) {
    console.log(
      "\n提示: main.tsx 已被 larky 的 cli/main.ts 替代；若拷入 src/main.tsx，" +
        "其对 <App> 的旧 props 用法会导致 pnpm typecheck 失败，不需要时请删除。",
    );
  }
}

main();
