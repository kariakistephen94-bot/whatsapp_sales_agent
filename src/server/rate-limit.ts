import { rpc } from "./db";

const mem = new Map<string, { n: number; reset: number }>();

/**
 * Fixed-window limiter stored in Supabase, so limits hold across every server instance.
 * Falls back to in-memory counting if Supabase can't be reached.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    return (await rpc<number>("app_rate_limit_hit", { p_key: key, p_window_seconds: windowSec })) <= limit;
  } catch {
    const now = Date.now();
    const e = mem.get(key);
    if (!e || e.reset < now) { mem.set(key, { n: 1, reset: now + windowSec * 1000 }); return true; }
    e.n++;
    return e.n <= limit;
  }
}
