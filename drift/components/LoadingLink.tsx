"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * A card/button link that shows a spinner the moment it's clicked, so slow
 * navigations (loading a campaign, opening creation) never look dead.
 */
export default function LoadingLink({
  href,
  className,
  children,
  spinnerLabel = "Loading…",
}: {
  href: string;
  className?: string;
  children: ReactNode;
  spinnerLabel?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={() => {
        if (loading) return;
        setLoading(true);
        router.push(href);
      }}
      className={`${className ?? ""} relative w-full text-left ${loading ? "cursor-wait opacity-80" : ""}`}
      aria-busy={loading}
    >
      {children}
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-ink/70 text-sm text-neutral-200">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-accent"
            aria-hidden
          />
          {spinnerLabel}
        </span>
      )}
    </button>
  );
}
