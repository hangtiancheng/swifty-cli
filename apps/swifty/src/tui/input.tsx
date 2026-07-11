import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "tui" });

import type { Command } from "@/commands/commands.js";
import type { CommandUsageTracker } from "@/commands/usage-tracker.js";
import type { PermissionMode } from "@/permissions/checker.js";
import { SKIP_DIRS } from "@/tools/types.js";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { Box, Text, useInput } from "ink";
import { useState, useMemo, useRef } from "react";
import { BORDER_COLORS, COLORS, ICONS } from "./styles.js";
import Fuse from "fuse.js";

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

const MODEL_DISPLAY: Record<PermissionMode, { name: string; color: string }> = {
  default: { name: "default", color: "gray" },
  acceptEdits: { name: "Accept Edits", color: "green" },
  plan: { name: "Plan", color: "yellow" },
  bypassPermissions: { name: "YOLO", color: "red" },
};

const MODEL_CYCLE: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  history?: string[];
  commands?: Command[];
  onEscape?: () => void;
  inputState?: "idle" | "focused" | "agent" | "error";
  usageTracker?: CommandUsageTracker;
  permMode?: PermissionMode;
  onModeChange?: (mode: PermissionMode) => void;
  workDir?: string;
}

export function InputBox(props: InputBoxProps) {
  const {
    onSubmit,
    disabled,
    history = [],
    commands = [],
    onEscape,
    inputState = "idle",
    usageTracker,
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

  // @-file-mention autocomplete: active when the current line ends with an
  // @<partial> token (and we're not typing a slash command).
  const fileCacheRef = useRef<string[] | null>(null);

  const atQuery = useMemo(() => {
    if (lines[0].startsWith("/")) {
      return null;
    }
    const line = lines[cursorLine] ?? "";
    const m = /(?:^|\s)@([^\s]*)$/.exec(line);
    return m ? m[1] : null;
  }, [lines, cursorLine]);

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

  const showAtDropdown = !showDropdown && atQuery !== null && filteredFiles.length > 0;

  const completeAt = (path: string) => {
    const line = lines[cursorLine] ?? "";
    const newLine = line.replace(/@([^\s]*)$/, `@${path} `);
    setLines((prev) => {
      const u = [...prev];
      u[cursorLine] = (u[cursorLine] ?? "").replace(/@([^\s]*)$/, `@${path} `);
      return u;
    });
    setCursorCol(newLine.length);
    setDropdownIndex(0);
  };

  useInput((input, key) => {
    if (input.includes("[<") && /\[<\d+;\d+;\d+[Mm]/.test(input)) {
      return;
    }

    // Escape: key.escape or raw \x1b byte (tmux compat)
    if (key.escape || input === "\x1b") {
      if (showDropdown) {
        setDropdownDismissed(true);
        setDropdownIndex(0);
        return;
      }
      if (showAtDropdown) {
        // Cancel the @ mention currently being typed.
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

    const hasReturn = key.return || input.includes("\r") || input.includes("\n");
    const cleanInput = input.replace(/[\r\n]/g, "");

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
        const selected = filteredCmds[dropdownIndex];
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
      const selected = filteredCmds[dropdownIndex];
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
        setCursorCol(cursorCol - 1);
      } else if (isMultiline && cursorLine > 0) {
        setCursorLine(cursorLine - 1);
        setCursorCol((lines[cursorLine - 1] ?? "").length);
      }
      return;
    }

    if (key.rightArrow) {
      const lineLen = (lines[cursorLine] ?? "").length;
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
          const l = updated[cursorLine] ?? "";
          updated[cursorLine] = l.slice(0, col - 1) + l.slice(col);
          return updated;
        });
        setCursorCol(col - 1);
      } else if (cursorLine > 0) {
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
        setCursorLine((c) => c - 1);
        return;
      }
      if (isMultiline && cursorLine > 0) {
        const targetLine = lines[cursorLine - 1] ?? "";
        setCursorLine(cursorLine - 1);
        setCursorCol(Math.min(cursorCol, targetLine.length));
        return;
      }
      if (!isMultiline && history.length > 0) {
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
        setCursorCol(Math.min(cursorCol, targetLine.length));
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
          setLines([""]);
          setCursorLine(0);
          setCursorCol(0);
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
  });

  const borderColor = inputState in BORDER_COLORS ? BORDER_COLORS[inputState] : BORDER_COLORS.idle;

  const ghostText = useMemo(() => {
    if (isMultiline || !lines[0].startsWith("/") || lines[0].length <= 1) {
      return "";
    }
    const typed = lines[0].slice(1).toLowerCase();
    const best = filteredCmds[0];
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
                  const col = Math.min(cursorCol, line.length);
                  const before = line.slice(0, col);
                  const atChar = col < line.length ? line[col] : " ";
                  const after = col < line.length ? line.slice(col + 1) : "";
                  const atEnd = col >= line.length;
                  return (
                    <Text key={i}>
                      {prefix}
                      {before}
                      <Text inverse>{atChar}</Text>
                      {after}
                      {atEnd && i === 0 && ghostText ? <Text dimColor>{ghostText}</Text> : null}
                    </Text>
                  );
                }
                return (
                  <Text key={i}>
                    {prefix}
                    {line}
                  </Text>
                );
              })}
            </>
          )}
        </Text>
      </Box>
      {showDropdown && (
        <Box flexDirection="column">
          {recentCount > 0 && <Text dimColor>{"RECENTLY USED"}</Text>}
          {filteredCmds.slice(0, 8).map((cmd, i) => {
            const selected = i === dropdownIndex;
            return (
              <Text key={cmd.name} color={selected ? "#b4befe" : undefined} dimColor={!selected}>
                /{cmd.name} {cmd.description}
              </Text>
            );
          })}
        </Box>
      )}
      {showAtDropdown && (
        <Box flexDirection="column">
          <Text dimColor>{"FILES"}</Text>
          {filteredFiles.map((file, i) => (
            <Text
              key={file}
              color={i === dropdownIndex ? "#b4befe" : undefined}
              dimColor={i !== dropdownIndex}
            >
              {ICONS.arrow} @{file}
            </Text>
          ))}
        </Box>
      )}
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
