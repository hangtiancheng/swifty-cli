#!/usr/bin/env node
/**
 * swifty-to-larky.mjs — 从 apps/swifty 拷贝业务代码到 apps/larky 的迁移同步脚本，
 * 拷贝时自动完成品牌替换。
 *
 * 用法（在仓库任意位置执行）：
 *   node apps/swifty-to-larky.mjs           # 默认 dry-run：只打印将要发生的操作
 *   node apps/swifty-to-larky.mjs --write   # 实际落盘拷贝
 *
 * 行为约定（见 apps/migrate.md）：
 *   - 拷贝范围：swifty/src 下 28 个业务模块目录 + print-mode.ts/teammate.ts，
 *     以及 swifty/tests 下的 *.test.ts + run-e2e.mjs + run-failing.mjs。
 *     （main.tsx 不拷贝：已被 cli/main.ts + tui/index.tsx 完全替代）
 *   - 品牌替换（仅文本文件）：swifty→larky、Swifty→Larky、SWIFTY→LARKY，
 *     随后把误伤的包名 @larky.js 统一改回 @swifty.js（workspace 包名不变）。
 *   - larky 侧已被双进程改造的文件（PROTECTED 清单）**永不覆盖**，
 *     结尾会明确打印这些未拷贝的文件；不提供强制覆盖开关。
 *   - 其余文件一律覆盖（新文件标 new，覆盖标 update，转换后内容相同标 same）。
 *   - 递归拷贝时排除 node_modules/dist/.DS_Store（remote/fe/dist 由用户自行 fe:build）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SWIFTY = path.join(APPS_DIR, "swifty");
const LARKY = path.join(APPS_DIR, "larky");

// 安全默认：不带 --write 一律 dry-run
const DRY_RUN = !process.argv.includes("--write");

// 28 个业务模块目录（与 migrate.md §2.3 一致）
const SRC_DIRS = [
  "agent", "llm", "conversation", "tools", "tool-result", "prompt",
  "permissions", "sandbox", "config", "session", "compact", "memory",
  "skills", "commands", "subagent", "teams", "hooks", "mcp", "worktree",
  "code-review", "file-history", "plan-file", "todo", "history", "logger",
  "utils", "tui", "remote",
];

// 顶层单文件（main.tsx 已被 cli/main.ts + tui/index.tsx 替代，不拷贝）
const SRC_FILES = ["print-mode.ts", "teammate.ts"];

// larky 侧已被双进程架构改造、永不覆盖的文件（相对 larky 根目录）
const PROTECTED = new Set([
  "src/tui/app.tsx",   // 重写为 SocketClient 事件驱动的 TUI
  "src/tui/index.tsx", // launchTUI：alt-screen + SocketClient 装配
  "src/teams/team.ts", // teammate 外部后端入口重定向到 cli/main
]);

// 递归拷贝时忽略的目录/文件名（dist：remote/fe 构建产物由用户自行打包）
const IGNORE = new Set(["node_modules", "dist", ".DS_Store"]);

// 品牌替换只作用于文本文件；其余（wasm/图片等）按字节原样拷贝
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json", ".md", ".yml",
  ".yaml", ".html", ".css", ".txt", ".toml",
]);

/**
 * 品牌替换：swifty→larky / Swifty→Larky / SWIFTY→LARKY，
 * 再把 workspace 包作用域 @larky.js 改回 @swifty.js（包名保持真实存在的名字）。
 * 覆盖场景示例：.swifty 目录→.larky、__SWIFTY_VERSION__→__LARKY_VERSION__、
 * SWIFTY_BYPASS_PERMISSIONS→LARKY_BYPASS_PERMISSIONS、"You are Swifty"→"You are Larky"。
 */
function brandTransform(content) {
  return content
    .replaceAll("swifty", "larky")
    .replaceAll("Swifty", "Larky")
    .replaceAll("SWIFTY", "LARKY")
    .replaceAll("@larky.js", "@swifty.js")
    .replaceAll("@larky\\.js", "@swifty\\.js"); // 正则字面量里的转义形式
}

const stats = { new: 0, update: 0, same: 0 };
const skippedProtected = [];
const missingSources = [];

/** 读取源文件并按需做品牌替换；返回 Buffer。 */
function transformedContent(src) {
  const raw = readFileSync(src);
  if (!TEXT_EXTS.has(path.extname(src))) return raw;
  return Buffer.from(brandTransform(raw.toString("utf-8")), "utf-8");
}

/** 拷贝单个文件（带保护清单/品牌替换/dry-run/统计）。 */
function copyFile(src, dest) {
  const relDest = path.relative(LARKY, dest);
  if (PROTECTED.has(relDest)) {
    skippedProtected.push(relDest);
    return;
  }
  const content = transformedContent(src);
  const exists = existsSync(dest);
  if (exists) {
    try {
      if (readFileSync(dest).equals(content)) {
        stats.same++;
        return;
      }
    } catch {
      // 读取失败按需要覆盖处理
    }
  }
  const kind = exists ? "update" : "new";
  stats[kind]++;
  console.log(`  [${kind.padEnd(6)}] ${relDest}`);
  if (!DRY_RUN) {
    mkdirSync(path.dirname(dest), { recursive: true });
    if (TEXT_EXTS.has(path.extname(src))) {
      writeFileSync(dest, content);
    } else {
      copyFileSync(src, dest); // 二进制按字节拷贝
    }
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
  console.log(
    `swifty → larky 拷贝 + 品牌替换${DRY_RUN ? "（dry-run，不落盘；--write 才写入）" : ""}\n`,
  );

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
  console.log(`  新增 ${stats.new}  覆盖 ${stats.update}  转换后内容相同跳过 ${stats.same}`);
  if (missingSources.length > 0) {
    console.log(`  swifty 侧缺失（未拷贝）: ${missingSources.join(", ")}`);
  }
  if (skippedProtected.length > 0) {
    console.log("\n== 受保护、未拷贝的文件（larky 双进程改造版本，保持不动） ==");
    for (const f of skippedProtected) console.log(`  [skip  ] ${f}`);
    console.log(
      "  注意: 以上文件及 larky 原生文件（core/agent-session.ts、core/app.ts、cli/main.ts、\n" +
        "  tui/index.tsx 等）中的 swifty 命名不在本脚本处理范围，需自行替换。",
    );
  }
}

main();
