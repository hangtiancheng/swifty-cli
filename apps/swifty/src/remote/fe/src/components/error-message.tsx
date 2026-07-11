interface ErrorMessageProps {
  content: string;
}

export function ErrorMessage({ content }: ErrorMessageProps) {
  return <div className="mb-4 text-red">✖ {content}</div>;
}
