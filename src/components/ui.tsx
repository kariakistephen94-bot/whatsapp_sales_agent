import { cn } from "@/lib/utils";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface", className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>{action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {delta && <div className="mt-1 text-xs text-muted">{delta}</div>}
    </div>
  );
}

const tones: Record<string, string> = {
  green: "bg-success/10 text-success", red: "bg-danger/10 text-danger", amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400", gray: "bg-border/60 text-muted",
};
const toneFor = (s: string) =>
  /paid|completed|active|connected|returning|high value|booked/i.test(s) ? "green"
  : /cancel|no-show|escalated|out of stock|abandoned/i.test(s) ? "red"
  : /pending|processing|invited|unpaid|low|potential/i.test(s) ? "amber"
  : /new|confirmed|human/i.test(s) ? "blue" : "gray";

export function Badge({ children, tone }: { children: string; tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone ?? toneFor(children)])}>{children}</span>;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-border text-[11px] font-medium">{initials}</span>;
}

export const Table = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-x-auto rounded-lg border border-border bg-surface"><table className="rt w-full text-sm">{children}</table></div>
);
export const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={cn("border-b border-border px-4 py-2.5 text-left text-xs font-medium text-muted", right && "text-right")}>{children}</th>
);
export const Td = ({ children, right, className, label }: { children?: React.ReactNode; right?: boolean; className?: string; label?: string }) => (
  <td data-label={label} className={cn("border-b border-border/60 px-4 py-3 align-middle last:border-0", right && "text-right tabular-nums", className)}>{children}</td>
);

export const btn = "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-50";
export const btnPrimary = "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg hover:opacity-90";
export const inputCls = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40";
