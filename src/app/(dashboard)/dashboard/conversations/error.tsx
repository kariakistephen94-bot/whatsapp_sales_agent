"use client";
import { btn } from "@/components/ui";

export default function ConversationsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-10 text-center">
      <h2 className="text-sm font-medium">Couldn&apos;t load your inbox</h2>
      <p className="mt-1 text-sm text-muted">Something went wrong on our side. Your messages are safe.</p>
      <button onClick={reset} className={`${btn} mt-4`}>Try again</button>
    </div>
  );
}
