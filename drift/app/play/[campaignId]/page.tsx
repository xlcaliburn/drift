import { notFound, redirect } from "next/navigation";
import PlayClient from "@/components/PlayClient";
import { getAuthedUser, canAccessCampaign, isDevUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";

export default async function Page({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;

  const user = await getAuthedUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");

  // Ownership check via a cheap indexed select (full state loads client-side).
  // Keyless dev: no DB, the in-memory session has no owner — skip.
  let roster: { id: string; name: string; status: string }[] = [];
  if (hasSupabase() && !isDevUser(user)) {
    const { getServiceClient, getCampaignOwner, listCampaigns } = await import("@/db/queries");
    const owner = await getCampaignOwner(getServiceClient(), campaignId);
    if (owner === null) {
      // Not in the DB: either it doesn't exist or it's an unpersisted in-memory
      // campaign — let the API's session-level ownership check decide.
    } else if (!canAccessCampaign(user, owner)) {
      notFound();
    }
    // The player's own characters, for the header's Switch menu (admins see only
    // their own here too — the full list lives in /admin).
    try {
      roster = (await listCampaigns(getServiceClient(), user.id)).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      }));
    } catch {
      /* menu simply hides */
    }
  }

  // key: switching characters must fully remount the client (fresh chat/state) —
  // App Router would otherwise reuse the component instance across /play/[id]s.
  return <PlayClient key={campaignId} campaignId={campaignId} roster={roster} />;
}
