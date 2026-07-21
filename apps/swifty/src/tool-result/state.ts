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

export class ContentReplacementState {
  private seenIds = new Set<string>();
  private replacements = new Map<string, string>();

  record(toolUseId: string, original: string, replaced: string): void {
    this.seenIds.add(toolUseId);
    if (original !== replaced) {
      this.replacements.set(toolUseId, replaced);
    }
  }

  has(toolUseId: string): boolean {
    return this.seenIds.has(toolUseId);
  }

  getReplacement(toolUseId: string): string | undefined {
    return this.replacements.get(toolUseId);
  }

  clone(): ContentReplacementState {
    const c = new ContentReplacementState();
    for (const id of this.seenIds) {
      c.seenIds.add(id);
    }
    for (const [k, v] of this.replacements) {
      c.replacements.set(k, v);
    }
    return c;
  }

  size(): number {
    return this.seenIds.size;
  }
}
