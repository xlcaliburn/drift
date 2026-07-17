import { redirect } from "next/navigation";
import { getAuthedUser, isDevUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";
import { MAX_CHARACTERS } from "@/shared/multiplayer";
import CreateWizard from "@/components/CreateWizard";

/** Server gate for character creation; the wizard itself is a client component. */
export default async function CreatePage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");

  // Roster cap: at MAX_CHARACTERS living characters, back to the picker instead
  // of the wizard. Admins are exempt; keyless dev has no owner.
  if (hasSupabase() && !isDevUser(user) && user.role !== "admin") {
    const { getServiceClient, countAliveCampaigns } = await import("@/db/queries");
    const alive = await countAliveCampaigns(getServiceClient(), user.id);
    if (alive >= MAX_CHARACTERS) redirect("/");
  }

  return <CreateWizard />;
}
