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
        className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-white/[0.03]"
      >
        <span
          className={`text-xs text-dim transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        {header}
      </button>
      {open && (
        <div className="max-h-[300px] overflow-y-auto border-t border-border px-3 py-2 text-xs whitespace-pre-wrap text-dim">
          {children}
        </div>
      )}
    </div>
  );
}
