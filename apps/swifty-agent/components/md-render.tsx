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

"use client";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

interface MdRenderProps {
  content: string;
  className?: string;
  /** True while the content is still being streamed in. */
  streaming?: boolean;
}

// Markdown renderer built on Streamdown (streaming-native react-markdown
// replacement): repairs unterminated markdown mid-stream, memoizes settled
// blocks, and syntax-highlights code with Shiki.
export default function MdRender({
  content,
  className,
  streaming = false,
}: MdRenderProps) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      caret="block"
      plugins={{ code }}
      shikiTheme={["github-light", "github-light"]}
      className={
        className ??
        "max-w-none text-sm leading-relaxed wrap-break-word text-zinc-800"
      }
    >
      {content}
    </Streamdown>
  );
}
