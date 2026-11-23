"use client";
import { RouteError } from "@/components/commerce/shared";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="your catalog" reset={reset} />;
}
