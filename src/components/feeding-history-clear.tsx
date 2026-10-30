"use client";
import { useRouter } from "next/navigation";
export function ClearFeedingHistoryFilters({ href }: { href: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="button secondary"
      onClick={(e) => {
        e.currentTarget.form?.reset();
        router.push(href);
      }}
    >
      Clear filters
    </button>
  );
}
