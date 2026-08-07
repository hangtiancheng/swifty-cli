export interface MarkdownChunk {
  content: string;
  title: string;
}

// Split markdown by top-level "# " headers; the header line is kept at the
// start of each chunk's content. Content before the first header becomes a
// chunk with an empty title; files without headers yield a single chunk.
export function splitMarkdownByHeader(content: string): MarkdownChunk[] {
  const lines = content.split("\n");
  const chunks: MarkdownChunk[] = [];
  let title = "";
  let acc: string[] = [];

  const flush = (): void => {
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
