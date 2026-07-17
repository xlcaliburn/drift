import { redirect } from "next/navigation";
import { hasSupabase } from "@/lib/state";
import { getServiceClient, listCampaigns, type CampaignSummary } from "@/db/queries";
import { getAuthedUser, type AuthedUser } from "@/lib/auth";
import { factionBriefs } from "@/content/briefs";
import { MAX_CHARACTERS } from "@/shared/multiplayer";
import UserMenu from "@/components/UserMenu";
import LoadingLink from "@/components/LoadingLink";

const factionName = (id?: string) => factionBriefs.find((f) => f.factionId === id)?.name;

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
  // Roster cap: up to MAX_CHARACTERS LIVING characters (deceased don't count).
  // Admins may hold several (seeded/unowned worlds), so create stays available.
  const aliveCount = campaigns.filter((c) => c.status !== "deceased").length;
  const canCreate = aliveCount < MAX_CHARACTERS || user.role === "admin";

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
        <div className="mt-8">
          <LoadingLink
            href="/create"
            spinnerLabel="Opening creation…"
            className="block rounded-lg border border-accent/60 bg-accent/10 p-5 transition hover:bg-accent/20"
          >
            <div className="text-lg font-semibold text-accent">+ Create a character</div>
            <p className="mt-1 text-sm text-neutral-400">
              Join the shared universe — pick a faction, shape who you are, forge a signature skill.
            </p>
          </LoadingLink>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">
            {user.role === "admin" ? "Campaigns" : "Your characters"}
          </h2>
          <div className="mt-3 space-y-2">
            {campaigns.map((c) => (
              <LoadingLink
                key={c.id}
                href={`/play/${c.id}`}
                spinnerLabel="Entering the lanes…"
                className="block rounded-lg border border-edge bg-panel p-4 transition hover:border-accent"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-lg font-semibold">{c.name}</span>
                  <span
                    className={
                      "shrink-0 text-xs " + (c.status === "deceased" ? "text-bad" : "text-neutral-500")
                    }
                  >
                    {c.status === "deceased" ? "☠ deceased" : c.status}
                  </span>
                </div>
                {(factionName(c.factionId) || c.universeName) && (
                  <div className="mt-1 text-xs text-neutral-500">
                    {factionName(c.factionId) && (
                      <span className="text-accent/80">{factionName(c.factionId)}</span>
                    )}
                    {factionName(c.factionId) && c.universeName && " · "}
                    {c.universeName}
                  </div>
                )}
              </LoadingLink>
            ))}
          </div>
          {!canCreate && (
            <p className="mt-3 text-xs text-neutral-500">
              Roster full — {MAX_CHARACTERS} living characters is the cap. A slot frees when one falls.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
