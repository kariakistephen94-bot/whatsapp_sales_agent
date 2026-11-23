export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-3 h-6 w-40 rounded bg-border/60" />
      <div className="grid h-[calc(100vh-8rem)] min-h-[520px] overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[300px_1fr_280px]">
        <div className="space-y-3 border-r border-border p-3">
          <div className="h-9 rounded bg-border/60" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex gap-3 py-1"><div className="h-8 w-8 rounded-full bg-border/60" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-border/60" /><div className="h-3 w-full rounded bg-border/40" /></div></div>
          ))}
        </div>
        <div className="hidden bg-bg lg:block" />
        <div className="hidden border-l border-border lg:block" />
      </div>
    </div>
  );
}
