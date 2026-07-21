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
interface LoadingOverlayProps {
  overlay: { show: boolean; text: string; subtext: string };
}

export default function LoadingOverlay({ overlay }: LoadingOverlayProps) {
  if (!overlay.show) return null;
  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/70 backdrop-blur">
      <div className="rounded-2xl bg-white/95 px-12 py-10 text-center shadow-2xl">
        <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-sky-200 border-t-sky-500" />
        <div className="text-lg font-semibold text-sky-600">{overlay.text}</div>
        <div className="mt-2 text-sm text-zinc-600">{overlay.subtext}</div>
      </div>
    </div>
  );
}
