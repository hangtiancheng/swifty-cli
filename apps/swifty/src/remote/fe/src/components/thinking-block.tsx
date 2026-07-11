import { Collapsible } from './collapsible';

interface ThinkingBlockProps {
  text: string;
  label: string;
  streaming?: boolean;
}

export function ThinkingBlock({
  text,
  label,
  streaming = false,
}: ThinkingBlockProps) {
  return (
    <Collapsible
      header={
        <span className="text-dim">
          {label}
          {streaming && <span className="animate-blink ml-1">▎</span>}
        </span>
      }
    >
      <span className="italic">{text || '(empty)'}</span>
    </Collapsible>
  );
}
