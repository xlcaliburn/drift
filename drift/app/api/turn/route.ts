import { NextRequest, NextResponse } from "next/server";
import { runTurn } from "@/llm/narrator";
import { getSession, setSession, persistSession } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign, isDevUser } from "@/lib/auth";
import { getMonthUsage, checkBudget, recordTurnUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/turn  { campaignId?, playerText }
 * Runs one narrator turn, services its tool calls through the engine, persists
 * the mutated state + history, and returns narration, the dice/event log, and
 * the updated state for the sidebar.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;

  if (!process.env.ANTHROPIC_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: "No narrator key set. Add DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY to .env.local to play." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const playerText: string = (body.playerText ?? "").toString().trim();
  const campaignId: string = (body.campaignId ?? "").toString();
  const cinematic: boolean = Boolean(body.cinematic);
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  }
  if (!playerText) {
    return NextResponse.json({ error: "playerText is required" }, { status: 400 });
  }

  const session = await getSession(campaignId);
  if (!session) {
    return NextResponse.json(
      { error: "Campaign not found. Create a character to begin." },
      { status: 404 },
    );
  }
  if (!canAccessCampaign(auth.user, session.state.campaign.playerId)) {
    return NextResponse.json({ error: "Not your campaign." }, { status: 403 });
  }

  // Hard monthly budget: block BEFORE spending tokens. (Two concurrent turns
  // can both pass — a one-turn overshoot is fine at playtest scale.)
  if (!isDevUser(auth.user)) {
    const month = await getMonthUsage(auth.user.id);
    const budget = checkBudget(auth.user, month);
    if (!budget.ok) {
      return NextResponse.json(
        { error: `Monthly budget reached (${budget.reason}). Ask the GM to raise your cap.` },
        { status: 402 },
      );
    }
  }

  try {
    const result = await runTurn({
      state: session.state,
      history: session.history,
      playerText,
      focusIds: session.focusIds,
      cinematic,
    });

    const transcriptAdds = [
      { role: "player" as const, text: playerText },
      { role: "dm" as const, text: result.narration || "…" },
      ...(result.sceneEnded
        ? [{ role: "system" as const, text: "— scene ended · checklist applied —" }]
        : []),
    ];

    setSession(campaignId, {
      ...session,
      state: result.state,
      // Keep the last ~10 exchanges verbatim; older context is carried by scene
      // summaries (M7). Smaller window = fewer input tokens every turn.
      history: [...session.history, ...result.newMessages].slice(-20),
      // Full display transcript is kept so a browser refresh rehydrates the chat.
      transcript: [...session.transcript, ...transcriptAdds].slice(-400),
      log: [...session.log, ...result.events].slice(-500),
      focusIds: session.focusIds,
    });

    // Persist durable state (HP, credits, rep, clocks, threads) to Supabase.
    await persistSession(campaignId, result.state);

    // Meter the spend (best-effort; never blocks the response).
    if (!isDevUser(auth.user)) {
      await recordTurnUsage({
        userId: auth.user.id,
        campaignId,
        model: result.model,
        usage: result.usage,
      });
    }

    return NextResponse.json({
      narration: result.narration,
      events: result.events,
      state: result.state,
      worldEvents: result.worldEvents,
      choices: result.choices,
      sceneEnded: result.sceneEnded,
      model: result.model,
      usage: result.usage,
    });
  } catch (err) {
    console.error("turn error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "narration failed" },
      { status: 500 },
    );
  }
}
