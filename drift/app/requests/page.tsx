import { redirect } from "next/navigation";

/** The review queue moved into the admin panel. */
export default function RequestsPage() {
  redirect("/admin/requests");
}
