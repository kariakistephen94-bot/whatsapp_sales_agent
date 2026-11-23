import "server-only";
import { db } from "@/server/db";

/** Service-role client: bypasses RLS. Server only — never import from client components. */
export const supabaseAdmin = db;
