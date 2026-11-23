import { PageSkeleton } from "@/components/commerce/shared";

export default function Loading() {
  return <PageSkeleton stats={4} rows={8} />;
}
