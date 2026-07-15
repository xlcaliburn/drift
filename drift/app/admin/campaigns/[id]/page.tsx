import CampaignEditor from "@/components/admin/CampaignEditor";

/** Thin server wrapper — the admin layout already gates admin-only. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignEditor campaignId={id} />;
}
