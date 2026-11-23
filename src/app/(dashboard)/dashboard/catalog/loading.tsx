import { PageSkeleton } from "@/components/commerce/shared";

export default function Loading() {
  return <PageSkeleton stats={0} rows={8} />;
}
