import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/auth";

/** Holding page for signed-in accounts that aren't approved (yet, or anymore). */
export default async function PendingPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  if (user.status === "approved") redirect("/");

  const suspended = user.status === "suspended";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 pb-24">
      <h1 className="text-4xl font-bold tracking-tight text-accent">DRIFT</h1>
      <div className="mt-8 rounded-lg border border-edge bg-panel/50 p-6">
        <h2 className={`text-lg font-semibold ${suspended ? "text-bad" : "text-accent"}`}>
          {suspended ? "Account suspended" : "Awaiting approval"}
        </h2>
        <p className="mt-2 text-sm text-neutral-400">
          {suspended
            ? "Your account has been suspended. Talk to the game master if you think this is a mistake."
            : "You're signed in, but the game master hasn't approved your account yet. Check back soon."}
        </p>
        <p className="mt-4 text-xs text-neutral-500">Signed in as {user.email}</p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="rounded-lg border border-edge px-4 py-2 text-sm text-neutral-300 transition hover:border-accent"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
