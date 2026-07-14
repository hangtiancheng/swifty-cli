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
