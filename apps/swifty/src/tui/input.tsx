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

import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

import Fuse from "fuse.js";
import { Box, Text, useInput, usePaste, useStdout } from "ink";
import type { Key } from "ink";
import { useState, useMemo, useRef, useEffect } from "react";

import { createChildLogger } from "../logger/logger.js";

import { useInputDraft } from "./input-draft.js";
import type { InputDraft } from "./input-draft.js";
import { getListWindowStart } from "./list-window.js";
import { StatusBorder } from "./status-border.js";
import { ICONS, THEME } from "./styles.js";
import {
  clampToGraphemeBoundary,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
  truncateToWidth,
  visibleWidth,
} from "./terminal-text.js";

import type { Command } from "@/commands/commands.js";
import type { CommandUsageTracker } from "@/commands/usage-tracker.js";
import { saveClipboardImage } from "@/images/clipboard.js";
import type { PermissionMode } from "@/permissions/checker.js";
import { SKIP_DIRS } from "@/tools/types.js";

const log = createChildLogger({ module: "tui" });

// Suffix appended to skill-backed command descriptions (see wireSkillsToRegistry).
const SKILL_TAG = "[skill]";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function scanWorkdirFiles(root: string, max = 2000): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (out.length >= max) {
      return;
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      log.error({ err }, "tui operation failed");
      return;
    }
    for (const name of names) {
      if (out.length >= max) {
        return;
      }
      if (name.startsWith(".") || SKIP_DIRS.has(name)) {
        continue;
      }
      const full = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch (err) {
        log.error({ err }, "tui operation failed");
        continue;
      }
      if (isDir) {
        walk(full, relPath);
      } else {
        out.push(relPath);
      }
    }
  };
  walk(root, "");
  return out;
}

export type { InputDraft } from "./input-draft.js";

const MODEL_CYCLE: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  /** Blocks Enter-to-send while still allowing typing/editing (e.g. while
   *  the agent is streaming or the conversation is being compacted). */
  submitDisabled?: boolean;
  history?: string[];
  commands?: Command[];
  onEscape?: () => void;
  inputState?: "idle" | "focused" | "agent" | "error";
  borderColor?: string;
  statusLabel?: string;
  usageTracker?: CommandUsageTracker;
  permMode?: PermissionMode;
  onModeChange?: (mode: PermissionMode) => void;
  workDir?: string;
  sessionId?: string;
  /** Receives an insert-at-cursor function so the parent can inject text
   *  (e.g. IDE at-mentions) into the input programmatically. */
  insertTextRef?: { current: ((text: string) => void) | null };
  /** Receives a function that clears the input draft, so the parent can
   *  bind it to shortcuts handled outside this component (e.g. Ctrl+C). */
  clearRef?: { current: (() => void) | null };
  /** Owned by the dock so selectors can unmount the input without losing edits. */
  draftRef?: { current: InputDraft | null };
}

export function InputBox(props: InputBoxProps) {
  const {
    onSubmit,
    disabled,
    submitDisabled,
    history = [],
    commands = [],
    onEscape,
    inputState = "idle",
    borderColor: requestedBorderColor,
    statusLabel,
    usageTracker,
    permMode = "default",
    onModeChange,
    workDir = ".",
    sessionId = "default",
    insertTextRef,
    clearRef,
    draftRef,
  } = props;
  const { stdout } = useStdout();

  const {
    lines,
    setLines,
    cursorLine,
    setCursorLine,
    cursorCol,
    setCursorCol,
    historyIndex,
    setHistoryIndex,
    historyDraft,
    setHistoryDraft,
  } = useInputDraft(draftRef);
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);
  const [pasteError, setPasteError] = useState("");
  const [statusFrame, setStatusFrame] = useState(0);
  const pasteImageInflightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!statusLabel || inputState === "error") {
      return;
    }
    const timer = setInterval(() => {
      setStatusFrame((current) => (current + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => {
      clearInterval(timer);
    };
  }, [statusLabel, inputState]);

  useEffect(() => {
    if (!insertTextRef) {
      return;
    }
    insertTextRef.current = (text: string) => {
      const line = lines[cursorLine] ?? "";
      const col = Math.min(cursorCol, line.length);
      const before = line.slice(0, col);
      const pad = before.length > 0 && !/\s$/.test(before) ? " " : "";
      const inserted = pad + text;
      setLines((prev) => {
        const updated = [...prev];
        const l = updated[cursorLine] ?? "";
        updated[cursorLine] = l.slice(0, col) + inserted + l.slice(col);
        return updated;
      });
      setCursorCol(col + inserted.length);
    };
    return () => {
      insertTextRef.current = null;
    };
  }, [insertTextRef, lines, cursorLine, cursorCol, setLines, setCursorCol]);

  useEffect(() => {
    if (!clearRef) {
      return;
    }
    clearRef.current = () => {
      // While disabled (dialog overlay) the draft is hidden; leave it intact
      // so it reappears unchanged when the input re-enables.
      if (disabled) {
        return;
      }
      setLines([""]);
      setCursorLine(0);
      setCursorCol(0);
      setHistoryIndex(-1);
      setHistoryDraft(null);
      setDropdownIndex(0);
      setDropdownDismissed(false);
      setPasteError("");
    };
    return () => {
      clearRef.current = null;
    };
  }, [clearRef, disabled, setLines, setCursorLine, setCursorCol, setHistoryIndex, setHistoryDraft]);

  const isMultiline = lines.length > 1;

  const { filteredCmds, recentCount } = useMemo(() => {
    const first = lines[0];
    if (!first.startsWith("/") || isMultiline) {
      return { filteredCmds: [], recentCount: 0 };
    }
    const query = first.slice(1).toLowerCase();
    if (query.includes(" ")) {
      return { filteredCmds: [], recentCount: 0 };
    }
    if (!query) {
      if (!usageTracker) {
        return { filteredCmds: commands, recentCount: 0 };
      }
      const recentNames = new Set(usageTracker.getRecentlyUsed(5));
      const recent = commands.filter((c) => recentNames.has(c.name));
      const rest = commands.filter((c) => !recentNames.has(c.name));
      return { filteredCmds: [...recent, ...rest], recentCount: recent.length };
    }

    const seen = new Set<string>();
    const result: Command[] = [];
    const add = (cmd: Command) => {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    };

    // Tier 1: exact name
    for (const c of commands) {
      if (c.name.toLowerCase() === query) {
        add(c);
      }
    }
    // Tier 2: exact alias
    for (const c of commands) {
      if (c.aliases.some((a) => a.toLowerCase() === query)) {
        add(c);
      }
    }
    // Tier 3: prefix name
    for (const c of commands) {
      if (c.name.toLowerCase().startsWith(query)) {
        add(c);
      }
    }
    // Tier 4: prefix alias
    for (const c of commands) {
      if (c.aliases.some((a) => a.toLowerCase().startsWith(query))) {
        add(c);
      }
    }
    // Tier 5: fuzzy match
    const fuse = new Fuse(commands, {
      keys: [
        { name: "name", weight: 3 },
        { name: "aliases", weight: 2 },
        { name: "description", weight: 0.5 },
      ],
      threshold: 0.4,
      includeScore: true,
    });

    for (const r of fuse.search(query)) {
      add(r.item);
    }

    return { filteredCmds: result, recentCount: 0 };
  }, [lines, commands, isMultiline, usageTracker]);

  const showDropdown =
    filteredCmds.length > 0 &&
    lines[0].startsWith("/") &&
    !isMultiline &&
    !dropdownDismissed &&
    historyIndex < 0;
  const commandWindowStart = getListWindowStart(filteredCmds.length, dropdownIndex, 8);
  const visibleCommands = filteredCmds.slice(commandWindowStart, commandWindowStart + 8);

  // @-file-mention autocomplete: active when the text before the caret ends with an
  // @<partial> token (and we're not typing a slash command).
  const fileCacheRef = useRef<string[] | null>(null);

  const atQuery = useMemo(() => {
    if (lines[0].startsWith("/")) {
      return null;
    }
    const line = (lines[cursorLine] ?? "").slice(0, cursorCol);
    const m = /(?:^|\s)@([^\s]*)$/.exec(line);
    return m ? m[1] : null;
  }, [lines, cursorLine, cursorCol]);

  const filteredFiles = useMemo(() => {
    if (atQuery === null) {
      return [];
    }

    // if (fileCacheRef.current === null) {
    //   fileCacheRef.current = scanWorkdirFiles(workDir);
    // }

    // Prefer using nullish coalescing operator (`??=`) instead of an assignment expression, as it is simpler to read.
    fileCacheRef.current ??= scanWorkdirFiles(workDir);

    const files = fileCacheRef.current;
    const q = atQuery.toLowerCase();
    if (!q) {
      return files.slice(0, 8);
    }
    const pre = files.filter((f) => f.toLowerCase().startsWith(q));
    const sub = files.filter((f) => !f.toLowerCase().startsWith(q) && f.toLowerCase().includes(q));
    return [...pre, ...sub].slice(0, 8);
  }, [atQuery, workDir]);

  const showAtDropdown =
    !disabled &&
    !dropdownDismissed &&
    !showDropdown &&
    atQuery !== null &&
    filteredFiles.length > 0;

  const completeAt = (path: string) => {
    const line = lines[cursorLine] ?? "";
    const before = line.slice(0, cursorCol).replace(/@([^\s]*)$/, () => `@${path}`);
    const after = line.slice(cursorCol).replace(/^\S*/, "");
    const separator = after.startsWith(" ") ? "" : " ";
    const newLine = before + separator + after;
    setLines((prev) => {
      const u = [...prev];
      u[cursorLine] = newLine;
      return u;
    });
    setCursorCol(before.length + 1);
    setDropdownIndex(0);
  };

  const insertPastedText = (rawText: string) => {
    const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized) {
      return;
    }
    const pasteLines = normalized.split("\n");
    const cl = cursorLine;
    const col = Math.min(cursorCol, (lines[cl] ?? "").length);
    const lastLen = pasteLines[pasteLines.length - 1].length;
    setLines((prev) => {
      const updated = [...prev];
      const line = updated[cl] ?? "";
      const segments = [...pasteLines];
      segments[0] = line.slice(0, col) + segments[0];
      segments[segments.length - 1] = segments[segments.length - 1] + line.slice(col);
      updated.splice(cl, 1, ...segments);
      return updated;
    });
    setCursorLine(cl + pasteLines.length - 1);
    setCursorCol(pasteLines.length === 1 ? col + lastLen : lastLen);
    setDropdownIndex(0);
    setDropdownDismissed(false);
  };

  // Save the clipboard image under the session's file-history dir and insert
  // a workDir-relative @ mention; on submit, at-expansion inlines it as an
  // image content block like any other @image reference.
  const pasteImageFromClipboard = async () => {
    if (disabled || pasteImageInflightRef.current) {
      return;
    }
    pasteImageInflightRef.current = true;
    setPasteError("");
    try {
      const result = await saveClipboardImage(workDir, sessionId);
      if (!mountedRef.current) {
        return;
      }
      if (result.ok) {
        // The @ ref only expands when preceded by start-of-text or whitespace.
        const line = lines[cursorLine] ?? "";
        const before = line.slice(0, Math.min(cursorCol, line.length));
        const pad = before.length > 0 && !/\s$/.test(before) ? " " : "";
        insertPastedText(`${pad}'@${relative(workDir, result.value)}' `);
      } else {
        setPasteError(result.reason);
      }
    } catch (err) {
      log.error({ err }, "clipboard image paste failed");
      setPasteError("Could not read an image from the clipboard.");
    } finally {
      pasteImageInflightRef.current = false;
    }
  };

  usePaste(
    (text) => {
      if (text.length > 0) {
        insertPastedText(text);
      } else {
        void pasteImageFromClipboard();
      }
    },
    { isActive: !disabled },
  );

  const handleInput = (input: string, key: Key) => {
    if (input.includes("[<") && /\[<\d+;\d+;\d+[Mm]/.test(input)) {
      return;
    }

    // Escape: key.escape or raw \x1b byte (tmux compat)
    if (key.escape || input === "\x1b") {
      if (showDropdown || showAtDropdown) {
        setDropdownDismissed(true);
        setDropdownIndex(0);
        return;
      }
      onEscape?.();
      return;
    }

    if (disabled) {
      return;
    }

    // Ctrl+V pastes a clipboard image (Alt+V on Windows, where terminals
    // reserve Ctrl+V for text paste).
    if (input === "v" && (process.platform === "win32" ? key.meta : key.ctrl)) {
      void pasteImageFromClipboard();
      return;
    }

    const hasLineBreak = input.includes("\r") || input.includes("\n");
    const hasReturn = key.return || hasLineBreak;
    const cleanInput = input.replace(/[\r\n]/g, "");

    // A chunk containing line breaks plus other content is a paste, not an Enter
    // press (Enter arrives as a lone "\r", "\n", or "\r\n"). Insert it as multi-line text
    // at the cursor instead of submitting.
    const isLoneEnter = input === "\r" || input === "\n" || input === "\r\n";
    if (hasLineBreak && !isLoneEnter) {
      insertPastedText(input);
      return;
    }

    // Shift+Enter or Ctrl+J → newline
    if (hasReturn && (key.shift || (key.ctrl && input === "\n"))) {
      const line = lines[cursorLine] ?? "";

      setLines((prev) => {
        const updated = [...prev];
        updated[cursorLine] = line.slice(0, cursorCol);
        updated.splice(cursorLine + 1, 0, line.slice(cursorCol));
        return updated;
      });
      setCursorLine(cursorLine + 1);
      setCursorCol(0);
      return;
    }

    if (hasReturn) {
      if (showAtDropdown && filteredFiles[dropdownIndex]) {
        completeAt(filteredFiles[dropdownIndex]);
        return;
      }
      if (showDropdown && filteredCmds.length > 0 && dropdownIndex < filteredCmds.length) {
        const selected = filteredCmds.at(dropdownIndex);
        if (selected) {
          const newLine = "/" + selected.name + " ";
          setLines([newLine]);
          setCursorLine(0);
          setCursorCol(newLine.length);
          setDropdownIndex(0);
          return;
        }
      }

      const line = lines[cursorLine] ?? "";
      const finalLine = cleanInput
        ? line.slice(0, cursorCol) + cleanInput + line.slice(cursorCol)
        : line;
      const updated = [...lines];
      updated[cursorLine] = finalLine;
      const finalValue = updated.join("\n").trim();
      if (finalValue) {
        // Sending is locked (agent streaming / compacting): keep the draft
        // instead of submitting, so nothing is silently dropped.
        if (submitDisabled) {
          return;
        }
        onSubmit(finalValue);
        setLines([""]);
        setCursorLine(0);
        setCursorCol(0);
        setHistoryIndex(-1);
        setHistoryDraft(null);
        setDropdownIndex(0);
        setDropdownDismissed(false);
        setPasteError("");
      }
      return;
    }

    if ((input === "\x1b[Z" || (key.tab && key.shift)) && onModeChange) {
      const idx = MODEL_CYCLE.indexOf(permMode);
      const next = MODEL_CYCLE[(idx + 1) % MODEL_CYCLE.length];
      onModeChange(next);
      return;
    }

    if (key.tab && showAtDropdown && filteredFiles[dropdownIndex]) {
      completeAt(filteredFiles[dropdownIndex]);
      return;
    }

    if (key.tab && lines[0].startsWith("/") && filteredCmds.length > 0) {
      const selected = filteredCmds.at(dropdownIndex);
      if (selected) {
        const newLine = "/" + selected.name + " ";
        setLines([newLine]);
        setCursorLine(0);
        setCursorCol(newLine.length);
        setDropdownIndex(0);
      }
      return;
    }

    if (key.ctrl && input === "a") {
      setCursorCol(0);
      return;
    }
    if (key.ctrl && input === "e") {
      setCursorCol((lines[cursorLine] ?? "").length);
      return;
    }

    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(previousGraphemeBoundary(lines[cursorLine] ?? "", cursorCol));
      } else if (isMultiline && cursorLine > 0) {
        setCursorLine(cursorLine - 1);
        setCursorCol((lines[cursorLine - 1] ?? "").length);
      }
      return;
    }

    if (key.rightArrow) {
      const lineLen = (lines[cursorLine] ?? "").length;
      if (cursorCol < lineLen) {
        setCursorCol(nextGraphemeBoundary(lines[cursorLine] ?? "", cursorCol));
      } else if (isMultiline && cursorLine < lines.length - 1) {
        setCursorLine(cursorLine + 1);
        setCursorCol(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      const line = lines[cursorLine] ?? "";
      if (key.delete && cursorCol < line.length) {
        const nextCol = nextGraphemeBoundary(line, cursorCol);
        setLines((prev) => {
          const updated = [...prev];
          const current = updated[cursorLine] ?? "";
          updated[cursorLine] = current.slice(0, cursorCol) + current.slice(nextCol);
          return updated;
        });
      } else if (key.backspace && cursorCol > 0) {
        const previousCol = previousGraphemeBoundary(line, cursorCol);
        setLines((prev) => {
          const updated = [...prev];
          const l = updated[cursorLine] ?? "";
          updated[cursorLine] = l.slice(0, previousCol) + l.slice(cursorCol);
          return updated;
        });
        setCursorCol(previousCol);
      } else if (key.backspace && cursorLine > 0) {
        const prevLen = (lines[cursorLine - 1] ?? "").length;
        const cl = cursorLine;
        setLines((prev) => {
          const updated = [...prev];
          updated[cl - 1] = (updated[cl - 1] ?? "") + (updated[cl] ?? "");
          updated.splice(cl, 1);
          return updated;
        });
        setCursorLine(cl - 1);
        setCursorCol(prevLen);
      } else if (key.delete && cursorLine < lines.length - 1) {
        const cl = cursorLine;
        setLines((prev) => {
          const updated = [...prev];
          updated[cl] = (updated[cl] ?? "") + (updated[cl + 1] ?? "");
          updated.splice(cl + 1, 1);
          return updated;
        });
      }
      return;
    }

    if (key.upArrow) {
      if (showAtDropdown) {
        setDropdownIndex((i) => (i > 0 ? i - 1 : filteredFiles.length - 1));
        return;
      }
      if (showDropdown) {
        setDropdownIndex((i) => (i > 0 ? i - 1 : filteredCmds.length - 1));
        return;
      }
      if (isMultiline && cursorLine > 0) {
        const targetLine = lines[cursorLine - 1] ?? "";
        setCursorLine(cursorLine - 1);
        setCursorCol(clampToGraphemeBoundary(targetLine, Math.min(cursorCol, targetLine.length)));
        return;
      }
      if (!isMultiline && history.length > 0) {
        if (historyIndex === -1) {
          setHistoryDraft({
            lines: [...lines],
            cursorLine,
            cursorCol,
          });
        }
        const nextIdx = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(nextIdx);
        const entry = history[history.length - 1 - nextIdx] ?? "";
        const entryLines = entry.split("\n");
        setLines(entryLines);
        setCursorLine(0);
        setCursorCol(entryLines[0].length);
        return;
      }
      return;
    }

    if (key.downArrow) {
      if (showAtDropdown) {
        setDropdownIndex((i) => (i < filteredFiles.length - 1 ? i + 1 : 0));
        return;
      }
      if (showDropdown) {
        setDropdownIndex((i) => (i < filteredCmds.length - 1 ? i + 1 : 0));
        return;
      }
      if (isMultiline && cursorLine < lines.length - 1) {
        const targetLine = lines[cursorLine + 1] ?? "";
        setCursorLine(cursorLine + 1);
        setCursorCol(clampToGraphemeBoundary(targetLine, Math.min(cursorCol, targetLine.length)));
        return;
      }
      if (!isMultiline) {
        if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          const entry = history[history.length - 1 - nextIdx] ?? "";
          const entryLines = entry.split("\n");
          setLines(entryLines);
          setCursorLine(0);
          setCursorCol(entryLines[0].length);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          const draft = historyDraft;
          setHistoryDraft(null);
          if (draft) {
            setLines(draft.lines);
            setCursorLine(draft.cursorLine);
            setCursorCol(draft.cursorCol);
          } else {
            setLines([""]);
            setCursorLine(0);
            setCursorCol(0);
          }
        }
      }
      return;
    }

    if (cleanInput && !key.ctrl && !key.meta) {
      const col = cursorCol;
      setLines((prev) => {
        const updated = [...prev];
        const line = updated[cursorLine] ?? "";
        updated[cursorLine] = line.slice(0, col) + cleanInput + line.slice(col);
        return updated;
      });
      setCursorCol(col + cleanInput.length);
      setDropdownIndex(0);
      setDropdownDismissed(false);
    }
  };
  useInput(handleInput, { isActive: !disabled });

  const borderColor =
    requestedBorderColor ??
    (inputState === "error"
      ? THEME.error
      : inputState === "idle"
        ? THEME.borderMuted
        : THEME.thinkingHigh);
  const borderWidth = Math.max(1, stdout.columns || 80);
  const horizontalPadding = borderWidth > 2 ? 1 : 0;
  const rowWidth = borderWidth - horizontalPadding * 2;
  const maxVisibleLines = Math.max(5, Math.floor((stdout.rows || 24) * 0.3));
  const visibleStart = Math.max(
    0,
    Math.min(cursorLine - Math.floor(maxVisibleLines / 2), lines.length - maxVisibleLines),
  );
  const visibleLines = lines.slice(visibleStart, visibleStart + maxVisibleLines);
  const hiddenAbove = visibleStart;
  const hiddenBelow = Math.max(0, lines.length - visibleStart - visibleLines.length);
  const spinner = SPINNER_FRAMES[statusFrame] ?? SPINNER_FRAMES[0];

  const ghostText = useMemo(() => {
    if (isMultiline || !lines[0].startsWith("/") || lines[0].length <= 1) {
      return "";
    }
    const typed = lines[0].slice(1).toLowerCase();
    const best = filteredCmds.at(0);
    // filteredCmds may be empty when the typed slash command doesn't match
    // any registered command (e.g. /some-slash-command-name). Guard against
    // undefined before accessing .name — mirrors the filteredCmds.length > 0
    // checks used by the dropdown rendering below.
    if (!best?.name.toLowerCase().startsWith(typed)) {
      return "";
    }
    return best.name.slice(typed.length);
  }, [lines, filteredCmds, isMultiline]);

  return (
    <Box flexDirection="column" width={borderWidth}>
      <StatusBorder
        width={borderWidth}
        color={borderColor}
        statusLabel={statusLabel}
        spinner={inputState === "error" ? "!" : spinner}
        hiddenLineCount={hiddenAbove}
      />
      <Box paddingLeft={horizontalPadding} paddingRight={horizontalPadding}>
        <Text>
          {disabled ? (
            <Text color={THEME.muted}>Waiting...</Text>
          ) : (
            <>
              {visibleLines.map((line, visibleIndex) => {
                const lineIndex = visibleStart + visibleIndex;
                const prefix = visibleIndex > 0 ? "\n" : "";
                if (lineIndex === cursorLine) {
                  const col = Math.min(cursorCol, line.length);
                  const before = line.slice(0, col);
                  const nextCol = nextGraphemeBoundary(line, col);
                  const atChar = col < line.length ? line.slice(col, nextCol) : " ";
                  const after = col < line.length ? line.slice(nextCol) : "";
                  const atEnd = col >= line.length;
                  return (
                    <Text key={lineIndex}>
                      {prefix}
                      {before}
                      <Text inverse>{atChar}</Text>
                      {after}
                      {atEnd && lineIndex === 0 && ghostText ? (
                        <Text color={THEME.dim}>{ghostText}</Text>
                      ) : null}
                    </Text>
                  );
                }
                return (
                  <Text key={lineIndex}>
                    {prefix}
                    {line}
                  </Text>
                );
              })}
            </>
          )}
        </Text>
      </Box>
      <StatusBorder
        width={borderWidth}
        color={borderColor}
        hiddenLineCount={hiddenBelow}
        direction="down"
      />
      {!disabled && pasteError && (
        <Box paddingLeft={2}>
          <Text color={THEME.error}>Error: {pasteError}</Text>
        </Box>
      )}
      {showDropdown && (
        <Box flexDirection="column">
          <Text color={THEME.dim} wrap="truncate-end">
            {recentCount > 0 && commandWindowStart === 0 ? "RECENTLY USED" : "COMMANDS"}
            {filteredCmds.length > 8
              ? ` (${String(dropdownIndex + 1)}/${String(filteredCmds.length)})`
              : ""}
          </Text>
          {visibleCommands.map((cmd, visibleIndex) => {
            const selected = commandWindowStart + visibleIndex === dropdownIndex;
            const desc = cmd.description.replace(/\s+/g, " ").trim();
            const isSkill = desc.endsWith(SKILL_TAG);
            const body = isSkill ? desc.slice(0, -SKILL_TAG.length).trimEnd() : desc;
            const label = truncateToWidth(`${selected ? ICONS.arrow : " "} /${cmd.name}`, rowWidth);
            const descriptionWidth =
              rowWidth - visibleWidth(label) - 1 - (isSkill ? visibleWidth(SKILL_TAG) + 1 : 0);
            const showDescription = borderWidth >= 60 && descriptionWidth >= 10;
            return (
              <Box
                key={cmd.name}
                backgroundColor={selected ? THEME.selectedBg : undefined}
                paddingLeft={horizontalPadding}
                paddingRight={horizontalPadding}
                width="100%"
              >
                <Text wrap="truncate-end" color={selected ? THEME.accent : THEME.muted}>
                  {label}
                  {showDescription && ` ${truncateToWidth(body, descriptionWidth)}`}
                  {showDescription && isSkill && (
                    <Text color={selected ? THEME.accent : THEME.dim}> {SKILL_TAG}</Text>
                  )}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {showAtDropdown && (
        <Box flexDirection="column">
          <Text color={THEME.dim} wrap="truncate-end">
            {"FILES"}
          </Text>
          {filteredFiles.map((file, i) => (
            <Box
              key={file}
              backgroundColor={i === dropdownIndex ? THEME.selectedBg : undefined}
              paddingLeft={horizontalPadding}
              paddingRight={horizontalPadding}
              width="100%"
            >
              <Text color={i === dropdownIndex ? THEME.accent : THEME.muted} wrap="truncate-end">
                {truncateToWidth(`${i === dropdownIndex ? ICONS.arrow : " "} @${file}`, rowWidth)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
