"use client";
import { useActionState } from "react";
import Link from "next/link";
import { signInAction, signUpAction, forgotPasswordAction, updatePasswordAction, joinTeamAction, type AuthState } from "@/modules/auth/actions";

const input = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40";
const button = "rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60";

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="mb-6 text-sm font-semibold tracking-tight">WhatsApp AI Sales</div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Status({ state, initialError }: { state: AuthState; initialError?: string }) {
  const err = state?.error ?? initialError;
  if (err) return <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>;
  if (state?.message) return <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{state.message}</p>;
  return null;
}

export function AuthForm({ mode, next, initialError }: { mode: "login" | "register"; next?: string; initialError?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(mode === "login" ? signInAction : signUpAction, undefined);
  return (
    <Shell title={mode === "login" ? "Sign in" : "Create your workspace"} sub={mode === "register" ? "14-day free trial. No card required." : undefined}>
      <form action={formAction} className="flex flex-col gap-3">
        {mode === "register" && (<>
          <input name="name" placeholder="Your name" autoComplete="name" required className={input} />
          <input name="businessName" placeholder="Business name" autoComplete="organization" required className={input} />
        </>)}
        <input name="email" type="email" placeholder="Email" autoComplete="email" required className={input} />
        <input name="password" type="password" placeholder={mode === "register" ? "Password (min 8 characters)" : "Password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required className={input} />
        {next && <input type="hidden" name="next" value={next} />}
        <Status state={state} initialError={initialError} />
        <button disabled={pending} className={button}>{pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <div className="mt-4 flex justify-between text-sm text-muted">
        <Link href={mode === "login" ? "/register" : "/login"}>{mode === "login" ? "Create an account" : "Have an account? Sign in"}</Link>
        {mode === "login" && <Link href="/forgot-password">Forgot password?</Link>}
      </div>
    </Shell>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(forgotPasswordAction, undefined);
  return (
    <Shell title="Reset your password" sub="We'll email you a link to choose a new password.">
      <form action={formAction} className="flex flex-col gap-3">
        <input name="email" type="email" placeholder="Email" autoComplete="email" required className={input} />
        <Status state={state} />
        <button disabled={pending} className={button}>{pending ? "Sending…" : "Send reset link"}</button>
      </form>
      <Link href="/login" className="mt-4 block text-sm text-muted">Back to sign in</Link>
    </Shell>
  );
}

export function ResetPasswordForm({ invite }: { invite?: boolean }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(updatePasswordAction, undefined);
  return (
    <Shell title={invite ? "Set your password" : "Choose a new password"} sub={invite ? "You've been invited to a workspace. Pick a password to finish." : undefined}>
      <form action={formAction} className="flex flex-col gap-3">
        <input name="password" type="password" placeholder="New password (min 8 characters)" autoComplete="new-password" minLength={8} required className={input} />
        <input name="confirm" type="password" placeholder="Confirm password" autoComplete="new-password" minLength={8} required className={input} />
        <Status state={state} />
        <button disabled={pending} className={button}>{pending ? "Saving…" : "Save password"}</button>
      </form>
    </Shell>
  );
}

export function CheckEmail({ email }: { email?: string }) {
  return (
    <Shell title="Check your email" sub={`We sent a confirmation link to ${email || "your inbox"}. Open it on this device to finish setting up your workspace.`}>
      <p className="text-sm text-muted">Didn&apos;t get it? Check spam, or <Link href="/register" className="text-accent">try again</Link>.</p>
    </Shell>
  );
}

export function JoinTeamForm({ token, email, orgName }: { token: string; email: string; orgName: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(joinTeamAction, undefined);
  return (
    <Shell title={`Join ${orgName}`} sub="Set your name and a password to get started.">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input value={email} readOnly aria-label="Email" className={`${input} text-muted`} />
        <input name="name" placeholder="Your name" autoComplete="name" required className={input} />
        <input name="password" type="password" placeholder="Choose a password (min 8 characters)" autoComplete="new-password" minLength={8} required className={input} />
        <Status state={state} />
        <button disabled={pending} className={button}>{pending ? "Please wait…" : "Join team"}</button>
      </form>
      <div className="mt-4 text-sm text-muted"><Link href="/login?next=/dashboard">Already have an account? Sign in</Link></div>
    </Shell>
  );
}
