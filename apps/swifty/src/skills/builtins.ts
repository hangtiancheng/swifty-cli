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

// // Builtin skills — loaded from on-disk files under src/skills/builtin/.

// import { createChildLogger } from "../logger/index.js";

// const log = createChildLogger({ module: "skills" });
// // TS equivalent of Go's //go:embed builtins/*. Each skill is a subdirectory
// // with a SKILL.md (required) and optional tool.json / references/.
// //
// // At build time, tsup's onSuccess hook copies the builtin/ directory to
// // dist/builtin/ so the files are available in bundled output.

// import yaml from "js-yaml";
// import { z } from "zod";
// import { readFileSync } from "node:fs";
// import { join } from "node:path";
// import type { Skill } from "./skill.js";

// /**
//  * Reads a file from the builtin skills directory (src/skills/builtin/ or
//  * dist/builtin/ in bundled mode). Returns empty string on error — the
//  * caller treats empty as "skill not loadable" and skips it.
//  */
// function loadBuiltinFile(skillName: string, relativePath: string): string {
//   try {
//     const filePath = join(import.meta.dirname, "builtin", skillName, relativePath);
//     return readFileSync(filePath, "utf-8");
//   } catch (err) {
//     log.error({ err }, "skills operation failed");
//     return "";
//   }
// }

// // ── Builtin skill definitions ──────────────────────────────────────────

// interface BuiltinDef {
//   name: string;
//   /** SKILL.md content (frontmatter + body). */
//   md: string;
//   /** tool.json content — presence marks the skill as "directory" type. */
//   toolJson?: string;
//   /** Reference files to append to the body (filename → content). */
//   references?: Record<string, string>;
// }

// const BUILTINS: BuiltinDef[] = [
//   {
//     name: "fullstack-interview",
//     md: loadBuiltinFile("fullstack-interview", "SKILL.md"),
//   },
//   {
//     name: "commit",
//     md: loadBuiltinFile("commit", "SKILL.md"),
//   },
//   {
//     name: "test",
//     md: loadBuiltinFile("test", "SKILL.md"),
//   },
//   {
//     name: "teach-me",
//     md: loadBuiltinFile("teach-me", "SKILL.md"),
//     references: {
//       "pedagogy.md": loadBuiltinFile("teach-me", "references/pedagogy.md"),
//     },
//   },
// ];

// /**
//  * Loads all builtin skills. Returns Skill[] with meta parsed from the
//  * YAML frontmatter and body from the markdown content. Reference files
//  * are appended to the body with separators so the agent sees them when
//  * the skill is activated.
//  * Mirrors Go's LoadBuiltins().
//  */
// export function loadBuiltinSkills(): Skill[] {
//   const skills: Skill[] = [];
//   for (const def of BUILTINS) {
//     // Skip skills whose SKILL.md couldn't be loaded (empty string).
//     if (!def.md) {
//       continue;
//     }
//     const parsed = parseBuiltinSkill(def.name, def.md);
//     if (!parsed) {
//       continue;
//     }
//     // Append reference files to the body so the agent has full context.
//     let body = parsed.body;
//     if (def.references) {
//       for (const [filename, content] of Object.entries(def.references)) {
//         if (content) {
//           body += `\n\n---\n\n# Reference: ${filename}\n\n${content}`;
//         }
//       }
//     }
//     skills.push({
//       meta: parsed.meta,
//       body,
//       sourceDir: "",
//       isDirectory: def.toolJson !== undefined || def.references !== undefined,
//     });
//   }
//   return skills;
// }

// // ── YAML frontmatter parser (uses zod, no type assertions) ────────────

// const BuiltinFrontmatterSchema = z.looseObject({
//   name: z.string(),
//   description: z.string().optional(),
//   allowed_tools: z.array(z.string()).optional(),
//   mode: z.enum(["inline", "fork"]).optional(),
//   model: z.string().optional(),
//   fork_context: z.enum(["full", "none", "recent"]).optional(),
// });

// function parseBuiltinSkill(
//   name: string,
//   content: string,
// ): { meta: Skill["meta"]; body: string } | null {
//   if (!content.startsWith("---")) {
//     return null;
//   }
//   const endIdx = content.indexOf("---", 3);
//   if (endIdx === -1) {
//     return null;
//   }

//   const frontmatter = content.slice(3, endIdx).trim();
//   const body = content.slice(endIdx + 3).trim();

//   try {
//     const raw: unknown = yaml.load(frontmatter);
//     const parsed = BuiltinFrontmatterSchema.safeParse(raw);
//     if (!parsed.success) {
//       return null;
//     }
//     const d = parsed.data;
//     return {
//       meta: {
//         name: d.name,
//         description: d.description ?? "",
//         allowedTools: d.allowed_tools,
//         mode: d.mode ?? "inline",
//         model: d.model,
//         forkContext: d.fork_context,
//       },
//       body,
//     };
//   } catch (err) {
//     log.error({ err }, "skills operation failed");
//     return null;
//   }
// }

import type { Skill } from "./skill.js";

export function loadBuiltins(): Skill[] {
  return [];
}
