import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getSession, setSession, persistSession, hasSupabase, type SessionData } from "@/lib/state";
import { AdminOp, applyAdminOp } from "@/shared/adminEdit";

export const runtime = "nodejs";

/** GET /api/admin/campaigns/[id] — the live, editable session slices. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;

  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  // Freshest last-played, for the "active Ns ago" mid-turn-race warning.
  let updatedAt: string | null = null;
  if (hasSupabase()) {
    const { getServiceClient } = await import("@/db/queries");
    const { data } = await getServiceClient().from("campaign_runtime").select("updated_at").eq("campaign_id", id).maybeSingle();
    updatedAt = (data?.updated_at as string) ?? null;
  }

  return NextResponse.json({
    state: session.state,
    sceneCard: session.sceneCard,
    npcRelations: session.npcRelations,
    combat: session.combat,
    lastChoices: session.lastChoices,
    recentScenes: session.recentScenes,
    transcriptTail: session.transcript.slice(-24),
    updatedAt,
  });
}

/** PATCH /api/admin/campaigns/[id] { op, visible? } — apply one admin edit through
 *  the session store (so it sticks even for a warm session), then run the targeted
 *  DB follow-ups an upsert-only persist can't express. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = AdminOp.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid edit", issues: parsed.error.flatten() }, { status: 400 });
  }
  const visible = body?.visible !== false; // default: show the player a ⚙ GM line

  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  let result;
  try {
    result = applyAdminOp(session, parsed.data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "edit failed" }, { status: 400 });
  }

  // Transcript note so the intervention is transparent to the player (opt-out).
  const transcript = visible
    ? [...result.slices.transcript, { role: "system" as const, text: `⚙ GM: ${result.summary}` }].slice(-400)
    : result.slices.transcript;
  const updated = { ...session, ...result.slices, transcript } as SessionData;

  setSession(id, updated);
  await persistSession(id, updated);

  // Follow-ups: deletes / column-clears / scene write that persistSession can't do.
  if (hasSupabase() && result.followups.length) {
    const { getServiceClient, deleteNpcsByIds, deleteThreadsByIds, deleteClocksByIds, clearCharacterDeathSaves, saveScene } =
      await import("@/db/queries");
    const db = getServiceClient();
    for (const f of result.followups) {
      try {
        if (f.kind === "deleteNpcs") await deleteNpcsByIds(db, f.ids);
        else if (f.kind === "deleteThreads") await deleteThreadsByIds(db, f.ids);
        else if (f.kind === "deleteClocks") await deleteClocksByIds(db, f.ids);
        else if (f.kind === "clearDeathSaves") await clearCharacterDeathSaves(db, f.characterId);
        else if (f.kind === "saveScene") await saveScene(db, id, f.scene);
      } catch (e) {
        console.error(`[admin] followup ${f.kind} failed for ${id}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  return NextResponse.json({ ok: true, summary: result.summary });
}
