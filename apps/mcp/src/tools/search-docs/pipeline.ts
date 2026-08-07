import { logger } from "../../shared/logger.js";
import { splitMarkdownByHeader } from "./chunker.js";
import {
  deleteBySource,
  indexChunks,
  readSourceHashes,
  removeSourceHash,
  writeSourceHash,
  type IndexChunk,
} from "./indexer.js";
import type { SearchDocsContext } from "./redis-client.js";
import { scanDocsDir } from "./scanner.js";
import { sha256 } from "./utils.js";

export interface SyncStats {
  indexed: number;
  skipped: number;
  removed: number;
  failed: number;
  chunks: number;
}

/** Split a document into index chunks with deterministic ids (idempotent re-index). */
export function buildChunks(source: string, content: string): IndexChunk[] {
  const sourceHash = sha256(source);
  return splitMarkdownByHeader(content)
    .filter((part) => part.content.trim() !== "")
    .map((part, i) => ({
      id: `${sourceHash}:${String(i)}`,
      content: part.content,
      metadata: { _source: source, title: part.title },
    }));
}

/**
 * Incrementally sync the docs directory into the vector index:
 * - unchanged files (same content sha256 as the recorded one) are skipped,
 * - new/changed files are delete-then-reindexed under their _source,
 * - records of files deleted from disk are removed from the index.
 * Per-file failures are logged and skipped so one bad file never aborts the sync.
 */
export async function syncDocs(ctx: SearchDocsContext, docsDir: string): Promise<SyncStats> {
  const docs = await scanDocsDir(docsDir);
  const known = await readSourceHashes(ctx);
  const stats: SyncStats = { indexed: 0, skipped: 0, removed: 0, failed: 0, chunks: 0 };

  const seen = new Set<string>();
  for (const doc of docs) {
    seen.add(doc.source);
    const hash = sha256(doc.content);
    if (known.get(doc.source) === hash) {
      stats.skipped++;
      continue;
    }
    try {
      await deleteBySource(ctx, doc.source);
      const count = await indexChunks(ctx, buildChunks(doc.source, doc.content));
      await writeSourceHash(ctx, doc.source, hash);
      stats.indexed++;
      stats.chunks += count;
    } catch (err) {
      stats.failed++;
      logger.warn({ err, source: doc.source }, "failed to index document");
    }
  }

  for (const source of known.keys()) {
    if (seen.has(source)) {
      continue;
    }
    try {
      await deleteBySource(ctx, source);
      await removeSourceHash(ctx, source);
      stats.removed++;
    } catch (err) {
      stats.failed++;
      logger.warn({ err, source }, "failed to remove deleted document from index");
    }
  }

  logger.info({ docsDir, ...stats }, "docs sync complete");
  return stats;
}
