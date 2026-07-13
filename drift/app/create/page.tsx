import { redirect } from "next/navigation";
import { getAuthedUser, isDevUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";
import CreateWizard from "@/components/CreateWizard";

/** Server gate for character creation; the wizard itself is a client component. */
export default async function CreatePage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");

  // One character per player (for now): if they already have one, send them to
  // it instead of the wizard. Admins are exempt; keyless dev has no owner.
  if (hasSupabase() && !isDevUser(user) && user.role !== "admin") {
    const { getServiceClient, getOwnedCampaign } = await import("@/db/queries");
    const existing = await getOwnedCampaign(getServiceClient(), user.id);
    if (existing) redirect(`/play/${existing.id}`);
  }

  return <CreateWizard />;
}
