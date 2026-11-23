"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { rateLimit } from "@/server/rate-limit";

export type AuthState = { error?: string; message?: string } | undefined;

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const notConfigured = { error: "Supabase isn't configured yet. Add your Supabase keys to .env and restart the server." };

async function ip() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

// Supabase error messages are fine to show, except ones that reveal whether an account exists.
function friendly(msg: string) {
  if (/invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(msg)) return "Please confirm your email first. Check your inbox for the link.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a minute and try again.";
  return msg;
}

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  businessName: z.string().trim().min(2, "Enter your business name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!supabaseConfigured()) return notConfigured;
  const p = signUpSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!(await rateLimit(`signup:${await ip()}`, 5, 3600))) return { error: "Too many sign-ups from this network. Try again later." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: p.data.email,
    password: p.data.password,
    options: { data: { name: p.data.name, businessName: p.data.businessName }, emailRedirectTo: `${appUrl()}/auth/callback?next=/onboarding` },
  });
  if (error) return { error: friendly(error.message) };
  // Supabase returns a user with no identities when the email is already registered (no enumeration leak).
  if (data.user && data.user.identities?.length === 0) return { error: "An account with this email already exists. Try signing in." };
  if (!data.session) redirect(`/check-email?email=${encodeURIComponent(p.data.email)}`); // email confirmation is on
  redirect("/onboarding");
}

const signInSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export async function signInAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!supabaseConfigured()) return notConfigured;
  const p = signInSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!(await rateLimit(`login:${p.data.email}`, 10, 300))) return { error: "Too many attempts. Please wait a few minutes." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword(p.data);
  if (error) return { error: friendly(error.message) };
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !/[\r\n]/.test(next) ? next : "/dashboard");
}

export async function signOutAction() {
  if (supabaseConfigured()) await (await supabaseServer()).auth.signOut();
  redirect("/login");
}

export async function forgotPasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!supabaseConfigured()) return notConfigured;
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email" };
  if (!(await rateLimit(`reset:${await ip()}`, 5, 3600))) return { error: "Too many requests. Try again later." };
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${appUrl()}/auth/callback?next=/reset-password` });
  // Same message whether or not the account exists.
  return { message: "If an account exists for that email, we've sent a link to reset your password." };
}

export async function updatePasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!supabaseConfigured()) return notConfigured;
  const pw = String(form.get("password") ?? ""), confirm = String(form.get("confirm") ?? "");
  if (pw.length < 8) return { error: "Password must be at least 8 characters" };
  if (pw !== confirm) return { error: "Passwords don't match" };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: friendly(error.message) };
  redirect("/dashboard");
}

// ───────── Joining a team from a WhatsApp invite link ─────────

type InviteLookup = { id: string; email: string; organizationId: string; authUserId: string | null; expiresAt: Date | null; organization: { name: string } };

/** A valid (unaccepted, unexpired) invitation for this join token, or null. */
export async function findInviteByToken(token: string): Promise<{ email: string; orgName: string } | null> {
  const inv = await lookupInvite(token);
  return inv ? { email: inv.email, orgName: inv.organization.name } : null;
}

async function lookupInvite(token: string): Promise<InviteLookup | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { from, maybe } = await import("@/server/db");
  const inv = await maybe<InviteLookup>(
    from("Invitation").select("id, email, organizationId, authUserId, expiresAt, organization:Organization!inner(name)")
      .eq("token", token).is("acceptedAt", null).maybeSingle(),
  );
  if (!inv || (inv.expiresAt && inv.expiresAt.getTime() < Date.now())) return null;
  return inv;
}

const joinSchema = z.object({
  token: z.string(),
  name: z.string().trim().min(1, "Enter your name").max(100),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

/**
 * The WhatsApp link proves the invitee received it on the number the admin entered, so the account
 * is activated without an email round-trip. Existing accounts are asked to sign in instead (never overwritten).
 */
export async function joinTeamAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!supabaseConfigured()) return notConfigured;
  const p = joinSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!(await rateLimit(`join:${await ip()}`, 10, 3600))) return { error: "Too many attempts. Try again later." };

  const inv = await lookupInvite(p.data.token);
  if (!inv) return { error: "This invite link has expired or was already used. Ask your admin to send a new one." };

  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const admin = supabaseAdmin();
  const signInInstead = { error: `You already have an account with ${inv.email}. Sign in with it to join ${inv.organization.name}.` };

  if (inv.authUserId) {
    // Created by the email invite. Activate it only if nobody has used it yet.
    const { data } = await admin.auth.admin.getUserById(inv.authUserId);
    const u = data?.user;
    if (u && (u.last_sign_in_at || u.email?.toLowerCase() !== inv.email)) return signInInstead;
    if (u) {
      const { error } = await admin.auth.admin.updateUserById(u.id, { password: p.data.password, email_confirm: true, user_metadata: { ...u.user_metadata, name: p.data.name } });
      if (error) return { error: "Couldn't activate your account. Please try again." };
    }
  }
  if (!inv.authUserId || !(await admin.auth.admin.getUserById(inv.authUserId)).data?.user) {
    const { error } = await admin.auth.admin.createUser({ email: inv.email, password: p.data.password, email_confirm: true, user_metadata: { name: p.data.name } });
    if (error) return /already|registered|exists/i.test(error.message) ? signInInstead : { error: "Couldn't create your account. Please try again." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: inv.email, password: p.data.password });
  if (error) return { error: friendly(error.message) };
  redirect("/dashboard"); // first request accepts the invitation (membership + WhatsApp number)
}
