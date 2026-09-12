import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCopy } from "@/hooks/use-copy";
import { focusRing } from "@/lib/styles";

export function CopyButton({
  value,
  className,
  label = "Copy",
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      aria-label={copied ? "Copied" : label}
      className={cn(
        "group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white",
        focusRing,
        className,
      )}
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : (
        <Copy className="h-4 w-4 transition-transform group-hover:scale-105" />
      )}
    </button>
  );
}

export function CommandBar({
  command,
  leading,
  className,
}: {
  command: string;
  leading?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shadow-soft flex items-center gap-2 rounded-2xl border border-zinc-200/90 bg-white/80 p-1.5 pl-2 backdrop-blur dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none",
        className,
      )}
    >
      {leading ? (
        <span className="hidden shrink-0 items-center rounded-xl bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-white sm:inline-flex dark:bg-white dark:text-zinc-950">
          {leading}
        </span>
      ) : null}
      <code className="flex-1 truncate px-1 font-mono text-[13px] text-zinc-700 dark:text-zinc-300">
        {command}
      </code>
      <CopyButton value={command} />
    </div>
  );
}
