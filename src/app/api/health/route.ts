import { from, maybe } from "@/server/db";
import { workerOnline } from "@/server/heartbeat";

export const dynamic = "force-dynamic";

/** Liveness/readiness for the host's health check. 200 = web + database OK. `worker` is reported but doesn't fail the check. */
export async function GET() {
  try {
    await maybe(from("Plan").select("id").limit(1).maybeSingle());
  } catch {
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
  return Response.json({ ok: true, db: true, worker: await workerOnline() });
}
