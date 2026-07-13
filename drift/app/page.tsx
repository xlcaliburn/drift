import Link from "next/link";
import { redirect } from "next/navigation";
import { hasSupabase } from "@/lib/state";
import { getServiceClient, listCampaigns, type CampaignSummary } from "@/db/queries";
import { getAuthedUser, type AuthedUser } from "@/lib/auth";
import UserMenu from "@/components/UserMenu";

// The campaign list is read from the DB per request — never statically cached.
export const dynamic = "force-dynamic";

async function getCampaigns(user: AuthedUser): Promise<CampaignSummary[]> {
  if (!hasSupabase()) return [];
  try {
    return await listCampaigns(getServiceClient(), user.id, {
      includeUnowned: user.role === "admin",
    });
  } catch {
    return [];
  }
}

export default async function Home() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");

  const campaigns = await getCampaigns(user);
  // One character per player (for now): only offer creation when they have none.
  // Admins may hold several (seeded/unowned worlds), so keep create available.
  const canCreate = campaigns.length === 0 || user.role === "admin";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-4xl font-bold tracking-tight text-accent">DRIFT</h1>
          <p className="mt-2 text-sm text-neutral-400">
            A brutal space-opera TTRPG. The engine rolls the dice; the narrator tells the story.
          </p>
        </div>
        <UserMenu user={user} />
      </div>

      {canCreate && (
        <Link
          href="/create"
          className="mt-8 block rounded-lg border border-accent/60 bg-accent/10 p-5 transition hover:bg-accent/20"
        >
          <div className="text-lg font-semibold text-accent">+ Create a character</div>
          <p className="mt-1 text-sm text-neutral-400">
            Join the shared universe — pick a faction, shape who you are, forge a signature skill.
          </p>
        </Link>
      )}

      {campaigns.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">
            {user.role === "admin" ? "Campaigns" : "Your character"}
          </h2>
          <div className="mt-3 space-y-2">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/play/${c.id}`}
                className="block rounded-lg border border-edge bg-panel p-4 transition hover:border-accent"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-lg font-semibold">{c.name}</span>
                  <span className="shrink-0 text-xs text-neutral-500">{c.status}</span>
                </div>
              </Link>
            ))}
          </div>
          {!canCreate && (
            <p className="mt-3 text-xs text-neutral-500">
              One character per player for now — continue yours above.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
