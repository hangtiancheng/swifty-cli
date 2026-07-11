interface UserMessageProps {
  content: string;
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="mb-4 leading-relaxed">
      <span className="font-bold text-accent">❯ </span>
      <span className="mt-1 inline whitespace-pre-wrap text-bright">{content}</span>
    </div>
  );
}
