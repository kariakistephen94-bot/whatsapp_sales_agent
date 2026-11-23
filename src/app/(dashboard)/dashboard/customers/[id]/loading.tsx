export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4 h-4 w-24 rounded bg-border/50" />
      <div className="mb-6 flex items-center gap-4"><div className="h-12 w-12 rounded-full bg-border/60" /><div className="space-y-2"><div className="h-5 w-40 rounded bg-border/60" /><div className="h-3 w-32 rounded bg-border/40" /></div></div>
      <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-lg border border-border bg-surface" />)}</div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 rounded-lg border border-border bg-surface" />)}</div>
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 rounded-lg border border-border bg-surface" />)}</div>
      </div>
    </div>
  );
}
