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

// Agent profile loader: parse TOML agent profile files with 3-tier search (project local > user global > builtin)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import toml from "toml";
import { z } from "zod";

export interface AgentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  model: string;
}

// Lenient [agent] section schema: missing or wrongly-typed values silently
// fall back to their defaults (matches the historical tolerant parsing)
const AgentSectionSchema = z.object({
  description: z.string().catch(""),
  system_prompt: z.string().catch(""),
  allowed_tools: z.array(z.coerce.string()).catch([]),
  model: z.string().catch(""),
});

const AgentProfileSchema = z.object({
  agent: AgentSectionSchema.catch({
    description: "",
    system_prompt: "",
    allowed_tools: [],
    model: "",
  }),
});

// Search and parse agent profile configs by three-tier priority (project local > user global > builtin)
export class AgentProfileLoader {
  private _builtinDir: string;

  constructor() {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this._builtinDir = path.join(currentDir, "builtin");
  }

  // Load an agent profile by name; returns null if not found
  load(name: string): AgentProfile | null {
    for (const profilePath of this._searchPaths(name)) {
      if (existsSync(profilePath)) {
        try {
          return this._parse(profilePath, name);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  // List all available profiles across the three tiers, deduped by name
  // with the same priority as load() (project local > user global > builtin)
  listAll(): AgentProfile[] {
    const dirs = [
      path.join(".larky", "agents"),
      path.join(homedir(), ".larky", "agents"),
      this._builtinDir,
    ];
    const seen = new Map<string, AgentProfile>();
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith(".toml")) continue;
        const name = entry.slice(0, -".toml".length);
        if (seen.has(name)) continue;
        const profile = this.load(name);
        if (profile) seen.set(name, profile);
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Return [project local, user global, builtin] paths; load() returns the first existing one
  private _searchPaths(name: string): string[] {
    const builtin = path.join(this._builtinDir, `${name}.toml`);
    const globalDir = path.join(homedir(), ".larky", "agents", `${name}.toml`);
    const local = path.join(".larky", "agents", `${name}.toml`);
    return [local, globalDir, builtin];
  }

  // Parse a TOML agent profile file; throws (caught by load) on invalid TOML
  // or a non-table root, which AgentProfileSchema rejects
  private _parse(profilePath: string, name: string): AgentProfile {
    const content = readFileSync(profilePath, "utf-8");
    const { agent } = AgentProfileSchema.parse(toml.parse(content));
    return {
      name,
      description: agent.description,
      systemPrompt: agent.system_prompt.trim(),
      allowedTools: agent.allowed_tools,
      model: agent.model,
    };
  }
}
