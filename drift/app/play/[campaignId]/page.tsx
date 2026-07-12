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
  if (hasSupabase() && !isDevUser(user)) {
    const { getServiceClient, getCampaignOwner } = await import("@/db/queries");
    const owner = await getCampaignOwner(getServiceClient(), campaignId);
    if (owner === null) {
      // Not in the DB: either it doesn't exist or it's an unpersisted in-memory
      // campaign — let the API's session-level ownership check decide.
    } else if (!canAccessCampaign(user, owner)) {
      notFound();
    }
  }

  return <PlayClient campaignId={campaignId} />;
}
