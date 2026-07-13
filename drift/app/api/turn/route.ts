import { NextRequest, NextResponse } from "next/server";
import { runJsonTurn } from "@/llm/jsonTurn";
import { runCombatTurn } from "@/llm/combatTurn";
import { combatActions } from "@/shared/combat";
import { getSession, setSession, persistSession } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign, isDevUser } from "@/lib/auth";
import { getMonthUsage, checkBudget, recordTurnUsage } from "@/lib/usage";
import { recordAiCall } from "@/lib/audit";
import { TUTORIAL_GRADUATION_BEAT } from "@/shared/tutorial";
import { buildFallbackChoices } from "@/shared/recap";
import { CheckSpec, CombatActionSpec, type ChoiceOption } from "@/shared/turnPlan";

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
  // Check attached to the clicked choice (engine pre-rolls it). Invalid → ignored.
  const preCheck = body.check ? CheckSpec.safeParse(body.check).data : undefined;
  // Combat action from a clicked combat chip (routes through the combat engine).
  const combatAction = body.combatAction ? CombatActionSpec.safeParse(body.combatAction).data : undefined;
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

  // Death is permanent — a dead character can't act. Stakes are real.
  const pcNow = session.state.characters.find((c) => c.kind === "pc");
  if (pcNow && (pcNow.injuries ?? []).some((i) => i.name === "Dead")) {
    return NextResponse.json(
      { error: `${pcNow.name} is dead. This character's story has ended.` },
      { status: 409 },
    );
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

  // All gating passed → stream the turn as Server-Sent Events. The narrator
  // forwards narration deltas as they generate ("token" events); when the tool
  // loop finishes we persist + audit + meter, then emit the authoritative "done"
  // payload (state, events, choices, …) and close. Errors mid-turn become an
  // "error" event rather than a broken response.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        // Shared per-scene tick-cap set — mutated in place by the engine bridge,
        // persisted back after the turn, reset when a scene ends.
        const tickedSet = new Set(session.tickedThisScene);

        const common = {
          state: session.state,
          history: session.history,
          tickedSet,
          onDelta: (text: string) => send({ type: "token", text }),
          onEngine: (lines: string[]) => send({ type: "engine", lines }),
        };

        // Routing (tool loop retired — COMBAT.md D-7): a live fight + a combat
        // action runs the engine-owned combat round; everything else runs the
        // structured JSON turn (cinematic turns just use the pricier model there).
        const result =
          session.combat?.active && combatAction
            ? await runCombatTurn({ ...common, combat: session.combat, action: combatAction })
            : await runJsonTurn({
                ...common,
                playerText,
                focusIds: session.focusIds,
                preCheck,
                model: cinematic ? "claude-sonnet-5" : undefined,
              });

        // Combat owns the choices while active (engine-generated chips); otherwise
        // use the model's choices, falling back to generic actions if it gave none.
        const resultCombat = result.combat ?? null;
        const pcStims = result.state.characters.find((c) => c.kind === "pc")?.stims ?? 0;
        const normalized: ChoiceOption[] = result.choices.map((c) =>
          typeof c === "string" ? { label: c } : c,
        );
        const choices: ChoiceOption[] = resultCombat?.active
          ? combatActions(resultCombat, pcStims)
          : normalized.length === 0 && !result.sceneEnded
            ? buildFallbackChoices(result.state).map((label) => ({ label }))
            : normalized;

        // Engine display lines (dice/ticks/damage/payment/combat) — the handlers
        // return them pre-prefixed; they become system transcript lines so a
        // refresh shows the same mechanics seen live.
        const engineLineTexts = result.engineLines ?? [];
        const engineLines = engineLineTexts.map((text) => ({ role: "system" as const, text }));

        const transcriptAdds = [
          { role: "player" as const, text: playerText },
          ...engineLines,
          { role: "dm" as const, text: result.narration || "…" },
          ...(result.sceneEnded
            ? [{ role: "system" as const, text: "— scene ended · checklist applied —" }]
            : []),
          // One-time beat when the tutorial ends this turn. Persisted here so a
          // later refresh rehydrates it, and also emitted live in the done payload.
          ...(result.tutorialGraduated
            ? [{ role: "system" as const, text: TUTORIAL_GRADUATION_BEAT }]
            : []),
        ];

        // CANONICAL history — never feed raw model output back as context (one
        // prose-menu violation would become few-shot evidence for every later
        // turn). The user side carries the action + a compact engine summary;
        // the assistant side carries only the cleaned narration.
        const engineSummary = engineLineTexts.map((t) => t.replace(/^[^\w-]+\s*/, "")).slice(0, 8);
        const canonicalUser =
          `PLAYER: ${playerText}` +
          (engineSummary.length ? `\n[ENGINE: ${engineSummary.join(" · ")}]` : "");
        const updatedSession = {
          ...session,
          state: result.state,
          // Keep the last ~10 exchanges verbatim; older context is carried by scene
          // summaries. Smaller window = fewer input tokens every turn.
          history: [
            ...session.history,
            { role: "user" as const, content: canonicalUser },
            { role: "assistant" as const, content: result.narration || "…" },
          ].slice(-20),
          // Full display transcript is kept so a browser refresh rehydrates the chat.
          transcript: [...session.transcript, ...transcriptAdds].slice(-400),
          log: [...session.log, ...result.events].slice(-500),
          // Carry the entities named this turn into next turn's retrieval focus.
          focusIds: result.focusIds,
          // Per-scene tick cap (engine cleared the set if the scene ended).
          tickedThisScene: [...tickedSet],
          // Active fight (null when combat ended or never started).
          combat: resultCombat,
        };
        setSession(campaignId, updatedSession);

        // Persist durable state (HP, credits, rep, clocks, threads) AND the runtime
        // snapshot (transcript, history, dice log) so a refresh resumes this run.
        await persistSession(campaignId, updatedSession);

        // Audit every call (dev included; dev logs with a null user id). Best-effort.
        await recordAiCall({
          userId: isDevUser(auth.user) ? null : auth.user.id,
          campaignId,
          kind: "turn",
          model: result.model,
          latencyMs: result.telemetry.latencyMs,
          usage: result.usage,
          rounds: result.telemetry.rounds,
          toolCalls: result.telemetry.toolCalls,
          stopReason: result.telemetry.stopReason,
          fellBack: result.telemetry.fellBack,
          systemChars: result.telemetry.systemChars,
          // Full request fed to the model (system + context + history + action),
          // so the admin audit shows exactly what the API saw.
          prompt: result.promptDump,
          response: result.narration,
          exchange: result.exchangeDump,
        });

        // Meter the spend (best-effort; never blocks the response).
        if (!isDevUser(auth.user)) {
          await recordTurnUsage({
            userId: auth.user.id,
            campaignId,
            model: result.model,
            usage: result.usage,
          });
        }

        send({
          type: "done",
          narration: result.narration,
          events: result.events,
          state: result.state,
          worldEvents: result.worldEvents,
          choices,
          combat: resultCombat,
          sceneEnded: result.sceneEnded,
          tutorialGraduated: result.tutorialGraduated,
          model: result.model,
          usage: result.usage,
        });
      } catch (err) {
        console.error("turn error", err);
        send({ type: "error", error: err instanceof Error ? err.message : "narration failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
