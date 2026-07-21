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
import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";

interface MdRenderProps {
  content: string;
  className?: string;
}

export default function MdRender({ content, className }: MdRenderProps) {
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs">
          {children}
        </pre>
      ),
      code: ({ className, children }) => {
        const text = String(children ?? "");
        const match = /language-(\w+)/.exec(className ?? "");
        // No language- class => inline code.
        if (!match) {
          return (
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">{children}</code>
          );
        }
        const lang = match[1];
        let html = text;
        try {
          html = hljs.getLanguage(lang)
            ? hljs.highlight(text, { language: lang }).value
            : hljs.highlightAuto(text).value;
        } catch {
          html = text;
        }
        return <code className={className} dangerouslySetInnerHTML={{ __html: html }} />;
      },
    }),
    [],
  );

  return (
    <div
      className={className ?? "max-w-none wrap-break-word text-sm leading-relaxed text-zinc-800"}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
