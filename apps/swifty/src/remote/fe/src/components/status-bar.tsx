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

interface StatusBarProps {
  connection: "connecting" | "connected" | "reconnecting";
  usage: { inputTokens: number; outputTokens: number } | null;
}

const CONNECTION_LABEL: Record<StatusBarProps["connection"], string> = {
  connecting: "Connecting...",
  connected: "Connected",
  reconnecting: "Reconnecting...",
};

export function StatusBar({ connection, usage }: StatusBarProps) {
  const dotColor =
    connection === "connected"
      ? "bg-green"
      : connection === "reconnecting"
        ? "bg-red"
        : "bg-yellow";
  const usageText = usage
    ? `In: ${formatTokensLocal(usage.inputTokens)} | Out: ${formatTokensLocal(usage.outputTokens)}`
    : "";

  return (
    <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-2 text-xs text-dim">
      <span className="text-sm font-bold text-accent">⚡ Swifty Remote</span>
      <div className="flex items-center gap-4">
        <span className="flex items-center">
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${dotColor}`} />
          {CONNECTION_LABEL[connection]}
        </span>
        {usageText && <span>{usageText}</span>}
      </div>
    </div>
  );
}

function formatTokensLocal(n: number): string {
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n > 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
