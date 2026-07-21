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

import { type ReactNode, useState } from "react";

interface CollapsibleProps {
  header: ReactNode;
  children: ReactNode;
  /** Controlled open state; when omitted the component manages its own state. */
  defaultOpen?: boolean;
}

/**
 * Generic collapsible panel used by tool blocks and thinking blocks.
 * Pure Tailwind utilities — no custom CSS classes.
 */
export function Collapsible({ header, children, defaultOpen = false }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-tool">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-white/3"
      >
        <span
          className={`text-xs text-dim transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        {header}
      </button>
      {open && (
        <div className="max-h-75 overflow-y-auto border-t border-border px-3 py-2 text-xs whitespace-pre-wrap text-dim">
          {children}
        </div>
      )}
    </div>
  );
}
