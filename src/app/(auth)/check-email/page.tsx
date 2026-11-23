import { CheckEmail } from "@/components/auth-form";

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return <CheckEmail email={email} />;
}
