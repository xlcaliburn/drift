import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/auth";
import CreateWizard from "@/components/CreateWizard";

/** Server gate for character creation; the wizard itself is a client component. */
export default async function CreatePage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");
  return <CreateWizard />;
}
