import { createChildLogger } from '../logger/index.js';

const log = createChildLogger({ module: 'skills' });

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { Skill, SkillMeta } from './skill.js';
import { parse, z } from 'zod';
import { loadBuiltins } from './builtins.js';

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
  private workDir = '';
  private dirModTimes = new Map<string, number>();

  load(workDir: string): void {
    this.workDir = workDir;
    // 三层加载，后面的覆盖前面的同名 skill：
    // Tier 1: 内置 skill（当前为空）
    for (const skill of loadBuiltins()) {
      this.entries.set(skill.meta.name, {
        skill,
        filePath: '',
        loadedMtimeMs: 0,
      });
    }

    // Tier 2: 用户全局 ~/.swifty/skills/
    // Tier 3: 项目级 $workDir/.swifty/skills/（最高优先级）
    const dirs = [
      join(homedir(), '.trae', 'skills'),
      join(homedir(), '.claude', 'skills'),
      join(homedir(), '.github', 'skills'),
      join(homedir(), '.swifty', 'skills'),
      join(workDir, '.trae', 'skills'),
      join(workDir, '.claude', 'skills'),
      join(workDir, '.github', 'skills'),
      join(workDir, '.swifty', 'skills'),
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
   * 检查 skill 目录的 mtime 是否变化（新增或删除了 skill）。
   * 已有 skill 的文件编辑由 get() 的按需重读处理。
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
          // 目录仍不存在
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
      join(homedir(), '.swifty', 'skills'),
      ...(this.workDir ? [join(this.workDir, '.swifty', 'skills')] : []),
    ];
  }

  private scanDirectory(dir: string) {
    let dirEntries: string[];
    try {
      dirEntries = readdirSync(dir);
    } catch (err) {
      log.error({ err }, 'skills operation failed');
      return;
    }

    for (const entry of dirEntries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const skillFile = join(fullPath, 'SKILL.md');
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
      const raw = readFileSync(filePath, 'utf-8');
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
        log.error({ err }, 'skills operation failed');
        // Fail gracefully if timestamp cannot be retrieved
      }

      this.entries.set(skill.meta.name, {
        skill,
        filePath,
        loadedMtimeMs: mtimeMs,
      });
    } catch (err) {
      log.error({ err }, 'skills operation failed');
      // Skip invalid skill
    }
  }

  list(): SkillMeta[] {
    return [...this.entries.values()].map((e) => e.skill.meta);
  }

  /**
   * Gets a skill with hot reload support: automatically re-reads the file if it has been modified on disk.
   * Aligns with the Go version's GetFull: re-reads the body on every call (hot reload),
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
          const raw = readFileSync(entry.filePath, 'utf-8');
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
          // Retain the cached version if parsing fails (consistent with Go behavior)
        }
      } catch (err) {
        log.error({ err }, 'skills operation failed');
        // Retain the cached version if reading fails
      }
    }

    return entry.skill;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }
}

const YamlFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  mode: z.enum(['inline', 'fork']).optional(),
  model: z.string().optional(),
  fork_context: z.enum(['full', 'none', 'recent']).optional(),
});

function parseSkillFile(content: string): {
  meta: SkillMeta;
  body: string;
} | null {
  if (!content.startsWith('---')) {
    return null;
  }

  const endIdx = content.indexOf('---', 3);
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
        description: data.description ?? '',
        mode: data.mode ?? 'inline',
        model: data.model,
        forkContext: data.fork_context,
      },
      body,
    };
  } catch (err) {
    log.error({ err }, 'skills operation failed');
    return null;
  }
}
