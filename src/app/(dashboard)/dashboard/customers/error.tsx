"use client";
import { btn } from "@/components/ui";

export default function CustomersError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-10 text-center">
      <h2 className="text-sm font-medium">Couldn&apos;t load customers</h2>
      <p className="mt-1 text-sm text-muted">Something went wrong on our side. Please try again.</p>
      <button onClick={reset} className={`${btn} mt-4`}>Try again</button>
    </div>
  );
}
