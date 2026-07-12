import PlayClient from "@/components/PlayClient";

export default async function Page({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return <PlayClient campaignId={campaignId} />;
}
