"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/ai-calls", label: "AI Calls" },
  { href: "/admin/requests", label: "Requests" },
];

/** Admin section tab bar. Add a tab here + a page under app/admin/ to extend. */
export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="mt-6 flex gap-1 border-b border-edge">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              active
                ? "border-accent font-semibold text-accent"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
