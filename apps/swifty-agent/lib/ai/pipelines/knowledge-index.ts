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

// Knowledge index pipeline: FileLoader → MarkdownHeaderSplitter → RedisIndexer
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadFile } from "../loader";
import { config } from "@/lib/config";
import { indexChunks, deleteBySource, type IndexChunk } from "@/lib/redis/indexer";

interface MarkdownChunk {
  content: string;
  title: string;
}

// Split markdown by '#' headers; the header line is kept at the start of
// each chunk's content.
function splitMarkdownByHeader(content: string): MarkdownChunk[] {
  const lines = content.split("\n");
  const chunks: MarkdownChunk[] = [];
  let title = "";
  let acc: string[] = [];

  const flush = () => {
    if (acc.length > 0) {
      chunks.push({ content: acc.join("\n"), title });
    }
  };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      flush();
      title = line.slice(2).trim();
      acc = [line];
    } else {
      acc.push(line);
    }
  }
  flush();
  return chunks;
}

// Build the knowledge index for a file: delete old records with the same
// _source, split by markdown headers, embed and insert.
export async function buildKnowledgeIndex(filePath: string): Promise<number> {
  const doc = await loadFile(filePath);
  await deleteBySource(doc.source);
  const parts = splitMarkdownByHeader(doc.content);
  const chunks: IndexChunk[] = parts.map((p) => ({
    id: randomUUID(),
    content: p.content,
    metadata: { _source: doc.source, title: p.title },
  }));
  return indexChunks(chunks);
}

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

// Index every supported document in the knowledge-base directory
// (config.fileDir). Called at server startup from instrumentation.ts.
// Per-file failures are logged and skipped so one bad file doesn't block
// the rest — or the server boot.
export async function indexDataDir(): Promise<void> {
  const dir = path.resolve(config.fileDir);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.warn(`[knowledge-index] data dir not found, skipping: ${dir}`);
    return;
  }

  const files = entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name);
  console.log(`[knowledge-index] indexing ${files.length} file(s) from ${dir}`);

  for (const file of files) {
    try {
      const count = await buildKnowledgeIndex(path.join(dir, file));
      console.log(`[knowledge-index] indexed ${file}: ${count} chunk(s)`);
    } catch (e) {
      console.error(`[knowledge-index] failed to index ${file}:`, e);
    }
  }
}
