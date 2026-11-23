"use client";
import { compactNaira, formatNaira } from "@/lib/locale";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "hsl(var(--muted))", fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = { contentStyle: { background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 } };
const PALETTE = ["hsl(var(--accent))", "#6366f1", "#f59e0b", "#06b6d4", "#ec4899", "#94a3b8"];

/**
 * All money props here are in NAIRA (major units). The database stores kobo — convert with
 * `kobo / 100` on the server before passing data in.
 */
export function EmptyChart({ text = "No data for this period yet.", height = 240 }: { text?: string; height?: number }) {
  return <div style={{ height }} className="flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">{text}</div>;
}

export function RevenueArea({ data, height = 240 }: { data: { day: string; revenue: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: -10, right: 4, top: 4 }}>
        <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.25} /><stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="day" {...axis} /><YAxis {...axis} tickFormatter={(v) => compactNaira(v)} />
        <Tooltip {...tip} formatter={(v: number) => [formatNaira(v), "Revenue"]} />
        <Area type="monotone" dataKey="revenue" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MessagesBars({ data, height = 240 }: { data: { day: string; received: number; sent: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -10, right: 4, top: 4 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="day" {...axis} /><YAxis {...axis} />
        <Tooltip {...tip} cursor={{ fill: "hsl(var(--border) / 0.4)" }} />
        <Bar dataKey="received" name="Received" fill="hsl(var(--muted))" radius={[3, 3, 0, 0]} />
        <Bar dataKey="sent" name="Sent" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ShareDonut({ data, height = 220 }: { data: { name: string; value: number }[]; height?: number }) {
  return (
    <div className="flex items-center gap-4">
      <div className="shrink-0" style={{ width: Math.min(height, 160), height: Math.min(height, 160) }}><ResponsiveContainer width="100%" height="100%">
        <PieChart><Pie data={data} dataKey="value" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie><Tooltip {...tip} formatter={(v: number) => formatNaira(v)} /></PieChart>
      </ResponsiveContainer></div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate">{d.name}</span><span className="ml-auto pl-4 tabular-nums text-muted">{compactNaira(d.value)}</span></li>
        ))}
      </ul>
    </div>
  );
}

export function FunnelBars({ data }: { data: { stage: string; n: number }[] }) {
  const max = Math.max(1, data[0]?.n ?? 0);
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.stage}>
          <div className="mb-1 flex justify-between text-sm"><span>{d.stage}</span><span className="tabular-nums text-muted">{d.n} · {Math.round((Math.min(d.n, max) / max) * 100)}%</span></div>
          <div className="h-2 rounded-full bg-border/60"><div className="h-2 rounded-full bg-accent" style={{ width: `${(Math.min(d.n, max) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
