import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";

export const runtime = "nodejs";

export interface AdminCampaignRow {
  id: string;
  name: string;
  characterName: string | null;
  status: string;
  playerEmail: string | null;
  playerName: string | null;
  universeName: string | null;
  lastPlayed: string | null;
}

/** GET /api/admin/campaigns — every campaign, joined to its player + last-played,
 *  for the admin editor list. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!hasSupabase()) return NextResponse.json({ campaigns: [] });

  const { getServiceClient } = await import("@/db/queries");
  const db = getServiceClient();

  const { data, error } = await db
    .from("campaigns")
    .select(
      "id,name,status,profiles(email,display_name),characters(name,kind),universes(name),campaign_runtime(updated_at)",
    )
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const campaigns: AdminCampaignRow[] = (data ?? []).map((c) => {
    const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    const uni = Array.isArray(c.universes) ? c.universes[0] : c.universes;
    const rt = Array.isArray(c.campaign_runtime) ? c.campaign_runtime[0] : c.campaign_runtime;
    const chars = (c.characters ?? []) as { name: string; kind: string }[];
    const pcName = chars.find((x) => x.kind === "pc")?.name ?? chars[0]?.name ?? null;
    return {
      id: String(c.id),
      name: String(c.name),
      characterName: pcName,
      status: String(c.status),
      playerEmail: prof ? String((prof as { email?: string }).email ?? "") || null : null,
      playerName: prof ? (prof as { display_name?: string }).display_name ?? null : null,
      universeName: uni ? String((uni as { name?: string }).name ?? "") || null : null,
      lastPlayed: rt ? (rt as { updated_at?: string }).updated_at ?? null : null,
    };
  });

  return NextResponse.json({ campaigns });
}
