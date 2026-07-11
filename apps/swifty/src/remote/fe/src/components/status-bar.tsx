interface StatusBarProps {
  connection: 'connecting' | 'connected' | 'reconnecting';
  usage: { inputTokens: number; outputTokens: number } | null;
}

const CONNECTION_LABEL: Record<StatusBarProps['connection'], string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
};

export function StatusBar({ connection, usage }: StatusBarProps) {
  const dotColor =
    connection === 'connected'
      ? 'bg-green'
      : connection === 'reconnecting'
        ? 'bg-red'
        : 'bg-yellow';
  const usageText = usage
    ? `In: ${formatTokensLocal(usage.inputTokens)} | Out: ${formatTokensLocal(usage.outputTokens)}`
    : '';

  return (
    <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-2 text-xs text-dim">
      <span className="text-sm font-bold text-accent">⚡ Swifty Remote</span>
      <div className="flex items-center gap-4">
        <span className="flex items-center">
          <span
            className={`mr-1.5 inline-block h-2 w-2 rounded-full ${dotColor}`}
          />
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
