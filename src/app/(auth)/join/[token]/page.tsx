import Link from "next/link";
import { JoinTeamForm } from "@/components/auth-form";
import { findInviteByToken } from "@/modules/auth/actions";

export const dynamic = "force-dynamic";

/** Opened from the WhatsApp invite link. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInviteByToken(token);
  if (!inv) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-sm font-semibold tracking-tight">WhatsApp AI Sales</div>
          <h1 className="text-xl font-semibold tracking-tight">This invite link isn’t valid</h1>
          <p className="mt-2 text-sm text-muted">It may have expired or already been used. Ask your admin to send you a new invite.</p>
          <Link href="/login" className="mt-4 inline-block text-sm text-accent">Go to sign in</Link>
        </div>
      </div>
    );
  }
  return <JoinTeamForm token={token} email={inv.email} orgName={inv.orgName} />;
}
