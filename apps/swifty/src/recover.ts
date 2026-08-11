// 记录进程的启动、退出和崩溃现场，供异常退出后追查。

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { closeLogger, logger } from "./logger/logger.js";

const LOG_DIR = ".swifty";
const LOG_PATH = join(LOG_DIR, "crash.log");

/**
 * 往崩溃日志追加一行带时间戳的记录。
 * 诊断本身不能反过来把进程搞挂，所以写失败一律静默跳过。
 */
export function record(text: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${text}\n`, "utf8");
  } catch {
    // 忽略
  }
}

/** 记录一次异常，带完整调用栈。context 用来区分现场来自哪一层。 */
export function recordError(context: string, error: unknown): void {
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
  record(`crash [${context}] ${stack}`);
}

let exitRecorded = false;

/**
 * 写下 exit 标记，重复调用只写一次。
 *
 * 进入 raw mode 的 TUI 退出时 exit 事件未必派发得到，所以主流程跑完也会主动
 * 调一次，两条路径谁先到都算数。
 */
export function recordExit(code: number | string): void {
  if (exitRecorded) {
    return;
  }
  exitRecorded = true;
  record(`exit pid=${String(process.pid)} code=${String(code)}`);
}

/**
 * 安装崩溃诊断，进程启动时调用一次。
 *
 * 留下三类痕迹：start 行标记本次运行开始；exit 行在进程自行退出时由 exit 事件
 * 写出；uncaughtException 与 unhandledRejection 兜住漏到事件循环顶层的错误，
 * 这类错误默认只把栈打到终端，终端一关就什么都不剩。三者组合即可判定退出方式：
 * 有 crash 有 exit 是崩溃退出，只有 start 和 exit 是正常退出，只有 start 说明
 * 进程是被外部强制结束的。
 */
export function recover(): void {
  record(`start pid=${String(process.pid)}`);

  process.on("uncaughtException", (err) => {
    recordError("uncaught exception", err);
    // 处理器接管后运行时不再自己打印，这里补上，保持终端输出行为不变
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
  });

  // Catch async errors that escape the main loop.
  process.on("unhandledRejection", (reason) => {
    recordError("unhandled rejection", reason);
    logger.fatal({ err: reason }, "unhandled rejection");
    process.exit(1);
  });

  // Flush logs on exit.
  process.on("exit", (code) => {
    closeLogger();
    recordExit(code);
  });
}
