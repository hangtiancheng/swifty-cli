/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
