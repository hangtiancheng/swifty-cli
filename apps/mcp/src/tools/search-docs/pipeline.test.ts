import { createClient } from "redis";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildChunks, syncDocs } from "./pipeline.js";
import type { SearchDocsContext } from "./redis-client.js";
import { sha256 } from "./utils.js";

const indexerMocks = vi.hoisted(() => ({
  deleteBySource: vi.fn<(ctx: unknown, source: string) => Promise<void>>(async () => undefined),
  indexChunks: vi.fn<(ctx: unknown, chunks: { id: string }[]) => Promise<number>>(
    async (_ctx, chunks) => chunks.length,
  ),
  readSourceHashes: vi.fn<() => Promise<Map<string, string>>>(async () => new Map()),
  removeSourceHash: vi.fn<(ctx: unknown, source: string) => Promise<void>>(async () => undefined),
  writeSourceHash: vi.fn<(ctx: unknown, source: string, hash: string) => Promise<void>>(
    async () => undefined,
  ),
}));

const scannerMocks = vi.hoisted(() => ({
  scanDocsDir: vi.fn<() => Promise<{ source: string; content: string }[]>>(async () => []),
}));

vi.mock("./indexer.js", () => indexerMocks);
vi.mock("./scanner.js", () => scannerMocks);

function makeCtx(): SearchDocsContext {
  return {
    // Never connected: syncDocs only forwards the context to (mocked) indexer functions.
    client: createClient(),
    embedder: {
      embedText: async () => [0],
      embedTexts: async (texts: string[]) => texts.map(() => [0]),
    },
    redis: { url: "redis://localhost:6379", indexName: "idx:test", keyPrefix: "test:" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  indexerMocks.readSourceHashes.mockResolvedValue(new Map());
  scannerMocks.scanDocsDir.mockResolvedValue([]);
});

describe("buildChunks", () => {
  it("assigns deterministic ids derived from the source", () => {
    const chunks = buildChunks("a.md", "# One\nx\n# Two\ny");
    const prefix = sha256("a.md");
    expect(chunks.map((c) => c.id)).toEqual([`${prefix}:0`, `${prefix}:1`]);
    expect(buildChunks("a.md", "# One\nx\n# Two\ny")).toEqual(chunks);
  });

  it("filters blank chunks and records source/title metadata", () => {
    const chunks = buildChunks("a.md", "\n\n# Title\nbody");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata).toEqual({ _source: "a.md", title: "Title" });
  });
});

describe("syncDocs", () => {
  it("indexes new files and records their content hash", async () => {
    const content = "# Doc\nhello";
    scannerMocks.scanDocsDir.mockResolvedValue([{ source: "new.md", content }]);

    const stats = await syncDocs(makeCtx(), "/docs");

    expect(indexerMocks.deleteBySource).toHaveBeenCalledWith(expect.anything(), "new.md");
    expect(indexerMocks.indexChunks).toHaveBeenCalledTimes(1);
    expect(indexerMocks.writeSourceHash).toHaveBeenCalledWith(
      expect.anything(),
      "new.md",
      sha256(content),
    );
    expect(stats).toEqual({ indexed: 1, skipped: 0, removed: 0, failed: 0, chunks: 1 });
  });

  it("skips files whose content hash is unchanged", async () => {
    const content = "# Same";
    scannerMocks.scanDocsDir.mockResolvedValue([{ source: "same.md", content }]);
    indexerMocks.readSourceHashes.mockResolvedValue(new Map([["same.md", sha256(content)]]));

    const stats = await syncDocs(makeCtx(), "/docs");

    expect(indexerMocks.deleteBySource).not.toHaveBeenCalled();
    expect(indexerMocks.indexChunks).not.toHaveBeenCalled();
    expect(stats.skipped).toBe(1);
  });

  it("removes index records for files deleted from disk", async () => {
    indexerMocks.readSourceHashes.mockResolvedValue(new Map([["gone.md", "stale-hash"]]));

    const stats = await syncDocs(makeCtx(), "/docs");

    expect(indexerMocks.deleteBySource).toHaveBeenCalledWith(expect.anything(), "gone.md");
    expect(indexerMocks.removeSourceHash).toHaveBeenCalledWith(expect.anything(), "gone.md");
    expect(stats.removed).toBe(1);
  });

  it("continues past per-file failures", async () => {
    scannerMocks.scanDocsDir.mockResolvedValue([
      { source: "bad.md", content: "# Bad" },
      { source: "good.md", content: "# Good" },
    ]);
    indexerMocks.indexChunks
      .mockRejectedValueOnce(new Error("embed exploded"))
      .mockResolvedValueOnce(1);

    const stats = await syncDocs(makeCtx(), "/docs");

    expect(stats.failed).toBe(1);
    expect(stats.indexed).toBe(1);
    expect(indexerMocks.writeSourceHash).toHaveBeenCalledTimes(1);
    expect(indexerMocks.writeSourceHash).toHaveBeenCalledWith(
      expect.anything(),
      "good.md",
      expect.any(String),
    );
  });
});
