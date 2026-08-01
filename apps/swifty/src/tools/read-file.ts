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

import { existsSync, readFileSync, statSync } from "fs";

import { isImagePath } from "../images/detect.js";
import { attachmentLabel, loadImageAttachment } from "../images/load.js";
import { createChildLogger } from "../logger/index.js";
import { asErrorString } from "../utils/index.js";
import { intArg, strArg } from "../utils/index.js";

import { READ_FILE_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";

const log = createChildLogger({ module: "tools" });
export class ReadFileTool implements Tool {
  // Use a hardcoded string instead of ReadFileTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "ReadFile";

  description = READ_FILE_DESCRIPTION;

  category: ToolCategory = "read";
  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string" as const,
          description: "Absolute path to the file",
        },
        offset: {
          type: "integer" as const,
          description: "Line number to start from (0-based)",
          default: 0,
        },
        limit: {
          type: "integer" as const,
          description: "Max lines to read",
          default: 2000,
        },
      },
      required: ["file_path"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = strArg(args, "file_path");
    if (!filePath) {
      return {
        output: "Error: file_path is required",
        isError: true,
      };
    }

    if (!existsSync(filePath)) {
      return {
        output: `Error: file not found: ${filePath}`,
        isError: true,
      };
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return {
        output: `Error: ${filePath} is a directory, not a file. Use Glob to list directory contents.`,
        isError: true,
      };
    }

    // Images are returned as attachments for the model to see natively;
    // offset/limit don't apply.
    if (isImagePath(filePath)) {
      try {
        const attachment = await loadImageAttachment(filePath);
        ctx.fileStateCache?.record(filePath, stat.mtimeMs);
        return {
          output: attachmentLabel(attachment),
          isError: false,
          images: [attachment],
        };
      } catch (err) {
        log.error({ err }, "tool operation failed");
        return {
          output: `Error reading image: ${asErrorString(err)}`,
          isError: true,
        };
      }
    }

    const offset = intArg(args, "offset", 0);
    const limit = intArg(args, "limit", 2000);

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const slice = lines.slice(offset, offset + limit);

      // Register the file as "read" in the state cache so subsequent
      // EditFile / WriteFile calls are allowed.
      ctx.fileStateCache?.record(filePath, stat.mtimeMs);

      const numbered = slice.map((line, i) => `${String(offset + i + 1)}\t${line}`);
      return {
        output: numbered.join("\n"),
        isError: false,
      };
    } catch (err) {
      log.error({ err }, "tool operation failed");
      return {
        output: `Error reading file: ${asErrorString(err)}`,
        isError: true,
      };
    }
  }
}
