import { NextRequest, NextResponse } from "next/server";
import { CreationInput } from "@/shared/multiplayer";
import { buildCharacterFromCreation } from "@/engine";
import { requireApprovedUser } from "@/lib/auth";
import { startPrewarm } from "@/lib/creationPrewarm";

export const runtime = "nodejs";

/**
 * POST /api/create/prewarm — best-effort background warm-up of the slow creation
 * AI pass. Fired by the client when the player leaves the questionnaire for the
 * signature step, so finalizeCreation is already running (and hopefully done) by
 * the time they submit /api/create. Never an error the client must handle: it
 * returns 202 on success and 204 on anything unusable.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;
  const user = auth.user;

  const body = await req.json().catch(() => null);

  let parsed = CreationInput.safeParse(body);
  // The signature (uniqueSkill) may be incomplete at prewarm time — the player is
  // still on the questionnaire→signature transition. If parse failed, retry with a
  // minimal valid placeholder signature (the key excludes uniqueSkill anyway, so
  // this placeholder never affects whether the eventual submit reuses this warm).
  if (!parsed.success && body && typeof body === "object") {
    parsed = CreationInput.safeParse({
      ...(body as Record<string, unknown>),
      uniqueSkill: {
        name: "",
        description: "",
        kind: "passive",
        passiveTargetType: "skill",
        passiveTarget: "piloting",
        passiveAmount: 1,
        usesPerScene: 1,
      },
    });
  }

  // Still invalid → nothing to warm. Prewarm is best-effort; don't make it an error.
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 204 });
  }

  const base = buildCharacterFromCreation(parsed.data, {
    id: "pc-prewarm",
    campaignId: "camp-prewarm",
  });

  startPrewarm(user.id, parsed.data, base);
  return NextResponse.json({ ok: true }, { status: 202 });
}
