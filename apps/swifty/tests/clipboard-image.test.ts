import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_CLIPBOARD_TIMEOUT_MS,
  MAX_CLIPBOARD_STDOUT_BYTES,
  readClipboardImage,
  runClipboardProcess,
  type ClipboardCommandRunner,
  type ClipboardProcessRequest,
  type ClipboardRuntime,
} from "@/images/clipboard.js";
import { sniffMediaType } from "@/images/image.js";

let png: Buffer;
let tiff: Buffer;
let oversizedPng: Buffer;
let oversizedTiff: Buffer;

beforeAll(async () => {
  const source = sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 },
    },
  });
  [png, tiff, oversizedPng, oversizedTiff] = await Promise.all([
    source.clone().png().toBuffer(),
    source.clone().tiff().toBuffer(),
    sharp({
      create: {
        width: 2_001,
        height: 1,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 1 },
      },
    })
      .png()
      .toBuffer(),
    sharp({
      create: {
        width: 2_001,
        height: 1,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 1 },
      },
    })
      .tiff()
      .toBuffer(),
  ]);
});

function createRuntime(
  platform: NodeJS.Platform,
  run: ClipboardCommandRunner,
  env: Readonly<NodeJS.ProcessEnv> = {},
  onTemporaryDirectory?: (path: string) => void,
): ClipboardRuntime {
  return {
    platform,
    env,
    run,
    tmpdir,
    mkdtemp: async (prefix) => {
      const path = await mkdtemp(prefix);
      onTemporaryDirectory?.(path);
      return path;
    },
    writeFile: (path, data) => writeFile(path, data, { mode: 0o600 }),
    readFile,
    stat,
    remove: (path) => rm(path, { recursive: true, force: true }),
  };
}

function exit(stdout: Buffer | string, code = 0, stderr = "") {
  return {
    kind: "exit" as const,
    code,
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stderr,
  };
}

function requireArgument(request: ClipboardProcessRequest, index: number): string {
  const argument = request.args.at(index);
  if (argument === undefined) {
    throw new Error(`Expected argument ${String(index)} for ${request.command}`);
  }
  return argument;
}

describe("macOS clipboard image", () => {
  it("passes unique file paths as argv and always removes private temporary directories", async () => {
    const temporaryDirectories: string[] = [];
    const requests: ClipboardProcessRequest[] = [];
    const scripts: string[] = [];
    const run: ClipboardCommandRunner = async (request) => {
      requests.push(request);
      expect(request.command).toBe("/usr/bin/osascript");
      const scriptPath = requireArgument(request, 0);
      const imagePath = requireArgument(request, 1);
      scripts.push(await readFile(scriptPath, "utf8"));
      await writeFile(imagePath, png);
      return exit("SWIFTY_OK\n");
    };
    const runtime = createRuntime("darwin", run, {}, (path) => temporaryDirectories.push(path));

    const [first, second] = await Promise.all([
      readClipboardImage({ runtime }),
      readClipboardImage({ runtime }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("Expected both clipboard reads to succeed");
    }
    expect(first.backend).toBe("osascript");
    expect(second.backend).toBe("osascript");
    expect(first.image.data).toBe(png.toString("base64"));
    expect(temporaryDirectories).toHaveLength(2);
    expect(new Set(temporaryDirectories).size).toBe(2);
    expect(requests.every((request) => request.timeoutMs === DEFAULT_CLIPBOARD_TIMEOUT_MS)).toBe(
      true,
    );
    for (const [index, script] of scripts.entries()) {
      expect(script).toContain("on run argv");
      expect(script).not.toContain(requireArgument(requests[index], 1));
    }
    for (const directory of temporaryDirectories) {
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("falls back from osascript to pngpaste", async () => {
    const commands: string[] = [];
    const run: ClipboardCommandRunner = async (request) => {
      commands.push(request.command);
      if (request.command === "/usr/bin/osascript") {
        return { kind: "not_found" };
      }
      expect(request.command).toBe("pngpaste");
      await writeFile(requireArgument(request, 0), png);
      return exit("");
    };

    const result = await readClipboardImage({ runtime: createRuntime("darwin", run) });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.backend).toBe("pngpaste");
    expect(commands).toEqual(["/usr/bin/osascript", "pngpaste"]);
  });

  it("maps timeout and still cleans the temporary directory", async () => {
    const temporaryDirectories: string[] = [];
    const run: ClipboardCommandRunner = (request) =>
      Promise.resolve(
        request.command === "/usr/bin/osascript" ? { kind: "timeout" } : { kind: "not_found" },
      );
    const runtime = createRuntime("darwin", run, {}, (path) => temporaryDirectories.push(path));

    const result = await readClipboardImage({ runtime });

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    await expect(stat(temporaryDirectories[0])).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Linux clipboard image", () => {
  it("reads binary Wayland clipboard data using the advertised MIME type", async () => {
    const requests: ClipboardProcessRequest[] = [];
    const run: ClipboardCommandRunner = (request) => {
      requests.push(request);
      return Promise.resolve(
        request.args.includes("--list-types") ? exit("text/plain\nimage/png\n") : exit(png),
      );
    };

    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, { WAYLAND_DISPLAY: "wayland-0" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.backend).toBe("wl-paste");
    expect(result.image.data).toBe(png.toString("base64"));
    expect(requests.map(({ command, args }) => [command, args])).toEqual([
      ["wl-paste", ["--list-types"]],
      ["wl-paste", ["--no-newline", "--type", "image/png"]],
    ]);
    expect(requests[1]?.maxStdoutBytes).toBe(MAX_CLIPBOARD_STDOUT_BYTES);
  });

  it("falls back from Wayland to X11 and normalizes TIFF to PNG", async () => {
    const requests: ClipboardProcessRequest[] = [];
    const run: ClipboardCommandRunner = (request) => {
      requests.push(request);
      if (request.command === "wl-paste") {
        return Promise.resolve({ kind: "not_found" });
      }
      return Promise.resolve(request.args.includes("TARGETS") ? exit("image/tiff\n") : exit(tiff));
    };

    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, {
        WAYLAND_DISPLAY: "wayland-0",
        DISPLAY: ":0",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.backend).toBe("xclip");
    expect(result.image.mediaType).toBe("image/png");
    expect(sniffMediaType(Buffer.from(result.image.data, "base64"))).toBe("image/png");
    expect(requests.map(({ command }) => command)).toEqual(["wl-paste", "xclip", "xclip"]);
    expect(requests[2]?.args).toEqual(["-selection", "clipboard", "-t", "image/tiff", "-o"]);
  });

  it("returns no_image when no supported image MIME is advertised", async () => {
    const run: ClipboardCommandRunner = () => Promise.resolve(exit("text/plain\ntext/html\n"));
    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, { WAYLAND_DISPLAY: "wayland-0" }),
    });

    expect(result).toMatchObject({ ok: false, error: { code: "no_image" } });
  });

  it("returns tool_unavailable when all session helpers are missing", async () => {
    const run: ClipboardCommandRunner = () => Promise.resolve({ kind: "not_found" });
    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing Linux clipboard helpers to fail");
    }
    expect(result.error.code).toBe("tool_unavailable");
    expect(result.error.installHint).toContain("wl-clipboard");
  });

  it("does not spawn a helper without a Wayland or X11 session", async () => {
    let calls = 0;
    const run: ClipboardCommandRunner = () => {
      calls += 1;
      return Promise.resolve({ kind: "not_found" });
    };

    const result = await readClipboardImage({ runtime: createRuntime("linux", run) });

    expect(result).toMatchObject({ ok: false, error: { code: "tool_unavailable" } });
    expect(calls).toBe(0);
  });

  it("returns invalid for non-image bytes from a clipboard helper", async () => {
    const run: ClipboardCommandRunner = (request) =>
      Promise.resolve(
        request.args.includes("--list-types") ? exit("image/png\n") : exit("not an image"),
      );

    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, { WAYLAND_DISPLAY: "wayland-0" }),
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("rejects a truncated image that only has valid magic bytes", async () => {
    const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const run: ClipboardCommandRunner = (request) =>
      Promise.resolve(
        request.args.includes("--list-types") ? exit("image/png\n") : exit(truncatedPng),
      );

    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, { WAYLAND_DISPLAY: "wayland-0" }),
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("resizes a highly compressed clipboard image that exceeds the dimension limit", async () => {
    const run: ClipboardCommandRunner = (request) =>
      Promise.resolve(
        request.args.includes("--list-types") ? exit("image/png\n") : exit(oversizedPng),
      );

    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, { WAYLAND_DISPLAY: "wayland-0" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const metadata = await sharp(Buffer.from(result.image.data, "base64")).metadata();
    expect(metadata.width).toBe(2_000);
    expect(metadata.height).toBe(1);
  });

  it("resizes TIFF before normalizing it to PNG", async () => {
    const run: ClipboardCommandRunner = (request) =>
      Promise.resolve(
        request.args.includes("--list-types") ? exit("image/tiff\n") : exit(oversizedTiff),
      );

    const result = await readClipboardImage({
      runtime: createRuntime("linux", run, { WAYLAND_DISPLAY: "wayland-0" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.image.mediaType).toBe("image/png");
    const metadata = await sharp(Buffer.from(result.image.data, "base64")).metadata();
    expect(metadata.width).toBe(2_000);
    expect(metadata.height).toBe(1);
  });
});

describe("Windows clipboard image", () => {
  it("falls back to pwsh and uses a static STA encoded command", async () => {
    const requests: ClipboardProcessRequest[] = [];
    const run: ClipboardCommandRunner = (request) => {
      requests.push(request);
      return Promise.resolve(
        request.command === "powershell.exe" ? { kind: "not_found" } : exit(png),
      );
    };

    const result = await readClipboardImage({ runtime: createRuntime("win32", run) });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.backend).toBe("pwsh");
    expect(requests.map(({ command }) => command)).toEqual(["powershell.exe", "pwsh"]);
    for (const request of requests) {
      expect(request.args.slice(0, 4)).toEqual([
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-EncodedCommand",
      ]);
      const encodedCommand = requireArgument(request, 4);
      const script = Buffer.from(encodedCommand, "base64").toString("utf16le");
      expect(script).toContain("[System.Windows.Forms.Clipboard]::GetImage()");
      expect(script).toContain("[Console]::OpenStandardOutput()");
    }
  });

  it("maps the PowerShell no-image status without trying another shell", async () => {
    let calls = 0;
    const run: ClipboardCommandRunner = () => {
      calls += 1;
      return Promise.resolve(exit("", 3));
    };

    const result = await readClipboardImage({ runtime: createRuntime("win32", run) });

    expect(result).toMatchObject({ ok: false, error: { code: "no_image" } });
    expect(calls).toBe(1);
  });

  it("maps the PowerShell clipboard lock status", async () => {
    const run: ClipboardCommandRunner = () => Promise.resolve(exit("", 4, "OpenClipboard failed"));
    const result = await readClipboardImage({ runtime: createRuntime("win32", run) });

    expect(result).toMatchObject({ ok: false, error: { code: "clipboard_busy" } });
  });
});

describe("process and platform safety", () => {
  it("passes metacharacters literally because the command runner does not use a shell", async () => {
    const literal = "$(printf injected); & |";
    const result = await runClipboardProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", literal],
      timeoutMs: DEFAULT_CLIPBOARD_TIMEOUT_MS,
      maxStdoutBytes: 1_024,
    });

    expect(result).toMatchObject({ kind: "exit", code: 0, stdout: Buffer.from(literal) });
  });

  it("enforces timeout and stdout limits", async () => {
    const timedOut = await runClipboardProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 20,
      maxStdoutBytes: 1_024,
    });
    const tooLarge = await runClipboardProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(2048))"],
      timeoutMs: DEFAULT_CLIPBOARD_TIMEOUT_MS,
      maxStdoutBytes: 1_024,
    });

    expect(timedOut).toEqual({ kind: "timeout" });
    expect(tooLarge).toEqual({ kind: "output_limit" });
  });

  it("returns unsupported for other platforms without starting a process", async () => {
    let calls = 0;
    const run: ClipboardCommandRunner = () => {
      calls += 1;
      return Promise.resolve({ kind: "not_found" });
    };
    const runtime = createRuntime("aix", run);

    const result = await readClipboardImage({ runtime });

    expect(result).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(calls).toBe(0);
  });
});
