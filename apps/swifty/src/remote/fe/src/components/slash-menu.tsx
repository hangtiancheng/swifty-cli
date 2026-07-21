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
