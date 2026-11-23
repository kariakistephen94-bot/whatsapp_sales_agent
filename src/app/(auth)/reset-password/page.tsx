import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth-form";
import { getAuthUser } from "@/modules/auth/session";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  // Reaching this page requires the session created by the email link.
  if (!(await getAuthUser())) redirect("/login?error=" + encodeURIComponent("Your reset link has expired. Request a new one."));
  const { invite } = await searchParams;
  return <ResetPasswordForm invite={invite === "1"} />;
}

export const dynamic = "force-dynamic";
