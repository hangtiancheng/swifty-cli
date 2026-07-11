import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlashCommand } from '../types';
import { SlashMenu } from './slash-menu';

interface InputAreaProps {
  streaming: boolean;
  commands: SlashCommand[];
  onSend: (text: string) => void;
}

const MAX_TEXTAREA_HEIGHT = 200;

export function InputArea({ streaming, commands, onSend }: InputAreaProps) {
  const [value, setValue] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashCursor, setSlashCursor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const filtered = useMemo<SlashCommand[]>(() => {
    if (!value.startsWith('/') || value.includes(' ') || value.includes('\n')) {
      return [];
    }
    const prefix = value.slice(1).toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().startsWith(prefix));
  }, [value, commands]);

  useEffect(() => {
    setSlashOpen(filtered.length > 0);
    setSlashCursor(0);
  }, [filtered]);

  // Auto-grow the textarea up to MAX_TEXTAREA_HEIGHT.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger — when it changes we re-measure scrollHeight.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  // Focus on mount and whenever streaming flips back to false.
  useEffect(() => {
    if (!streaming) textareaRef.current?.focus();
  }, [streaming]);

  const selectSlash = (index: number) => {
    const cmd = filtered[index];
    if (!cmd) return;
    setValue(`/${cmd.name} `);
    setSlashOpen(false);
    textareaRef.current?.focus();
  };

  const send = () => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue('');
    setSlashOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashCursor((c) => Math.min(c + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        selectSlash(slashCursor);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="relative flex flex-shrink-0 items-end gap-2 border-t border-border px-4 py-3">
      {slashOpen && (
        <SlashMenu
          commands={filtered}
          cursor={slashCursor}
          onSelect={selectSlash}
          onHover={setSlashCursor}
        />
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
        rows={1}
        disabled={streaming}
        className="min-h-[42px] max-h-[200px] flex-1 resize-none rounded-md border border-border bg-input px-3 py-2.5 font-[inherit] text-sm leading-relaxed text-bright outline-none placeholder:text-dim focus:border-accent disabled:opacity-50"
      />
      <button
        type="button"
        onClick={send}
        disabled={streaming}
        className="cursor-pointer whitespace-nowrap rounded-md border-none bg-accent px-4 py-2.5 font-[inherit] text-sm font-semibold text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}
