interface SystemMessageProps {
  content: string;
}

export function SystemMessage({ content }: SystemMessageProps) {
  return <div className="mb-4 text-[13px] whitespace-pre-wrap text-dim">{content}</div>;
}
