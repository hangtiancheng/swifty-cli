// Temporary smoke test for the A2UI extraction pipeline. Run with:
//   npx tsx scripts/a2ui-smoke.ts
import assert from "node:assert";

import { createA2uiStreamFilter, extractA2ui, parseA2uiBlock } from "../lib/ai/a2ui/extract";
import { A2UI_CLOSE_TAG, A2UI_OPEN_TAG, A2UI_PROMPT_SECTION } from "../lib/ai/a2ui/prompt";

// 1. Every few-shot example embedded in the prompt must pass validation.
const blockRe = new RegExp(
  `---BEGIN [A-Z_]+---\\n${A2UI_OPEN_TAG}\\n([\\s\\S]*?)\\n${A2UI_CLOSE_TAG}`,
  "g",
);
const exampleBlocks = [...A2UI_PROMPT_SECTION.matchAll(blockRe)].map((m) => m[1]);
assert.strictEqual(exampleBlocks.length, 3, "expected 3 few-shot examples in the prompt");
for (const [i, block] of exampleBlocks.entries()) {
  const result = parseA2uiBlock(block);
  assert.strictEqual(result.error, undefined, `example ${i} invalid: ${result.error ?? ""}`);
  assert.ok(result.messages && result.messages.length >= 3, `example ${i} too few messages`);
}
console.log("[1] all 3 few-shot examples validate OK");

// 2. Stream filter: text passes through, block is captured, across nasty chunk splits.
const innerJson = exampleBlocks[0];
const fullText = `Summary before.\n${A2UI_OPEN_TAG}${innerJson}${A2UI_CLOSE_TAG}\nAfter text.`;

function runChunked(chunks: string[]): { text: string; blocks: string[] } {
  const filter = createA2uiStreamFilter();
  let text = "";
  const blocks: string[] = [];
  for (const chunk of chunks) {
    const out = filter.push(chunk);
    if (out.text) text += out.text;
    blocks.push(...out.blocks);
  }
  text += filter.flush();
  return { text, blocks };
}

const chunkings: string[][] = [
  [fullText],
  fullText.match(/[\s\S]{1,7}/g) ?? [],
  fullText.match(/[\s\S]{1,1}/g) ?? [],
  [
    "Summary before.\n<a2u",
    "i-json>",
    innerJson.slice(0, 20),
    innerJson.slice(20),
    "</a2ui-js",
    "on>\nAfter text.",
  ],
];
for (const [i, chunks] of chunkings.entries()) {
  const { text, blocks } = runChunked(chunks);
  assert.strictEqual(
    text,
    "Summary before.\n\nAfter text.",
    `chunking ${i}: text mismatch: ${JSON.stringify(text)}`,
  );
  assert.strictEqual(blocks.length, 1, `chunking ${i}: expected 1 block`);
  assert.strictEqual(blocks[0], innerJson, `chunking ${i}: block content mismatch`);
}
console.log("[2] stream filter survives all chunk splits OK");

// 3. Partial opening tag that never completes must flush as plain text.
{
  const filter = createA2uiStreamFilter();
  const out = filter.push("value is a<2 and <a2u");
  assert.strictEqual(out.text, "value is a<2 and ");
  assert.strictEqual(filter.flush(), "<a2u");
}
// Unterminated block is returned by flush with the opening tag restored.
{
  const filter = createA2uiStreamFilter();
  filter.push(`hello ${A2UI_OPEN_TAG}[{"version":`);
  assert.ok(filter.flush().startsWith(A2UI_OPEN_TAG));
}
console.log("[3] flush semantics OK");

// 4. extractA2ui on full text (quick mode path).
{
  const r = extractA2ui(fullText);
  assert.strictEqual(r.error, undefined);
  assert.ok(r.messages && r.messages.length >= 3);
  assert.strictEqual(r.cleanText, "Summary before.\n\nAfter text.");
}
{
  const r = extractA2ui("plain markdown, no block");
  assert.strictEqual(r.messages, undefined);
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.cleanText, "plain markdown, no block");
}
{
  const r = extractA2ui(`before ${A2UI_OPEN_TAG}[{"version": "v0.9"`);
  assert.ok(r.error?.includes("never closed"));
  assert.strictEqual(r.cleanText, "before");
}
// Invalid protocol content must be rejected with a useful error.
{
  const r = parseA2uiBlock(`[{"version":"v0.8","createSurface":{"surfaceId":"x"}}]`);
  assert.ok(r.error, "expected schema error for wrong version");
}
{
  const r = parseA2uiBlock(
    `[{"version":"v0.9","updateComponents":{"surfaceId":"x","components":[]}}]`,
  );
  assert.ok(r.error, "expected schema error for empty components");
}
console.log("[4] extractA2ui + validation semantics OK");

console.log("ALL SMOKE TESTS PASSED");
