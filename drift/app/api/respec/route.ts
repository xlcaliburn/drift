import { NextRequest, NextResponse } from "next/server";
import { getSession, setSession, persistSession } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign } from "@/lib/auth";
import { TurnRuntime } from "@/llm/engineBridge";
import { liveRng } from "@/engine";
import { Attributes } from "@/shared/schemas";
import { validateAttributes } from "@/shared/respec";
import { generateAppearance } from "@/llm/appearanceGen";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/respec — remake a character at Chrome's studio (Rook, ¢500). The
 * player may rename, REALLOCATE attributes (engine-validated within the creation
 * budget), and reshape their look. The engine owns the charge + the stat writes
 * (balance can't be gamed); afterward a short physical DESCRIPTION is generated
 * and shown in the Story tab. Refused off-Rook or when they can't afford it.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const campaignId = (body.campaignId ?? "").toString();
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : undefined;
  const appearanceHint = typeof body.appearanceHint === "string" ? body.appearanceHint.trim().slice(0, 400) : "";

  // Attributes are optional; when present they're validated for balance up front
  // (a clean 400 before any charge or LLM spend). The engine re-checks too.
  let attributes: ReturnType<typeof Attributes.parse> | undefined;
  if (body.attributes != null) {
    const parsed = Attributes.safeParse(body.attributes);
    if (!parsed.success) return NextResponse.json({ error: "invalid attributes" }, { status: 400 });
    const bal = validateAttributes(parsed.data);
    if (!bal.ok) return NextResponse.json({ error: bal.error }, { status: 400 });
    attributes = parsed.data;
  }

  if (!name && !attributes && !appearanceHint) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  const session = await getSession(campaignId);
  if (!session) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (!canAccessCampaign(auth.user, session.state.campaign.playerId)) {
    return NextResponse.json({ error: "Not your campaign." }, { status: 403 });
  }

  // Apply the deterministic remake (validate → charge → name/attributes/appearance).
  const rt = new TurnRuntime(session.state, liveRng);
  const res = rt.respec({ name, attributes, appearance: appearanceHint || undefined });
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });

  // Generate a polished physical description (best-effort; keep the raw hint on
  // failure so the Story tab always shows SOMETHING). No extra charge.
  const pc = rt.state.characters.find((c) => c.kind === "pc");
  if (pc) {
    try {
      const desc = await generateAppearance(pc, appearanceHint);
      if (desc) rt.setAppearance(desc);
    } catch (e) {
      console.error("[respec] appearance generation failed:", e instanceof Error ? e.message : e);
    }
  }

  const updated = { ...session, state: rt.state };
  setSession(campaignId, updated);
  await persistSession(campaignId, updated);

  const newPc = rt.state.characters.find((c) => c.kind === "pc");
  return NextResponse.json({ line: res.line, state: rt.state, appearance: newPc?.appearance ?? null });
}
