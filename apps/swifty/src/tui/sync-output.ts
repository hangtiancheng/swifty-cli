const BSU = "\x1b[?2026h"; // Begin Synchronized Update
const ESU = "\x1b[?2026l"; // End Synchronized Update

/**
 * Detects whether the current terminal supports DEC 2026 synchronized output.
 */
function isSyncOutputSupported(): boolean {
  if (process.env.TMUX) {
    return false;
  }

  const termProgram = process.env.TERM_PROGRAM;
  const term = process.env.TERM;

  if (
    termProgram === "iTerm.app" ||
    termProgram === "WezTerm" ||
    termProgram === "WarpTerminal" ||
    termProgram === "ghostty" ||
    termProgram === "contour" ||
    termProgram === "vscode" ||
    termProgram === "alacritty"
  ) {
    return true;
  }

  if (term?.includes("kitty") || process.env.KITTY_WINDOW_ID) {
    return true;
  }
  if (term === "xterm-ghostty") {
    return true;
  }
  if (term?.startsWith("foot")) {
    return true;
  }
  if (term?.includes("alacritty")) {
    return true;
  }
  if (process.env.ZED_TERM) {
    return true;
  }
  if (process.env.WT_SESSION) {
    return true;
  }

  const vteVersion = process.env.VTE_VERSION;
  if (vteVersion) {
    const version = parseInt(vteVersion, 10);
    if (version >= 6800) {
      return true;
    }
  }

  return false;
}

/**
 * Installs synchronized output by monkey-patching process.stdout.write.
 * Uses queueMicrotask to batch all writes within the same synchronous frame
 * into a single BSU/ESU-wrapped write.
 *
 * Ink's onRender is synchronous: multiple stdout.write calls within it occur
 * in the same microtask and are naturally coalesced into a single BSU...ESU envelope.
 */
export function installSyncOutput(): void {
  if (!isSyncOutputSupported()) {
    return;
  }

  const originalWrite: typeof process.stdout.write = process.stdout.write.bind(process.stdout);
  let frameBuffer = "";
  let scheduled = false;

  process.stdout.write = function (
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void,
  ): boolean {
    const str =
      typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    frameBuffer += str;

    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        const data = BSU + frameBuffer + ESU;
        frameBuffer = "";
        scheduled = false;
        originalWrite(data);
      });
    }

    if (typeof encodingOrCallback === "function") {
      encodingOrCallback();
    } else if (typeof callback === "function") {
      callback();
    }

    return true;
  };
}
