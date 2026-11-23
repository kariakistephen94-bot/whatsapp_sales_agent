import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

const safeNext = (n: string | null | undefined) => (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") && !/[\r\n]/.test(n) ? n : "/dashboard");

/** Handles links from Supabase emails (confirm sign-up, reset password, invites). */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const next = safeNext(nextParam);
  const supabase = await supabaseServer();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  let error: string | null = null;
  if (code) error = (await supabase.auth.exchangeCodeForSession(code)).error?.message ?? null;
  else if (tokenHash && type) error = (await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error?.message ?? null;
  else error = "Missing code";

  if (error) {
    const to = new URL("/login", url.origin);
    to.searchParams.set("error", "That link is invalid or has expired. Sign in, or request a new link.");
    return NextResponse.redirect(to);
  }
  const dest = type === "recovery" ? "/reset-password" : type === "invite" ? "/reset-password?invite=1" : next;
  return NextResponse.redirect(new URL(dest, url.origin));
}
