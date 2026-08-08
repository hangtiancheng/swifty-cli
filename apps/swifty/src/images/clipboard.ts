import { spawn } from "node:child_process";
import {
  mkdtemp as fsMkdtemp,
  readFile as fsReadFile,
  rm as fsRm,
  stat as fsStat,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";

import {
  ImageTooLargeError,
  InvalidImageError,
  loadImageBufferAttachment,
  type ImageAttachment,
} from "@/images/image.js";

export const DEFAULT_CLIPBOARD_TIMEOUT_MS = 5_000;
export const MAX_CLIPBOARD_STDOUT_BYTES = 32 * 1024 * 1024;

const MAX_CLIPBOARD_STDERR_BYTES = 16 * 1024;
const MAX_CLIPBOARD_TYPE_LIST_BYTES = 64 * 1024;

export type ClipboardBackend =
  | "osascript"
  | "pngpaste"
  | "wl-paste"
  | "xclip"
  | "powershell"
  | "pwsh";

export type ClipboardErrorCode =
  | "no_image"
  | "tool_unavailable"
  | "unsupported"
  | "timeout"
  | "output_too_large"
  | "invalid"
  | "image_too_large"
  | "permission_denied"
  | "clipboard_busy"
  | "command_failed";

export type ClipboardImageResult =
  | { ok: true; image: ImageAttachment; backend: ClipboardBackend }
  | {
      ok: false;
      error: { code: ClipboardErrorCode; message: string; installHint?: string };
    };

export interface ClipboardProcessRequest {
  command: string;
  args: readonly string[];
  timeoutMs: number;
  maxStdoutBytes: number;
}

export type ClipboardProcessResult =
  | { kind: "exit"; code: number; stdout: Buffer; stderr: string }
  | { kind: "not_found" }
  | { kind: "timeout" }
  | { kind: "output_limit" }
  | { kind: "spawn_error"; message: string };

export type ClipboardCommandRunner = (
  request: ClipboardProcessRequest,
) => Promise<ClipboardProcessResult>;

export interface ClipboardRuntime {
  platform: NodeJS.Platform;
  env: Readonly<NodeJS.ProcessEnv>;
  run: ClipboardCommandRunner;
  tmpdir(): string;
  mkdtemp(prefix: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  stat(path: string): Promise<{ size: number; isFile(): boolean }>;
  remove(path: string): Promise<void>;
}

export interface ReadClipboardImageOptions {
  runtime?: ClipboardRuntime;
  timeoutMs?: number;
  maxStdoutBytes?: number;
}

type ClipboardFailure = Extract<ClipboardImageResult, { ok: false }>;

const MACOS_CLIPBOARD_SCRIPT = String.raw`
on run argv
  set outputPath to item 1 of argv
  try
    set imageData to the clipboard as «class PNGf»
  on error errorMessage number errorNumber
    if errorNumber is -1700 then
      return "SWIFTY_NO_IMAGE"
    end if
    error errorMessage number errorNumber
  end try

  set outputFile to missing value
  try
    set outputFile to open for access (POSIX file outputPath) with write permission
    set eof outputFile to 0
    write imageData to outputFile
    close access outputFile
  on error errorMessage number errorNumber
    if outputFile is not missing value then
      try
        close access outputFile
      end try
    end if
    error errorMessage number errorNumber
  end try
  return "SWIFTY_OK"
end run
`.trim();

const WINDOWS_CLIPBOARD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 3 }
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $image) { exit 3 }
  $stream = New-Object System.IO.MemoryStream
  try {
    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
  } finally {
    $stream.Dispose()
    $image.Dispose()
  }
  exit 0
} catch [System.Runtime.InteropServices.ExternalException] {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 4
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 5
}
`.trim();

function failure(
  code: ClipboardErrorCode,
  message: string,
  installHint?: string,
): ClipboardFailure {
  return installHint
    ? { ok: false, error: { code, message, installHint } }
    : { ok: false, error: { code, message } };
}

function processErrorMessage(result: Extract<ClipboardProcessResult, { kind: "exit" }>): string {
  return result.stderr.trim() || `process exited with status ${String(result.code)}`;
}

function classifyProcessFailure(
  result: ClipboardProcessResult,
  backend: ClipboardBackend,
  options: {
    installHint?: string;
    noImageExitCodes?: readonly number[];
    busyExitCodes?: readonly number[];
  } = {},
): ClipboardFailure | null {
  switch (result.kind) {
    case "not_found":
      return failure(
        "tool_unavailable",
        `Clipboard helper ${backend} is not installed or not on PATH.`,
        options.installHint,
      );
    case "timeout":
      return failure("timeout", `Clipboard helper ${backend} timed out.`);
    case "output_limit":
      return failure(
        "output_too_large",
        `Clipboard helper ${backend} exceeded the configured stdout limit.`,
      );
    case "spawn_error":
      return failure(
        "command_failed",
        `Could not start clipboard helper ${backend}: ${result.message}`,
      );
    case "exit": {
      if (result.code === 0) {
        return null;
      }
      if (options.busyExitCodes?.includes(result.code)) {
        return failure("clipboard_busy", `The clipboard is busy or locked (${backend}).`);
      }

      const detail = processErrorMessage(result);
      const lowerDetail = detail.toLowerCase();
      if (
        lowerDetail.includes("permission denied") ||
        lowerDetail.includes("not authorized") ||
        lowerDetail.includes("access is denied")
      ) {
        return failure("permission_denied", `Clipboard access was denied (${backend}): ${detail}`);
      }
      if (options.noImageExitCodes?.includes(result.code)) {
        return failure("no_image", `The clipboard does not contain an image (${backend}).`);
      }
      if (
        lowerDetail.includes("no image") ||
        lowerDetail.includes("nothing is copied") ||
        lowerDetail.includes("target not available") ||
        lowerDetail.includes("selection does not exist")
      ) {
        return failure("no_image", `The clipboard does not contain an image (${backend}).`);
      }
      return failure("command_failed", `Clipboard helper ${backend} failed: ${detail}`);
    }
  }
}

function chooseFailure(failures: readonly ClipboardFailure[]): ClipboardFailure {
  const priority: readonly ClipboardErrorCode[] = [
    "image_too_large",
    "output_too_large",
    "timeout",
    "permission_denied",
    "clipboard_busy",
    "invalid",
    "command_failed",
    "no_image",
    "tool_unavailable",
    "unsupported",
  ];
  for (const code of priority) {
    const match = failures.find((item) => item.error.code === code);
    if (match) {
      return match;
    }
  }
  return failure("command_failed", "Clipboard image capture failed for an unknown reason.");
}

async function normalizeClipboardBytes(
  bytes: Buffer,
  backend: ClipboardBackend,
  mimeHint?: string,
): Promise<ClipboardImageResult> {
  try {
    const image = await loadImageBufferAttachment(bytes, { mimeHint });
    return { ok: true, image, backend };
  } catch (err) {
    if (err instanceof ImageTooLargeError) {
      return failure("image_too_large", err.message);
    }
    if (err instanceof InvalidImageError) {
      return failure("invalid", err.message);
    }
    return failure(
      "invalid",
      `Clipboard helper ${backend} returned image data that could not be decoded: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function loadMacClipboardFile(
  runtime: ClipboardRuntime,
  path: string,
  backend: ClipboardBackend,
  maxStdoutBytes: number,
): Promise<ClipboardImageResult> {
  try {
    const fileStat = await runtime.stat(path);
    if (!fileStat.isFile() || fileStat.size === 0) {
      return failure(
        "invalid",
        `Clipboard helper ${backend} did not produce a non-empty image file.`,
      );
    }
    if (fileStat.size > maxStdoutBytes) {
      return failure(
        "output_too_large",
        `Clipboard helper ${backend} produced ${String(fileStat.size)} bytes, above the ${String(maxStdoutBytes)}-byte limit.`,
      );
    }
    const bytes = await runtime.readFile(path);
    if (bytes.length > maxStdoutBytes) {
      return failure(
        "output_too_large",
        `Clipboard helper ${backend} produced more than ${String(maxStdoutBytes)} bytes.`,
      );
    }
    return await normalizeClipboardBytes(bytes, backend, "image/png");
  } catch (err) {
    return failure(
      "invalid",
      `Clipboard helper ${backend} did not produce a readable image: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function readMacClipboard(
  runtime: ClipboardRuntime,
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<ClipboardImageResult> {
  const failures: ClipboardFailure[] = [];
  let tempDirectory: string;
  try {
    tempDirectory = await runtime.mkdtemp(join(runtime.tmpdir(), "swifty-clipboard-"));
  } catch (err) {
    return failure(
      "command_failed",
      `Could not create a private clipboard directory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const scriptPath = join(tempDirectory, "capture.applescript");
  const imagePath = join(tempDirectory, "clipboard.png");
  try {
    try {
      await runtime.writeFile(scriptPath, MACOS_CLIPBOARD_SCRIPT);
      const result = await runtime.run({
        command: "/usr/bin/osascript",
        args: [scriptPath, imagePath],
        timeoutMs,
        maxStdoutBytes: MAX_CLIPBOARD_TYPE_LIST_BYTES,
      });
      const processFailure = classifyProcessFailure(result, "osascript");
      if (processFailure) {
        failures.push(processFailure);
      } else if (
        result.kind === "exit" &&
        result.stdout.toString("utf8").includes("SWIFTY_NO_IMAGE")
      ) {
        failures.push(failure("no_image", "The macOS clipboard does not contain an image."));
      } else {
        const loaded = await loadMacClipboardFile(runtime, imagePath, "osascript", maxStdoutBytes);
        if (loaded.ok) {
          return loaded;
        }
        failures.push(loaded);
      }
    } catch (err) {
      failures.push(
        failure(
          "command_failed",
          `Could not prepare the macOS clipboard helper: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    await runtime.remove(imagePath);
    const pngpasteResult = await runtime.run({
      command: "pngpaste",
      args: [imagePath],
      timeoutMs,
      maxStdoutBytes: MAX_CLIPBOARD_TYPE_LIST_BYTES,
    });
    const pngpasteFailure = classifyProcessFailure(pngpasteResult, "pngpaste", {
      installHint: "Install pngpaste with `brew install pngpaste`.",
      noImageExitCodes: [1],
    });
    if (pngpasteFailure) {
      failures.push(pngpasteFailure);
    } else {
      const loaded = await loadMacClipboardFile(runtime, imagePath, "pngpaste", maxStdoutBytes);
      if (loaded.ok) {
        return loaded;
      }
      failures.push(loaded);
    }

    return chooseFailure(failures);
  } finally {
    await runtime.remove(tempDirectory);
  }
}

const MIME_PREFERENCE = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-bmp",
  "image/x-ms-bmp",
  "image/tiff",
] as const;

function selectImageMime(stdout: Buffer): string | null {
  const advertisedTypes = stdout
    .toString("utf8")
    .split(/\r?\n/u)
    .map((type) => type.trim())
    .filter(Boolean);
  for (const preferred of MIME_PREFERENCE) {
    const match = advertisedTypes.find((type) => type.toLowerCase() === preferred);
    if (match) {
      return match;
    }
  }
  return null;
}

async function readLinuxTool(
  runtime: ClipboardRuntime,
  backend: Extract<ClipboardBackend, "wl-paste" | "xclip">,
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<ClipboardImageResult> {
  const isWayland = backend === "wl-paste";
  const installHint = isWayland
    ? "Install wl-clipboard (provides wl-paste)."
    : "Install xclip with your system package manager.";
  const listResult = await runtime.run({
    command: backend,
    args: isWayland ? ["--list-types"] : ["-selection", "clipboard", "-t", "TARGETS", "-o"],
    timeoutMs,
    maxStdoutBytes: MAX_CLIPBOARD_TYPE_LIST_BYTES,
  });
  const listFailure = classifyProcessFailure(listResult, backend, { installHint });
  if (listFailure) {
    return listFailure;
  }
  if (listResult.kind !== "exit") {
    return failure("command_failed", `Clipboard helper ${backend} did not return a MIME list.`);
  }

  const mime = selectImageMime(listResult.stdout);
  if (!mime) {
    return failure(
      "no_image",
      `The ${backend} clipboard does not advertise a supported image type.`,
    );
  }

  const imageResult = await runtime.run({
    command: backend,
    args: isWayland
      ? ["--no-newline", "--type", mime]
      : ["-selection", "clipboard", "-t", mime, "-o"],
    timeoutMs,
    maxStdoutBytes,
  });
  const imageFailure = classifyProcessFailure(imageResult, backend, { installHint });
  if (imageFailure) {
    return imageFailure;
  }
  if (imageResult.kind !== "exit" || imageResult.stdout.length === 0) {
    return failure("no_image", `The ${backend} clipboard returned no image bytes.`);
  }
  return normalizeClipboardBytes(imageResult.stdout, backend, mime);
}

async function readLinuxClipboard(
  runtime: ClipboardRuntime,
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<ClipboardImageResult> {
  const hasWayland = Boolean(runtime.env.WAYLAND_DISPLAY);
  const hasX11 = Boolean(runtime.env.DISPLAY);
  if (!hasWayland && !hasX11) {
    return failure(
      "tool_unavailable",
      "No Wayland or X11 clipboard session is available (WAYLAND_DISPLAY and DISPLAY are unset).",
    );
  }

  const backends: Extract<ClipboardBackend, "wl-paste" | "xclip">[] = [];
  if (hasWayland) {
    backends.push("wl-paste");
  }
  if (hasX11) {
    backends.push("xclip");
  }

  const failures: ClipboardFailure[] = [];
  for (const backend of backends) {
    const result = await readLinuxTool(runtime, backend, timeoutMs, maxStdoutBytes);
    if (result.ok) {
      return result;
    }
    failures.push(result);
  }
  return chooseFailure(failures);
}

async function readWindowsClipboard(
  runtime: ClipboardRuntime,
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<ClipboardImageResult> {
  const encodedScript = Buffer.from(WINDOWS_CLIPBOARD_SCRIPT, "utf16le").toString("base64");
  const helpers = [
    { backend: "powershell" as const, command: "powershell.exe" },
    { backend: "pwsh" as const, command: "pwsh" },
  ];
  const failures: ClipboardFailure[] = [];

  for (const helper of helpers) {
    const result = await runtime.run({
      command: helper.command,
      args: ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encodedScript],
      timeoutMs,
      maxStdoutBytes,
    });
    const processFailure = classifyProcessFailure(result, helper.backend, {
      installHint: "Enable Windows PowerShell or install PowerShell 7 (pwsh).",
      noImageExitCodes: [3],
      busyExitCodes: [4],
    });
    if (processFailure) {
      failures.push(processFailure);
      if (processFailure.error.code === "no_image") {
        return processFailure;
      }
      continue;
    }
    if (result.kind !== "exit" || result.stdout.length === 0) {
      failures.push(failure("no_image", "The Windows clipboard returned no image bytes."));
      continue;
    }
    const normalized = await normalizeClipboardBytes(result.stdout, helper.backend, "image/png");
    if (normalized.ok) {
      return normalized;
    }
    failures.push(normalized);
  }
  return chooseFailure(failures);
}

export const runClipboardProcess: ClipboardCommandRunner = (request) =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.command, [...request.args], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        kind: "spawn_error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let settled = false;
    let stdoutLength = 0;
    let stderrLength = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const finish = (result: ClipboardProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ kind: "timeout" });
    }, request.timeoutMs);

    if (!child.stdout || !child.stderr) {
      child.kill();
      finish({ kind: "spawn_error", message: "clipboard helper pipes were not created" });
      return;
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutLength += bytes.length;
      if (stdoutLength > request.maxStdoutBytes) {
        child.kill();
        finish({ kind: "output_limit" });
        return;
      }
      stdoutChunks.push(bytes);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      if (settled || stderrLength >= MAX_CLIPBOARD_STDERR_BYTES) {
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_CLIPBOARD_STDERR_BYTES - stderrLength;
      const retained = bytes.subarray(0, remaining);
      stderrLength += retained.length;
      stderrChunks.push(retained);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        err.code === "ENOENT"
          ? { kind: "not_found" }
          : { kind: "spawn_error", message: err.message },
      );
    });
    child.on("close", (code) => {
      finish({
        kind: "exit",
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks, stdoutLength),
        stderr: Buffer.concat(stderrChunks, stderrLength).toString("utf8"),
      });
    });
  });

const nodeRuntime: ClipboardRuntime = {
  platform: process.platform,
  env: process.env,
  run: runClipboardProcess,
  tmpdir: osTmpdir,
  mkdtemp: fsMkdtemp,
  writeFile: (path, data) => fsWriteFile(path, data, { mode: 0o600 }),
  readFile: fsReadFile,
  stat: fsStat,
  remove: (path) => fsRm(path, { recursive: true, force: true }),
};

export async function readClipboardImage(
  options: ReadClipboardImageOptions = {},
): Promise<ClipboardImageResult> {
  const runtime = options.runtime ?? nodeRuntime;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS;
  const maxStdoutBytes = options.maxStdoutBytes ?? MAX_CLIPBOARD_STDOUT_BYTES;

  try {
    switch (runtime.platform) {
      case "darwin":
        return await readMacClipboard(runtime, timeoutMs, maxStdoutBytes);
      case "linux":
        return await readLinuxClipboard(runtime, timeoutMs, maxStdoutBytes);
      case "win32":
        return await readWindowsClipboard(runtime, timeoutMs, maxStdoutBytes);
      default:
        return failure(
          "unsupported",
          `Clipboard image paste is not supported on platform ${runtime.platform}.`,
        );
    }
  } catch (err) {
    return failure(
      "command_failed",
      `Clipboard image capture failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
