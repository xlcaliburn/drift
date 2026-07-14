import { NextRequest, NextResponse, after } from "next/server";
import { runJsonTurn } from "@/llm/jsonTurn";
import { runCombatTurn } from "@/llm/combatTurn";
import { combatActions } from "@/shared/combat";
import { usableConsumables } from "@/shared/items";
import { getSession, setSession, persistSession } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign, isDevUser } from "@/lib/auth";
import { getMonthUsage, checkBudget, recordTurnUsage } from "@/lib/usage";
import { recordAiCall } from "@/lib/audit";
import { TUTORIAL_GRADUATION_BEAT } from "@/shared/tutorial";
import { buildFallbackChoices } from "@/shared/recap";
import { CheckSpec, CombatActionSpec, type ChoiceOption } from "@/shared/turnPlan";
import { freshSceneCard, type SceneCard, type SceneMemory } from "@/shared/scene";
import { summarizeScene } from "@/llm/summarizer";
import type { ChatEntry } from "@/shared/chat";
import { hasSupabase } from "@/lib/state";

/**
 * Background scene compression (CONTINUITY.md tier RECENT): summarize the closed
 * scene's transcript slice → persist to the scenes table → surface in the live
 * session's PREVIOUSLY list. Never blocks a turn; on summarizer failure a
 * deterministic fallback keeps the scene from becoming a hole (F-3).
 */
async function compressClosedScene(
  campaignId: string,
  closedCard: SceneCard,
  transcript: ChatEntry[],
  title: string,
  locationId: string | undefined,
  knownEntityIds: string[],
): Promise<void> {
  const slice = transcript.slice(closedCard.startTranscriptIdx);
  if (slice.length === 0) return;
  const text = slice
    .map((e) => `${e.role === "player" ? "PLAYER" : e.role.toUpperCase()}: ${e.text}`)
    .join("\n")
    .slice(0, 12000);
  const beatsNote = closedCard.beats.length ? `\nEstablished during the scene: ${closedCard.beats.join(" · ")}` : "";

  let summary = "";
  let entityRefs: string[] = [];
  try {
    const res = await summarizeScene(text + beatsNote, knownEntityIds);
    summary = res.summary.trim();
    entityRefs = res.entityRefs;
  } catch {
    /* fall through to the deterministic fallback */
  }
  if (!summary) {
    // F-3: never a hole — first action + last beat stand in for the summary.
    const firstPlayer = slice.find((e) => e.role === "player")?.text ?? "";
    const lastDm = [...slice].reverse().find((e) => e.role === "dm")?.text ?? "";
    summary = `${firstPlayer.slice(0, 140)} … ${lastDm.slice(0, 200)}`.trim();
    entityRefs = closedCard.presentNpcIds;
  }

  const scene: SceneMemory = {
    seq: closedCard.seq,
    title: title || `Scene ${closedCard.seq}`,
    summary,
    entityRefs: [...new Set([...entityRefs, ...closedCard.presentNpcIds])],
    locationId,
  };

  if (hasSupabase()) {
    try {
      const { getServiceClient, saveScene } = await import("@/db/queries");
      await saveScene(getServiceClient(), campaignId, scene);
    } catch (e) {
      console.error("[turn] failed to persist scene summary:", e instanceof Error ? e.message : e);
    }
  }
  // Surface in the LIVE session (re-read: turns may have advanced meanwhile).
  const live = await getSession(campaignId);
  if (live) {
    live.recentScenes = [...live.recentScenes.filter((s) => s.seq !== scene.seq), scene]
      .sort((a, b) => a.seq - b.seq)
      .slice(-20);
    setSession(campaignId, live);
  }
}

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
                // Scene memory (mutated in place by the runtime; session owns it).
                sceneCard: session.sceneCard,
                npcRelations: session.npcRelations,
                recentScenes: session.recentScenes,
                model: cinematic ? "claude-sonnet-5" : undefined,
              });

        // Combat owns the choices while active (engine-generated chips); otherwise
        // use the model's choices, falling back to generic actions if it gave none.
        const resultCombat = result.combat ?? null;
        const resultPc = result.state.characters.find((c) => c.kind === "pc");
        // Death ends the story immediately — this turn is the last one. No choices,
        // no fallbacks; the client goes terminal on the `dead` flag.
        const pcDied = !!resultPc && (resultPc.injuries ?? []).some((i) => i.name === "Dead");
        const burstReady = !!result.state.ship?.burstDriveReady;
        const normalized: ChoiceOption[] = result.choices.map((c) =>
          typeof c === "string" ? { label: c } : c,
        );
        const choices: ChoiceOption[] = pcDied
          ? []
          : resultCombat?.active
            ? combatActions(resultCombat, resultPc ? usableConsumables(resultPc, resultCombat.scale) : [], burstReady)
            : normalized.length === 0
              ? // No choices from the model (incl. right after a scene ends) → give
                // the player concrete next moves so they're never left with a
                // dead end. Derived from live state, free (no tokens).
                buildFallbackChoices(result.state).map((label) => ({ label }))
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
          ...(pcDied
            ? [{ role: "system" as const, text: `— ${resultPc!.name} is dead · this character's story ends here —` }]
            : result.sceneEnded
              ? [{ role: "system" as const, text: "— scene ended · time and pay settled · pick your next move below —" }]
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
        // On death the campaign is marked deceased — it stops counting as the
        // player's live campaign (create-gate ignores it), so they can start a
        // new character while the ended one stays visible as a memorial.
        const persistedState = pcDied
          ? { ...result.state, campaign: { ...result.state.campaign, status: "deceased" as const } }
          : result.state;
        const newTranscript = [...session.transcript, ...transcriptAdds].slice(-400);
        // Scene closed this turn → snapshot the card for the background summarizer
        // and start a fresh one at the new transcript tail (CONTINUITY lifecycle).
        const sceneClosed = result.sceneEnded && !pcDied;
        const closedCard = sceneClosed
          ? { ...session.sceneCard, presentNpcIds: [...session.sceneCard.presentNpcIds], beats: [...session.sceneCard.beats] }
          : null;
        const updatedSession = {
          ...session,
          state: persistedState,
          // Keep the last ~10 exchanges verbatim; older context is carried by scene
          // summaries. Smaller window = fewer input tokens every turn.
          history: [
            ...session.history,
            { role: "user" as const, content: canonicalUser },
            { role: "assistant" as const, content: result.narration || "…" },
          ].slice(-20),
          // Full display transcript is kept so a browser refresh rehydrates the chat.
          transcript: newTranscript,
          log: [...session.log, ...result.events].slice(-500),
          // Carry the entities named this turn into next turn's retrieval focus.
          focusIds: result.focusIds,
          // Per-scene tick cap (engine cleared the set if the scene ended).
          tickedThisScene: [...tickedSet],
          // Active fight (null when combat ended or never started).
          combat: resultCombat,
          sceneCard: sceneClosed
            ? freshSceneCard(session.sceneCard.seq + 1, newTranscript.length)
            : session.sceneCard,
        };
        setSession(campaignId, updatedSession);

        // Persist durable state (HP, credits, rep, clocks, threads) AND the runtime
        // snapshot (transcript, history, dice log) so a refresh resumes this run.
        await persistSession(campaignId, updatedSession);

        // Compress the closed scene in the background (never blocks the response).
        if (closedCard) {
          const knownIds = [
            ...result.state.npcs.map((n) => n.id),
            ...result.state.factions.map((f) => f.id),
            ...result.state.locations.map((l) => l.id),
          ];
          const locId = result.state.campaign.currentLocationId;
          const title = result.sceneTitle ?? `Scene ${closedCard.seq}`;
          after(() => compressClosedScene(campaignId, closedCard, newTranscript, title, locId, knownIds));
        }

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
          dead: pcDied,
          npcRelations: updatedSession.npcRelations,
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
