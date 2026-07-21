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
import type { ChatHistory } from "@/hooks/use-chat";
import { Plus, X } from "lucide-react";

interface SidebarProps {
  histories: ChatHistory[];
  activeId: string;
  onNewChat: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function Sidebar({
  histories,
  activeId,
  onNewChat,
  onLoad,
  onDelete,
}: SidebarProps) {
  return (
    <aside className="flex w-56 flex-col border-r border-zinc-200 bg-sky-50">
      <div className="border-b border-zinc-200 px-3 py-2.5">
        <h2 className="text-sm font-semibold text-zinc-800">Swifty Agent</h2>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-zinc-800 transition hover:bg-blue-100"
        >
          <Plus className="h-4 w-4" />
          <span>New chat</span>
        </button>
        <div className="mt-2 flex-1 overflow-y-auto">
          <div className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent
          </div>
          <div className="flex flex-col gap-0.5">
            {histories.map((h) => (
              <div
                key={h.id}
                className={`group flex items-center rounded-md px-2.5 py-1.5 transition hover:bg-blue-100 ${
                  h.id === activeId ? "bg-blue-100" : ""
                }`}
              >
                <button
                  onClick={() => onLoad(h.id)}
                  className="flex-1 truncate text-left text-sm text-zinc-800"
                >
                  {h.title}
                </button>
                <button
                  onClick={() => onDelete(h.id)}
                  className="ml-1.5 text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
