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

// InputBox: multi-line editor with slash command completion, @file mentions,
// ghost text, history navigation, and permission mode cycling.
import { scanWorkdirFiles } from "./at-expand.js";
import { Box, Text, useInput } from "ink";
import { useState, useMemo, useRef } from "react";
import { BORDER_COLORS, COLORS, ICONS } from "./styles.js";
import Fuse from "fuse.js";

// Minimal command shape for completion (built from skills + builtin /compact)
interface Cmd {
  name: string;
  description: string;
  aliases: string[];
}

const BUILTIN_COMMANDS: Cmd[] = [
  {
    name: "compact",
    description: "Compress conversation context",
    aliases: [],
  },
];

const MODEL_DISPLAY: Record<string, { name: string; color: string }> = {
  default: { name: "default", color: "gray" },
  acceptEdits: { name: "Accept Edits", color: "green" },
  plan: { name: "Plan", color: "yellow" },
  bypassPermissions: { name: "YOLO", color: "red" },
};

const MODEL_CYCLE = ["default", "acceptEdits", "plan", "bypassPermissions"];

// ---- Code-point-safe string helpers ----
// cursorCol is measured in Unicode code points (not UTF-16 code units), so
// surrogate pairs (emoji etc.) are never split by cursor movement, backspace,
// or slicing. NOTE: full display-width alignment is intentionally NOT handled
// here — CJK characters occupy 2 terminal columns and ZWJ emoji sequences
// render as a single glyph spanning multiple code points; only code-point
// safety (never breaking a surrogate pair) is guaranteed.
function toChars(s: string): string[] {
  return Array.from(s);
}

function charLen(s: string): number {
  return toChars(s).length;
}

function sliceChars(s: string, start: number, end?: number): string {
  return toChars(s).slice(start, end).join("");
}

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  history?: string[];
  commands?: Cmd[];
  onEscape?: () => void;
  inputState?: "idle" | "focused" | "agent" | "error";
  permMode?: string;
  onModeChange?: (mode: string) => void;
  workDir?: string;
}

export function InputBox(props: InputBoxProps): React.JSX.Element {
  const {
    onSubmit,
    disabled,
    history = [],
    commands = BUILTIN_COMMANDS,
    onEscape,
    inputState = "idle",
    permMode = "default",
    onModeChange,
    workDir = ".",
  } = props;

  const [lines, setLines] = useState<string[]>([""]);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);

  const isMultiline = lines.length > 1;

  const allCommands = useMemo(() => {
    return [...BUILTIN_COMMANDS, ...commands];
  }, [commands]);

  const filteredCmds: Cmd[] = useMemo(() => {
    const first = lines[0] ?? "";
    if (!first.startsWith("/") || isMultiline) {
      return [];
    }
    const query = first.slice(1).toLowerCase();
    if (query.includes(" ")) {
      return [];
    }
    if (!query) {
      return allCommands;
    }

    const seen = new Set<string>();
    const result: Cmd[] = [];
    const add = (cmd: Cmd): void => {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    };

    // Tier 1: exact name
    for (const c of allCommands) {
      if (c.name.toLowerCase() === query) {
        add(c);
      }
    }
    // Tier 2: exact alias
    for (const c of allCommands) {
      if (c.aliases.some((a) => a.toLowerCase() === query)) {
        add(c);
      }
    }
    // Tier 3: prefix name
    for (const c of allCommands) {
      if (c.name.toLowerCase().startsWith(query)) {
        add(c);
      }
    }
    // Tier 4: prefix alias
    for (const c of allCommands) {
      if (c.aliases.some((a) => a.toLowerCase().startsWith(query))) {
        add(c);
      }
    }
    // Tier 5: fuzzy match
    const fuse = new Fuse(allCommands, {
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

    return result;
  }, [lines, allCommands, isMultiline]);

  const showDropdown =
    filteredCmds.length > 0 &&
    (lines[0] ?? "").startsWith("/") &&
    !isMultiline &&
    !dropdownDismissed &&
    historyIndex < 0;

  // @-file-mention autocomplete
  const fileCacheRef = useRef<string[] | null>(null);

  const atQuery = useMemo(() => {
    if ((lines[0] ?? "").startsWith("/")) {
      return null;
    }
    const line = lines[cursorLine] ?? "";
    const m = /(?:^|\s)@([^\s]*)$/.exec(line);
    return m ? (m[1] ?? "") : null;
  }, [lines, cursorLine]);

  const filteredFiles = useMemo(() => {
    if (atQuery === null) {
      return [];
    }
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

  const showAtDropdown = !showDropdown && atQuery !== null && filteredFiles.length > 0;

  const completeAt = (path: string): void => {
    setLines((prev) => {
      const u = [...prev];
      u[cursorLine] = (u[cursorLine] ?? "").replace(/@([^\s]*)$/, `@${path} `);
      return u;
    });
    setCursorCol(charLen((lines[cursorLine] ?? "").replace(/@([^\s]*)$/, `@${path} `)));
    setDropdownIndex(0);
  };

  useInput((input, key) => {
    // Filter out SGR mouse events
    if (input.includes("[<") && /\[<\d+;\d+;\d+[Mm]/.test(input)) {
      return;
    }

    if (key.escape || input === "\x1b") {
      if (showDropdown) {
        setDropdownDismissed(true);
        setDropdownIndex(0);
        return;
      }
      if (showAtDropdown) {
        setLines((prev) => {
          const u = [...prev];
          u[cursorLine] = (u[cursorLine] ?? "").replace(/@([^\s]*)$/, "");
          return u;
        });
        setDropdownIndex(0);
        return;
      }
      onEscape?.();
      return;
    }

    if (disabled) {
      return;
    }

    const isPlainReturn = key.return || input === "\r" || input === "\n";
    const hasNewline = /[\r\n]/.test(input);

    // Multi-character input containing newlines = pasted block. Ink delivers
    // pasted text as one input string; a real Enter key press arrives as a
    // single "\r" (key.return). Insert the paste as multi-line content
    // instead of stripping the newlines.
    if (hasNewline && input.length > 1 && !key.ctrl && !key.meta) {
      const parts = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      const line = lines[cursorLine] ?? "";
      const before = sliceChars(line, 0, cursorCol);
      const after = sliceChars(line, cursorCol);
      const inserted = [before + (parts[0] ?? ""), ...parts.slice(1)];
      const lastIdx = inserted.length - 1;
      const endCol = charLen(inserted[lastIdx] ?? "");
      inserted[lastIdx] = (inserted[lastIdx] ?? "") + after;
      setLines((prev) => {
        const updated = [...prev];
        updated.splice(cursorLine, 1, ...inserted);
        return updated;
      });
      setCursorLine(cursorLine + lastIdx);
      setCursorCol(endCol);
      setDropdownIndex(0);
      setDropdownDismissed(false);
      return;
    }

    // Shift+Enter or Ctrl+J -> newline
    if (isPlainReturn && (key.shift || (key.ctrl && input === "\n"))) {
      const line = lines[cursorLine] ?? "";
      setLines((prev) => {
        const updated = [...prev];
        updated[cursorLine] = sliceChars(line, 0, cursorCol);
        updated.splice(cursorLine + 1, 0, sliceChars(line, cursorCol));
        return updated;
      });
      setCursorLine(cursorLine + 1);
      setCursorCol(0);
      return;
    }

    if (isPlainReturn) {
      if (showAtDropdown && filteredFiles[dropdownIndex]) {
        completeAt(filteredFiles[dropdownIndex]);
        return;
      }
      if (showDropdown && filteredCmds.length > 0 && dropdownIndex < filteredCmds.length) {
        const selected = filteredCmds[dropdownIndex];
        if (selected) {
          const newLine = "/" + selected.name + " ";
          setLines([newLine]);
          setCursorLine(0);
          setCursorCol(charLen(newLine));
          setDropdownIndex(0);
          return;
        }
      }

      const finalValue = lines.join("\n").trim();
      if (finalValue) {
        onSubmit(finalValue);
        setLines([""]);
        setCursorLine(0);
        setCursorCol(0);
        setHistoryIndex(-1);
        setDropdownIndex(0);
        setDropdownDismissed(false);
      }
      return;
    }

    // Shift+Tab: cycle permission mode
    if ((input === "\x1b[Z" || (key.tab && key.shift)) && onModeChange) {
      const idx = MODEL_CYCLE.indexOf(permMode);
      const next = MODEL_CYCLE[(idx + 1) % MODEL_CYCLE.length] ?? "default";
      onModeChange(next);
      return;
    }

    if (key.tab && showAtDropdown && filteredFiles[dropdownIndex]) {
      completeAt(filteredFiles[dropdownIndex]);
      return;
    }

    if (key.tab && (lines[0] ?? "").startsWith("/") && filteredCmds.length > 0) {
      const selected = filteredCmds[dropdownIndex];
      if (selected) {
        const newLine = "/" + selected.name + " ";
        setLines([newLine]);
        setCursorLine(0);
        setCursorCol(charLen(newLine));
        setDropdownIndex(0);
      }
      return;
    }

    if (key.ctrl && input === "a") {
      setCursorCol(0);
      return;
    }
    if (key.ctrl && input === "e") {
      setCursorCol(charLen(lines[cursorLine] ?? ""));
      return;
    }

    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(cursorCol - 1);
      } else if (isMultiline && cursorLine > 0) {
        setCursorLine(cursorLine - 1);
        setCursorCol(charLen(lines[cursorLine - 1] ?? ""));
      }
      return;
    }

    if (key.rightArrow) {
      const lineLen = charLen(lines[cursorLine] ?? "");
      if (cursorCol < lineLen) {
        setCursorCol(cursorCol + 1);
      } else if (isMultiline && cursorLine < lines.length - 1) {
        setCursorLine(cursorLine + 1);
        setCursorCol(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        const col = cursorCol;
        setLines((prev) => {
          const updated = [...prev];
          const chars = toChars(updated[cursorLine] ?? "");
          // Remove one full code point (never splits a surrogate pair)
          updated[cursorLine] = [...chars.slice(0, col - 1), ...chars.slice(col)].join("");
          return updated;
        });
        setCursorCol(col - 1);
      } else if (cursorLine > 0) {
        const prevLen = charLen(lines[cursorLine - 1] ?? "");
        const cl = cursorLine;
        setLines((prev) => {
          const updated = [...prev];
          updated[cl - 1] = (updated[cl - 1] ?? "") + (updated[cl] ?? "");
          updated.splice(cl, 1);
          return updated;
        });
        setCursorLine(cl - 1);
        setCursorCol(prevLen);
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
        setCursorCol(Math.min(cursorCol, charLen(targetLine)));
        return;
      }
      if (!isMultiline && history.length > 0) {
        const nextIdx = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(nextIdx);
        const entry = history[history.length - 1 - nextIdx] ?? "";
        const entryLines = entry.split("\n");
        setLines(entryLines);
        setCursorLine(0);
        setCursorCol(charLen(entryLines[0] ?? ""));
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
        setCursorCol(Math.min(cursorCol, charLen(targetLine)));
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
          setCursorCol(charLen(entryLines[0] ?? ""));
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setLines([""]);
          setCursorLine(0);
          setCursorCol(0);
        }
      }
      return;
    }

    const cleanInput = input.replace(/[\r\n]/g, "");
    if (cleanInput && !key.ctrl && !key.meta) {
      const col = cursorCol;
      setLines((prev) => {
        const updated = [...prev];
        const line = updated[cursorLine] ?? "";
        updated[cursorLine] = sliceChars(line, 0, col) + cleanInput + sliceChars(line, col);
        return updated;
      });
      setCursorCol(col + charLen(cleanInput));
      setDropdownIndex(0);
      setDropdownDismissed(false);
    }
  });

  const borderColor = inputState in BORDER_COLORS ? BORDER_COLORS[inputState] : BORDER_COLORS.idle;

  const ghostText = useMemo(() => {
    if (isMultiline || !(lines[0] ?? "").startsWith("/") || (lines[0] ?? "").length <= 1) {
      return "";
    }
    const typed = (lines[0] ?? "").slice(1).toLowerCase();
    const best = filteredCmds[0];
    if (!best?.name.toLowerCase().startsWith(typed)) {
      return "";
    }
    return best.name.slice(typed.length);
  }, [lines, filteredCmds, isMultiline]);

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderTop={true}
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderColor={borderColor}
      >
        <Text>
          {COLORS.primary(`${ICONS.prompt} `)}
          {disabled ? (
            <Text dimColor>Waiting...</Text>
          ) : (
            <>
              {lines.map((line, i) => {
                const prefix = i > 0 ? "\n  " : "";
                if (i === cursorLine) {
                  const chars = toChars(line);
                  const col = Math.min(cursorCol, chars.length);
                  const before = chars.slice(0, col).join("");
                  const atChar = col < chars.length ? chars[col] : " ";
                  const after = col < chars.length ? chars.slice(col + 1).join("") : "";
                  const atEnd = col >= chars.length;
                  return (
                    <Text key={String(i)}>
                      {prefix}
                      {before}
                      <Text inverse>{atChar}</Text>
                      {after}
                      {atEnd && i === 0 && ghostText ? <Text dimColor>{ghostText}</Text> : null}
                    </Text>
                  );
                }
                return (
                  <Text key={String(i)}>
                    {prefix}
                    {line}
                  </Text>
                );
              })}
            </>
          )}
        </Text>
      </Box>
      {showDropdown ? (
        <Box flexDirection="column">
          {filteredCmds.slice(0, 8).map((cmd, i) => {
            const selected = i === dropdownIndex;
            if (selected) {
              return (
                <Text key={cmd.name} color="#fbbf24">
                  /{cmd.name} {cmd.description}
                </Text>
              );
            }
            return (
              <Text key={cmd.name} dimColor>
                /{cmd.name} {cmd.description}
              </Text>
            );
          })}
        </Box>
      ) : null}
      {showAtDropdown ? (
        <Box flexDirection="column">
          <Text dimColor>{"FILES"}</Text>
          {filteredFiles.map((file, i) => {
            const selected = i === dropdownIndex;
            if (selected) {
              return (
                <Text key={file} color="#fbbf24">
                  {ICONS.arrow} @{file}
                </Text>
              );
            }
            return (
              <Text key={file} dimColor>
                {ICONS.arrow} @{file}
              </Text>
            );
          })}
        </Box>
      ) : null}
      <Box paddingLeft={1}>
        {permMode !== "default" ? (
          <Text>
            <Text color={permMode in MODEL_DISPLAY ? MODEL_DISPLAY[permMode].color : "gray"}>
              {permMode in MODEL_DISPLAY ? MODEL_DISPLAY[permMode].name : permMode} on
            </Text>
            <Text dimColor> (shift+tab to cycle)</Text>
          </Text>
        ) : (
          <Text dimColor>default</Text>
        )}
      </Box>
    </Box>
  );
}

// Export the Cmd interface for app.tsx to build command lists
export type { Cmd };
