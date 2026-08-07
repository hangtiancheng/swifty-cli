import { describe, expect, it } from "vitest";

import { splitMarkdownByHeader } from "./chunker.js";

describe("splitMarkdownByHeader", () => {
  it("splits on top-level headers and keeps the header line in the chunk", () => {
    const md = "# One\nalpha\n# Two\nbeta\ngamma";
    const chunks = splitMarkdownByHeader(md);
    expect(chunks).toEqual([
      { title: "One", content: "# One\nalpha" },
      { title: "Two", content: "# Two\nbeta\ngamma" },
    ]);
  });

  it("keeps preamble before the first header as an untitled chunk", () => {
    const md = "intro line\n\n# First\nbody";
    const chunks = splitMarkdownByHeader(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ title: "", content: "intro line\n" });
    expect(chunks[1].title).toBe("First");
  });

  it("ignores deeper headers (##) as split points", () => {
    const md = "# Top\n## Sub\ntext";
    expect(splitMarkdownByHeader(md)).toEqual([{ title: "Top", content: "# Top\n## Sub\ntext" }]);
  });

  it("returns a single untitled chunk for files without headers", () => {
    expect(splitMarkdownByHeader("plain text file")).toEqual([
      { title: "", content: "plain text file" },
    ]);
  });

  it("handles empty content", () => {
    expect(splitMarkdownByHeader("")).toEqual([{ title: "", content: "" }]);
  });
});
