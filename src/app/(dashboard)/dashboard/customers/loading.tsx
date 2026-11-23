export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 h-6 w-36 rounded bg-border/60" />
      <div className="mb-4 flex flex-wrap gap-2">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-6 w-24 rounded-full bg-border/50" />)}</div>
      <div className="mb-3 h-9 w-full max-w-xs rounded-md bg-border/50" />
      <div className="space-y-px overflow-hidden rounded-lg border border-border bg-surface">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3"><div className="h-8 w-8 rounded-full bg-border/60" /><div className="h-3 w-40 rounded bg-border/60" /><div className="ml-auto h-3 w-20 rounded bg-border/40" /></div>
        ))}
      </div>
    </div>
  );
}
