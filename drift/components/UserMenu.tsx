import Link from "next/link";
import type { AuthedUser } from "@/lib/auth";

/**
 * Signed-in header strip: email, Admin link (admins), sign-out. Server
 * component — pages pass in the user they already fetched via getAuthedUser().
 * Hidden entirely in keyless dev (the stub user has id "dev").
 */
export default function UserMenu({ user }: { user: AuthedUser }) {
  if (user.id === "dev") return null;
  return (
    <div className="flex items-center gap-4 text-xs text-neutral-500">
      <span className="truncate">{user.email}</span>
      {user.role === "admin" && (
        <Link
          href="/admin"
          className="shrink-0 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 font-semibold text-accent transition hover:bg-accent/20"
        >
          Admin
        </Link>
      )}
      <form action="/auth/signout" method="post">
        <button type="submit" className="shrink-0 text-neutral-400 hover:text-accent">
          Sign out
        </button>
      </form>
    </div>
  );
}
