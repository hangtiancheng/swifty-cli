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

// ToolRegistry: maps tool names to BaseTool instances
import type Anthropic from "@anthropic-ai/sdk";

import type { BaseTool } from "./base.js";

export class ToolRegistry {
  private _tools = new Map<string, BaseTool>();

  // Register a tool; same-name overwrites
  register(tool: BaseTool): void {
    this._tools.set(tool.name, tool);
  }

  // Look up tool by name; returns undefined if not found
  get(name: string): BaseTool | undefined {
    return this._tools.get(name);
  }

  // Return all tool schemas in Anthropic ToolUnion format
  toolSchemas(): Anthropic.ToolUnion[] {
    return Array.from(this._tools.values()).map(
      (tool): Anthropic.ToolUnion => ({
        name: tool.name,
        description: tool.description,
        input_schema: { ...tool.inputSchema, type: "object" },
      }),
    );
  }
}
