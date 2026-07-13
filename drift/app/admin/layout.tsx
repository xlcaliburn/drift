import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/auth";
import UserMenu from "@/components/UserMenu";
import AdminTabs from "@/components/AdminTabs";

/** Admin shell: admin-only gate + tab nav. Tabs live in components/AdminTabs. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" || user.status !== "approved") redirect("/");

  return (
    <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-neutral-500 hover:text-accent">
            ← DRIFT
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-accent">Admin</h1>
        </div>
        <UserMenu user={user} />
      </div>
      <AdminTabs />
      <div className="mt-6">{children}</div>
    </main>
  );
}
