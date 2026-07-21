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

import type { PermissionItem, PermissionResponse } from "../types";

interface PermissionDialogProps {
  item: PermissionItem;
  onRespond: (id: string, response: PermissionResponse) => void;
}

const RESPONSE_OPTIONS: {
  value: PermissionResponse;
  label: string;
  className: string;
}[] = [
  {
    value: "allow",
    label: "Allow",
    className: "bg-green text-bg border-green",
  },
  {
    value: "allowAlways",
    label: "Allow Always",
    className: "text-blue border-blue",
  },
  { value: "deny", label: "Deny", className: "text-red border-red" },
];

export function PermissionDialog({ item, onRespond }: PermissionDialogProps) {
  return (
    <div className="my-3 rounded-lg border-2 border-yellow bg-surface p-4">
      <div className="mb-2 font-bold text-yellow">🔒 Permission Required: {item.toolName}</div>
      <div className="mb-3 whitespace-pre-wrap text-[13px] text-base">{item.description}</div>
      {item.responded ? (
        <div className="text-dim">🔒 Permission: {item.response}</div>
      ) : (
        <div className="flex gap-2">
          {RESPONSE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onRespond(item.id, opt.value)}
              className={`cursor-pointer rounded border px-4 py-1.5 font-[inherit] text-[13px] ${opt.className}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
