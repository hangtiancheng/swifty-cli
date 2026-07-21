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

import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "skills" });

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, isAbsolute, basename } from "node:path";
import type { Tool, ToolContext, ToolResult, ToolSchema } from "../tools/types.js";
import type { SkillCatalog } from "./catalog.js";
import { asErrorString, strArg } from "@/utils/index.js";

function nameFromFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return "";
  }
  const end = content.indexOf("---", 3);
  if (end === -1) {
    return "";
  }
  const m = /(?:^|\n)\s*name:\s*(.+)/.exec(content.slice(3, end));
  return m ? m[1].trim() : "";
}

// Installs a skill from a local file path or an https URL into
// .swifty/skills/<name>/SKILL.md, then reloads the catalog. Mirrors Go's
// InstallSkill tool.
export class InstallSkillTool implements Tool {
  name = "InstallSkill";
  description = "Install a skill from a local file path or an https URL into .swifty/skills.";
  category = "read" as const;
  system = true;

  constructor(
    private workDir: string,
    private catalog: SkillCatalog,
    private onInstalled?: () => void,
  ) {}

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "Local path or https URL to a SKILL.md",
          },
          name: {
            type: "string",
            description: "Optional skill name (defaults to frontmatter name)",
          },
        },
        required: ["source"],
      },
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const source = strArg(args, "source");
    if (!source) {
      return { output: "Error: source is required", isError: true };
    }

    let content: string;
    if (/^https?:\/\//.test(source)) {
      try {
        const resp = await fetch(source);
        if (!resp.ok) {
          return {
            output: `Error: fetch failed (${String(resp.status)})`,
            isError: true,
          };
        }
        content = await resp.text();
      } catch (err) {
        log.error({ err }, "skills operation failed");
        return {
          output: `Error fetching skill: ${asErrorString(err)}`,
          isError: true,
        };
      }
    } else {
      const p = isAbsolute(source) ? source : join(this.workDir, source);
      if (!existsSync(p)) {
        return { output: `Error: file not found: ${source}`, isError: true };
      }
      content = readFileSync(p, "utf-8");
    }

    const name =
      strArg(args, "name") || nameFromFrontmatter(content) || basename(source).replace(/\.md$/, "");
    if (!name) {
      return { output: "Error: could not determine skill name", isError: true };
    }

    const dir = join(this.workDir, ".swifty", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content, "utf-8");

    this.catalog.load(this.workDir);
    this.onInstalled?.();

    return {
      output: `Skill '${name}' installed to .swifty/skills/${name}/SKILL.md`,
      isError: false,
    };
  }
}
