"use client";
// Backend-free A2UI verification page: renders every shadcn extension
// component from a canned message set through the real catalog pipeline.
import { useCallback, useMemo, useState } from "react";
import A2uiView from "@/components/a2ui-view";
import { createGalleryMessages } from "./gallery-messages";

export default function GalleryPage() {
  const messages = useMemo(() => createGalleryMessages(), []);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const handleAction = useCallback((query: string) => {
    console.log("[gallery] action:", query);
    setLastAction(query);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">A2UI Catalog Gallery</h1>
      <p className="text-sm text-zinc-500">
        Renders all shadcn extension components from a mock message set — no backend required.
        Triggered actions are logged below and in the console.
      </p>
      {lastAction && (
        <pre className="overflow-x-auto rounded-lg bg-zinc-100 px-4 py-3 text-xs text-zinc-700">
          {lastAction}
        </pre>
      )}
      <A2uiView messages={messages} onAction={handleAction} />
    </div>
  );
}
