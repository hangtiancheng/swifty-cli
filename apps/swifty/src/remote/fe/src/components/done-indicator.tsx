interface DoneIndicatorProps {
  elapsed: number;
}

export function DoneIndicator({ elapsed }: DoneIndicatorProps) {
  return <div className="mt-1 text-xs text-dim">✻ Done in {elapsed.toFixed(1)}s</div>;
}
