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

import type { SlashCommand } from "../types";

interface SlashMenuProps {
  commands: SlashCommand[];
  cursor: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
}

export function SlashMenu({ commands, cursor, onSelect, onHover }: SlashMenuProps) {
  if (commands.length === 0) return null;
  return (
    <div className="absolute inset-x-0 bottom-full mb-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.3)]">
      {commands.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left ${
            i === cursor ? "bg-accent/10" : ""
          }`}
        >
          <span className="font-semibold whitespace-nowrap text-accent">/{cmd.name}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-dim">
            {cmd.description}
          </span>
        </button>
      ))}
    </div>
  );
}
