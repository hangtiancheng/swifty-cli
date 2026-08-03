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

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import { parse, z } from "zod";

import { createChildLogger } from "../logger/index.js";

import { loadBuiltins } from "./builtins.js";
import type { Skill, SkillMeta } from "./skill.js";

import { asRecord, strArg } from "@/utils/index.js";

const log = createChildLogger({ module: "skills" });

/**
 * Internal skill storage with source file path and load timestamp for hot reloading
 *
 */
interface CatalogEntry {
  skill: Skill;
  /** Absolute path to SKILL.md, used for re-reading during hot reloading */
  filePath: string;

  /** File modification time (ms) when last loaded. 0 indicates a built-in skill that requires no reloading */
  loadedMtimeMs: number;
}

export class SkillCatalog {
  private entries = new Map<string, CatalogEntry>();
  private workDir = "";
  private dirModTimes = new Map<string, number>();

  load(workDir: string): void {
    this.workDir = workDir;
    // Three-tier loading: later tiers override same-named skills from earlier tiers:
    // Tier 1: Built-in skills (currently empty)
    for (const skill of loadBuiltins()) {
      this.entries.set(skill.meta.name, {
        skill,
        filePath: "",
        loadedMtimeMs: 0,
      });
    }

    // Tier 2: User-global ~/.swifty/skills/
    // Tier 3: Project-level $workDir/.swifty/skills/ (highest priority)
    const dirs = [
      join(homedir(), ".claude", "skills"),
      join(homedir(), ".github", "skills"),
      join(homedir(), ".swifty", "skills"),
      join(workDir, ".claude", "skills"),
      join(workDir, ".github", "skills"),
      join(workDir, ".swifty", "skills"),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        continue;
      }

      this.scanDirectory(dir);
    }

    this.snapshotDirModTimes();
  }

  /**
   * Check whether a skill directory mtime has changed (a skill was added or deleted).
   * Edits to existing skill files are handled by lazy re-reading in get().
   */
  needsReload(): boolean {
    for (const [dir, recorded] of this.dirModTimes) {
      try {
        const current = statSync(dir).mtimeMs;
        if (current !== recorded) {
          return true;
        }
      } catch {
        if (recorded !== 0) {
          return true;
        }
      }
    }
    const dirs = this.skillDirPaths();
    for (const dir of dirs) {
      if (!this.dirModTimes.has(dir)) {
        try {
          statSync(dir);
          return true;
        } catch {
          // Directory still does not exist
        }
      }
    }
    return false;
  }

  reload(): void {
    this.entries.clear();
    this.load(this.workDir);
  }

  private snapshotDirModTimes(): void {
    this.dirModTimes.clear();
    for (const dir of this.skillDirPaths()) {
      try {
        this.dirModTimes.set(dir, statSync(dir).mtimeMs);
      } catch {
        this.dirModTimes.set(dir, 0);
      }
    }
  }

  private skillDirPaths(): string[] {
    return [
      join(homedir(), ".swifty", "skills"),
      ...(this.workDir ? [join(this.workDir, ".swifty", "skills")] : []),
    ];
  }

  private scanDirectory(dir: string) {
    let dirEntries: string[];
    try {
      dirEntries = readdirSync(dir);
    } catch (err) {
      log.error({ err }, "skills operation failed");
      return;
    }

    for (const entry of dirEntries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const skillFile = join(fullPath, "SKILL.md");
        if (existsSync(skillFile)) {
          this.loadSkill(skillFile, fullPath, true);
        }
      }
      // else if (entry.endsWith(".md") && entry !== "SKILL.md") {
      //   this.loadSkill(fullPath, dir, false);
      // }
    }
  }
  private loadSkill(filePath: string, sourceDir: string, isDirectory: boolean) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = parseSkillFile(raw);
      if (!parsed) {
        return;
      }

      const skill: Skill = {
        meta: parsed.meta,
        body: parsed.body,
        sourceDir,
        isDirectory,
      };

      // Record file modification time for subsequent hot reload detection
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch (err) {
        log.error({ err }, "skills operation failed");
        // Fail gracefully if timestamp cannot be retrieved
      }

      this.entries.set(skill.meta.name, {
        skill,
        filePath,
        loadedMtimeMs: mtimeMs,
      });
    } catch (err) {
      log.error({ err }, "skills operation failed");
      // Skip invalid skill
    }
  }

  list(): SkillMeta[] {
    return [...this.entries.values()].map((e) => e.skill.meta);
  }

  /**
   * Gets a skill with hot reload support: automatically re-reads the file if it has been modified on disk.
   * re-reads the body on every call (hot reload),
   * and retains the cached body if reading fails.
   */
  get(name: string): Skill | undefined {
    const entry = this.entries.get(name);
    if (!entry) {
      return undefined;
    }

    // Attempt hot reload: check if the file has been modified
    if (entry.filePath && entry.loadedMtimeMs > 0) {
      try {
        const currentMtime = statSync(entry.filePath).mtimeMs;
        if (currentMtime > entry.loadedMtimeMs) {
          // File has been modified, re-read it
          const raw = readFileSync(entry.filePath, "utf-8");
          const parsed = parseSkillFile(raw);
          if (parsed) {
            entry.skill = {
              meta: parsed.meta,
              body: parsed.body,
              sourceDir: entry.skill.sourceDir,
              isDirectory: entry.skill.isDirectory,
            };
            entry.loadedMtimeMs = currentMtime;
          }
          // Retain the cached version if parsing fails — a single bad write should not cause a skill to vanish
        }
      } catch (err) {
        log.error({ err }, "skills operation failed");
        // Retain the cached version if reading fails
      }
    }

    return entry.skill;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }
}

/**
 * Normalize the execution mode.
 *
 * Some agent ecosystems use `context: fork` to express "isolated execution", which is
 * semantically equivalent to `mode: fork` here. Both forms are interchangeable, so
 * externally sourced skills work without modification.
 */
function resolveMode(raw: unknown): "inline" | "fork" {
  // raw.mode
  const mode = strArg(asRecord(raw), "mode");
  if (mode === "inline" || mode === "fork") {
    return mode;
  }
  // raw.context
  return strArg(asRecord(raw), "context") === "fork" ? "fork" : "inline";
}

const YamlFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  mode: z.enum(["inline", "fork"]).optional(),
  model: z.string().optional(),
  fork_context: z.enum(["full", "none", "recent"]).optional(),
});

function parseSkillFile(content: string): {
  meta: SkillMeta;
  body: string;
} | null {
  if (!content.startsWith("---")) {
    return null;
  }

  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) {
    return null;
  }

  const frontmatter = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 3).trim();

  try {
    const raw: unknown = yaml.load(frontmatter);
    const data = parse(YamlFrontmatterSchema, raw);
    return {
      meta: {
        name: data.name,
        description: data.description ?? "",
        mode: resolveMode(raw),
        model: data.model,
        forkContext: data.fork_context,
      },
      body,
    };
  } catch (err) {
    log.error({ err }, "skills operation failed");
    return null;
  }
}

/**
 * Build the Skill listing for the system prompt: only names and one-line
 * descriptions are included; the full SOP is fetched on demand via LoadSkill.
 * Returns an empty string when the catalog is empty so callers can skip this section.
 */
export function buildSkillSection(catalog: SkillCatalog, workDir: string): string {
  const metas = catalog.list();
  if (metas.length === 0) {
    return "";
  }
  const skillsDir = join(workDir, ".swifty", "skills");
  const lines = [
    "## Available Skills\n",
    `Skills are installed at: ${skillsDir}`,
    "When creating new skills, always place them under this directory as <skill-name>/SKILL.md.\n",
    'Only Skill names and one-line descriptions are listed below. To activate a Skill on demand call the LoadSkill tool with {name: "<skill-name>"}. After activation the Skill\'s full SOP gets pinned to the environment context, and any tools the Skill declares get registered. Users can also invoke a Skill directly with /<name>.\n',
    'If the user pastes a Skill URL (skills.sh, github.com tree URL, or raw SKILL.md URL) and asks to install / add / get it, call the InstallSkill tool with {url: "<url>"} — the new Skill becomes available immediately afterwards.\n',
  ];
  for (const meta of metas) {
    const desc =
      meta.description.length > 200 ? meta.description.slice(0, 200) + "…" : meta.description;
    lines.push(`- /${meta.name}: ${desc}`);
  }
  return lines.join("\n");
}
