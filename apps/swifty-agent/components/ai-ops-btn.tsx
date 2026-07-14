"use client";
import { Layers } from "lucide-react";
interface AIOpsButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export default function AIOpsBtn({ onClick, disabled }: AIOpsButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full bg-green-500 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-green-600 opacity-50"
    >
      <Layers className="h-4 w-4" />
      <span>AI Ops</span>
    </button>
  );
}
