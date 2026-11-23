import { from, run, maybe } from "./db";

const ID = "worker";

/** Worker side: call once; refreshes a timestamp row in Supabase. */
export function startHeartbeat() {
  const beat = () => run(from("WorkerHeartbeat").upsert({ id: ID, beatAt: new Date().toISOString() })).catch(() => {});
  void beat();
  return setInterval(beat, 10_000);
}

/** Web side: is a worker alive? (beat within the last 30 seconds) */
export async function workerOnline(): Promise<boolean> {
  try {
    const row = await maybe<{ beatAt: Date }>(from("WorkerHeartbeat").select("beatAt").eq("id", ID).maybeSingle());
    return !!row && Date.now() - row.beatAt.getTime() < 30_000;
  } catch { return false; }
}
