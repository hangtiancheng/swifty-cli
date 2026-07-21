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

// Corresponds to knowledge_index_pipeline (orchestration.go, transformer.go).
// FileLoader → MarkdownHeaderSplitter → RedisIndexer
import { randomUUID } from "node:crypto";
import { loadFile } from "../loader";
import { indexChunks, deleteBySource, type IndexChunk } from "@/lib/redis/indexer";

interface MarkdownChunk {
  content: string;
  title: string;
}

// Split markdown by '#' headers (corresponds to markdown.HeaderSplitter with
// HeaderConfig { "#": "title" }, TrimHeaders: false — the header line is kept
// at the start of each chunk's content).
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
// _source, split by markdown headers, embed and insert (corresponds to
// buildIntoIndex in chat_v1_file_upload.go).
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
