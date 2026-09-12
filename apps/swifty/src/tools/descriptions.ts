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

export const BASH_DESCRIPTION = `
Execute a shell command and return stdout and stderr.

On Windows, prefer the PowerShell tool over Bash for shell commands.

IMPORTANT: Avoid using this tool to run cat, head, tail, sed, awk or echo commands. Instead use the dedicated ReadFile, EditFile, or WriteFile tools which provide a better experience.

Usage Notes

- Each call starts in the Agent's working directory with a fresh shell. Changes made by cd, variables, functions, and shell options do not persist to the next call.
- Always quote file paths containing spaces with double quotes.
- To run in a subdirectory, use cd with a quoted path followed by && and the command in the same call.
- Optional timeout in seconds (max 600s). Default 120s.
- When issuing multiple independent commands, make separate tool calls instead of chaining with &&.
- Use && to chain sequential dependent commands. Use ; only when you don't care if earlier commands failed.

Git Safety Protocol

- NEVER run destructive git commands (push --force, reset --hard, checkout ., clean -f, branch -D) unless the user explicitly requests it.
- NEVER skip hooks (--no-verify) unless the user explicitly requests it.
- Prefer creating a new commit rather than amending an existing one.
- Commit identity: adds a header: Co-Authored-By: Swifty <usr161043261@outlook.com>

Avoiding unnecessary sleep commands. Do NOT retry failing commands in a sleep loop -- diagnose the root cause instead.
When using find, search from "." or a specific path, not "/" -- scanning the full filesystem is too expensive.
`;

export const POWERSHELL_DESCRIPTION = `
Execute a PowerShell command and return stdout and stderr.

This is the RECOMMENDED shell tool on Windows -- prefer it over Bash there. It runs powershell.exe on Windows and pwsh (PowerShell Core) on other platforms.

IMPORTANT: Avoid using this tool to run Get-Content, Select-String, or Write-Output/echo commands. Instead use the dedicated ReadFile, EditFile, or WriteFile tools which provide a better experience.

Usage Notes

- Each call starts in the Agent's working directory with a fresh shell. Set-Location, variables, and shell options do not persist to the next call.
- Always quote file paths containing spaces with double quotes.
- To run in a subdirectory, use Set-Location -LiteralPath with a quoted path in the same call.
- Optional timeout in seconds (max 600s). Default 120s.
- When issuing multiple independent commands, make separate tool calls instead of chaining with ;.
- A semicolon does not stop after failure. Check $LASTEXITCODE after native commands and use -ErrorAction Stop for dependent cmdlets. Do not assume PowerShell 7 syntax is available on Windows PowerShell.

Git Safety Protocol

- NEVER run destructive git commands (push --force, reset --hard, checkout ., clean -f, branch -D) unless the user explicitly requests it.
- NEVER skip hooks (--no-verify) unless the user explicitly requests it.
- Prefer creating a new commit rather than amending an existing one.
- Commit identity: adds a header: Co-Authored-By: Swifty <usr161043261@outlook.com>

Avoiding unnecessary Start-Sleep commands. Do NOT retry failing commands in a sleep loop -- diagnose the root cause instead.
When using Get-ChildItem -Recurse, search from "." or a specific path, not the drive root -- scanning the full filesystem is too expensive.
`;

export const READ_FILE_DESCRIPTION = `
Read a file and return its contents with line numbers.

Usage Notes

- file_path may be absolute or relative to the Agent's working directory.
- By default reads up to 2000 lines from the beginning of the file.
- offset is the number of lines to skip (0-based); limit is the maximum number of lines to return. To start at displayed line 101, use offset=100. Only read what you need.
- Results are returned with line numbers (1-based) for easy reference.
- This tool reads files, not directories. Use Glob to find files and Grep to locate relevant lines.
- Large output may be saved to a readback file. Follow the returned path or request a narrower range when more content is needed.
- A successful read refreshes the file state used by EditFile and WriteFile. If a write reports that a file changed externally, read it again before retrying.
- This tool can read image files (png, jpg, jpeg, gif, webp). Image contents are returned as visual content for multimodal analysis. Line numbers and offset/limit parameters do NOT apply to image files.
`;

export const EDIT_FILE_DESCRIPTION = `
Replace an exact text string in an existing file and return a diff of the change.

Usage Notes

- You MUST read the file with ReadFile before editing, this tool will fail otherwise.
- Preserve exact whitespace and indentation from the file; exclude ReadFile's line-number prefixes.
- Always prefer editing existing files over creating new ones.
- By default old_string must occur exactly once. Include more surrounding context to disambiguate, or set replace_all=true only when every occurrence should change.
- Use the smallest old_string that is clearly unique -- 2-4 adjacent lines is usually sufficient.
- old_string must be non-empty. new_string must differ from old_string and may be empty to delete the matched text.
- file_path may be absolute or relative to the Agent's working directory. A stale-file error requires another ReadFile and a revised edit.
`;

export const WRITE_FILE_DESCRIPTION = `
Write content to a file, creating parent directories if needed. Overwrites existing files.

Usage Notes

- If modifying an existing file, prefer EditFile over WriteFile -- it only sends the diff.
- Use this tool only to create new files or for complete rewrites.
- You MUST read existing files with ReadFile before overwriting them.
- file_path may be absolute or relative to the Agent's working directory. content is the complete UTF-8 text, including any desired trailing newline; an empty string creates or truncates an empty file.
- Create documentation when the requested task or active workflow requires it; avoid unrelated files.
`;

export const GLOB_DESCRIPTION = `
Find files matching a glob pattern, returning paths relative to the search base, sorted by modification time (newest first).

Usage Notes

- Supports patterns like "**/*.ts", "src/js/*.js", "*.{ts,tsx}".
- Search from "." or a specific path, never from "/".
- Hidden (dot) files and directories are included.
- Automatically skips .git, node_modules, __pycache__, and similar directories.
- Returns at most 1000 matches. When limited, narrow the search; the result is not an exhaustive listing.
- Use this instead of find or ls command via Bash.
`;

export const GREP_DESCRIPTION = `
Search file content using a regex pattern (case-insensitive), returning file:line:content matches.

Usage Notes

- Searches one line at a time using JavaScript-style regular expressions (e.g., "log.*Error"). Escape backslashes in JSON strings. Multiline matches and every PCRE extension are not supported.
- Filter files with the include parameter (e.g., "*.ts", "*.{ts,tsx}", "src/**/*.js").
- Include patterns containing "/" match the path relative to the working directory; bare patterns like "*.ts" match file names at any depth.
- Search from "." or a specific path, never from "/".
- Automatically skips .git, node_modules, __pycache__, and similar directories.
- Use this instead of grep or rg commands via Bash.
- Returns at most 500 matching lines. Narrow the search if the result limit is reached. Use ReadFile for surrounding context.
`;
