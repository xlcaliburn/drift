import { NextRequest, NextResponse, after } from "next/server";
import { runJsonTurn, TurnGenerationError } from "@/llm/jsonTurn";
import { runCombatTurn } from "@/llm/combatTurn";
import { runDownedTurn } from "@/llm/downedTurn";
import { runAppealTurn } from "@/llm/appealTurn";
import { isAppeal, stripAppeal } from "@/shared/appeal";
import { combatActions, interpretCombatText } from "@/shared/combat";
import { downedActions } from "@/shared/death";
import { usableConsumables, outOfCombatItemChips } from "@/shared/items";
import { repairQuote } from "@/engine/market";
import { patronHelp } from "@/shared/netWorth";
import { advanceLedger } from "@/shared/ledger";
import type { Dossier } from "@/shared/multiplayer";
import { acceptJob, abandonJob, generatePersonalJob } from "@/shared/quests";
import { resolveJobsTurn } from "@/shared/jobsRuntime";
import { personalJobAvailable, TRUST_THRESHOLD } from "@/shared/scene";
import { liveRng } from "@/engine/rng";
import { getSession, setSession, persistSession, loadReachableDossiers } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign, isDevUser } from "@/lib/auth";
import { getMonthUsage, checkBudget, recordTurnUsage } from "@/lib/usage";
import { recordAiCall } from "@/lib/audit";
import { TUTORIAL_GRADUATION_BEAT } from "@/shared/tutorial";
import { buildFallbackChoices } from "@/shared/recap";
import { CheckSpec, CombatActionSpec, DownedActionSpec, type ChoiceOption } from "@/shared/turnPlan";
import { carryScene, isSceneMove, type SceneCard, type SceneMemory } from "@/shared/scene";
import { analyzeScene, type NpcAnalysis, type ItemAnalysis } from "@/llm/summarizer";
import { applyAnalystUpdates, runOpenSceneAnalyst, ANALYST_INTERVAL } from "@/lib/analystRun";
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
  sceneNpcs: { id: string; name: string; oneBreath: string }[] = [],
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
  let npcUpdates: NpcAnalysis[] = [];
  let itemUpdates: ItemAnalysis[] = [];
  try {
    const res = await analyzeScene(text + beatsNote, sceneNpcs, knownEntityIds);
    summary = res.summary.trim();
    entityRefs = res.entityRefs;
    npcUpdates = res.npcs;
    itemUpdates = res.items;
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
  // Surface in the LIVE session (re-read: turns may have advanced meanwhile), and
  // fold the analyst's continuity updates into the live cast + relationship logs.
  const live = await getSession(campaignId);
  if (!live) return;
  live.recentScenes = [...live.recentScenes.filter((s) => s.seq !== scene.seq), scene]
    .sort((a, b) => a.seq - b.seq)
    .slice(-20);
  const changed = await applyAnalystUpdates(live, npcUpdates, itemUpdates);
  setSession(campaignId, live);
  if (changed) await persistSession(campaignId, live);
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
  // Desperate act from a clicked Bleeding Out chip (routes through death saves).
  const downedAction = body.downedAction ? DownedActionSpec.safeParse(body.downedAction).data : undefined;
  // Catalog id from a clicked "Use X" consumable chip (engine applies it deterministically).
  const useItemId = typeof body.useItemId === "string" && body.useItemId ? body.useItemId : undefined;
  // A clicked "Repair hull" dock chip (engine repairs deterministically).
  const preRepair = Boolean(body.repairHull);
  // A clicked "Rest up with <patron>" chip — the free early-game safety net (STARTER).
  const preRest = Boolean(body.patronRest);
  // Clicked job-board chips (QUESTS.md): accept an offered job / abandon an active one.
  const acceptJobId = typeof body.acceptJob === "string" && body.acceptJob ? body.acceptJob : undefined;
  const abandonJobId = typeof body.abandonJob === "string" && body.abandonJob ? body.abandonJob : undefined;
  // A trusted NPC's personal-favor chip (RELATIONSHIPS.md): their npc id.
  const acceptPersonalNpcId =
    typeof body.acceptPersonalJob === "string" && body.acceptPersonalJob ? body.acceptPersonalJob : undefined;
  // A clicked full-pack swap chip: the gear to drop, or "__decline__" to leave it.
  const preSwap = Boolean(body.swapDecline)
    ? "__decline__"
    : typeof body.swapDrop === "string" && body.swapDrop
      ? body.swapDrop
      : undefined;
  // The action came from a CLICKED choice (not typed). A clicked choice's check is
  // already decided and shown on the chip, so the model can't add a surprise roll.
  const fromChoice: boolean = Boolean(body.fromChoice);
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

  // Death is permanent — a dead character can't act. Stakes are real. (An APPEAL is
  // exempt: a player who believes they were wrongly killed can escalate it, and the
  // judge may overturn the death.)
  const pcNow = session.state.characters.find((c) => c.kind === "pc");
  if (pcNow && !isAppeal(playerText) && (pcNow.injuries ?? []).some((i) => i.name === "Dead")) {
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

      // Scene memory is mutated IN PLACE during the turn (turnCount, beats,
      // relations). Snapshot it so a failed turn rolls back cleanly — a retry
      // must start from exactly the state the player left off in.
      const memorySnapshot = {
        sceneCard: structuredClone(session.sceneCard),
        npcRelations: structuredClone(session.npcRelations),
        npcs: session.state.npcs,
      };
      // Pre-turn whereabouts, for scene-move detection after the turn. A move to a
      // new place/location is a scene boundary (CONTINUITY): the scene turns over.
      const prevPlace = memorySnapshot.sceneCard.place;
      const prevLoc = session.state.campaign.currentLocationId;
      // Combat turns never change place — only compute `moved` on the JSON path.
      const wasCombatTurn = !!session.combat?.active;
      try {
        // ── APPEAL: the player escalates a mechanical outcome to the strong judge
        //    (Sonnet). It's a META correction — handled regardless of combat/downed
        //    state — that applies engine-legal adjustments, then the player resumes
        //    from where they were (keep the last choices). Every appeal is audited.
        if (isAppeal(playerText)) {
          const appeal = await runAppealTurn({
            state: session.state,
            transcript: session.transcript,
            appealText: stripAppeal(playerText),
            sceneCard: session.sceneCard,
            npcRelations: session.npcRelations,
          });
          if (appeal.engineLines.length) send({ type: "engine", lines: appeal.engineLines });
          const appealAdds = [
            { role: "player" as const, text: playerText },
            ...appeal.engineLines.map((text) => ({ role: "system" as const, text })),
            { role: "dm" as const, text: appeal.ruling },
          ];
          const appealTranscript = [...session.transcript, ...appealAdds].slice(-400);
          const appealSession = {
            ...session,
            state: appeal.state,
            npcRelations: appeal.npcRelations,
            transcript: appealTranscript,
            history: [
              ...session.history,
              { role: "user" as const, content: `APPEAL: ${stripAppeal(playerText)}` },
              { role: "assistant" as const, content: `[Appeal ${appeal.granted ? "granted" : "denied"}] ${appeal.ruling}` },
            ].slice(-20),
          };
          setSession(campaignId, appealSession);
          await persistSession(campaignId, appealSession);
          await recordAiCall({
            userId: isDevUser(auth.user) ? null : auth.user.id,
            campaignId,
            kind: "appeal",
            model: appeal.model,
            latencyMs: appeal.latencyMs,
            usage: appeal.usage,
            prompt: appeal.promptDump,
            response: appeal.ruling,
            exchange: appeal.exchangeDump,
          });
          if (!isDevUser(auth.user)) {
            await recordTurnUsage({ userId: auth.user.id, campaignId, model: appeal.model, usage: appeal.usage });
          }
          send({
            type: "done",
            narration: appeal.ruling,
            events: [],
            state: appeal.state,
            worldEvents: [],
            choices: session.lastChoices ?? [],
            combat: session.combat,
            sceneEnded: false,
            dead: false,
            npcRelations: appealSession.npcRelations,
            sceneCard: session.sceneCard,
            tutorialGraduated: false,
            model: appeal.model,
            usage: appeal.usage,
          });
          return;
        }

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

        // A Downed PC (bleeding out) is its own engine-owned mode — like combat,
        // EVERY input runs a death save, so typing "I get up and run" can't skip
        // the dice. (Going down halts the fight, so combat is already inactive.)
        const pcDowned =
          !!pcNow && pcNow.hp <= 0 && (pcNow.injuries ?? []).some((i) => i.name === "Downed");

        // Routing (tool loop retired — COMBAT.md D-7): bleeding out → death saves;
        // a live fight + a combat action → engine-owned combat round; everything
        // else → the structured JSON turn (cinematic turns just use the pricier
        // model there). While a fight is live, EVERY input runs the combat round —
        // a clicked chip or free text mapped to an action. This is the security
        // boundary: typing "I gun them all down" can't skip the rolls/return fire.
        // Cross-player dossiers reachable this turn — hoisted out of the JSON branch
        // below so the post-turn ledger advance can promote anyone the player met.
        let reachedDossiers: Dossier[] = [];
        const result = pcDowned && !session.combat?.active
          ? await runDownedTurn({
              ...common,
              downedAction,
              playerText,
              sceneCard: session.sceneCard,
              npcRelations: session.npcRelations,
              model: cinematic ? "claude-sonnet-5" : undefined,
            })
          : session.combat?.active
          ? await (async () => {
              const combatPc = session.state.characters.find((c) => c.kind === "pc");
              const action =
                combatAction ??
                interpretCombatText(
                  playerText,
                  session.combat!,
                  combatPc ? usableConsumables(combatPc, session.combat!.scale) : [],
                  (combatPc?.gear ?? []).filter((g) => g.damage).map((g) => g.name),
                );
              return runCombatTurn({ ...common, combat: session.combat!, action, playerText });
            })()
          : await (async () => {
              // Cross-campaign cameos: other players' characters reachable in this
              // universe. Best-effort — a load failure never breaks a turn ([] in
              // keyless mode too). Only the non-combat JSON path needs them.
              const otherDossiers = await loadReachableDossiers(
                session.state.universe.id,
                campaignId,
              ).catch(() => []);
              reachedDossiers = otherDossiers; // hoisted for the post-turn ledger advance
              return runJsonTurn({
                ...common,
                playerText,
                focusIds: session.focusIds,
                preCheck,
                preUseItem: useItemId,
                preRepair,
                preRest,
                preSwap,
                fromChoice,
                // Scene memory (mutated in place by the runtime; session owns it).
                sceneCard: session.sceneCard,
                npcRelations: session.npcRelations,
                recentScenes: session.recentScenes,
                otherDossiers,
                jobs: session.jobs ?? [],
                ledger: session.playerLedger ?? {},
                model: cinematic ? "claude-sonnet-5" : undefined,
              });
            })();

        // Combat owns the choices while active (engine-generated chips); otherwise
        // use the model's choices, falling back to generic actions if it gave none.
        const resultCombat = result.combat ?? null;
        const resultPc = result.state.characters.find((c) => c.kind === "pc");
        // Death ends the story immediately — this turn is the last one. No choices,
        // no fallbacks; the client goes terminal on the `dead` flag.
        const pcDied = !!resultPc && (resultPc.injuries ?? []).some((i) => i.name === "Dead");

        // ── Job board (QUESTS.md): fold any accept/abandon click into the board,
        //    then advance active jobs from THIS turn's real signals (arrival, a won
        //    fight, a successful skill roll), pay out completions, and top the board
        //    back up. Engine-owned end to end — the payout math + rep are applied
        //    here (invariant intact); the mutated state/events/lines flow on. A
        //    fight that ended this turn with the PC standing satisfies eliminate/
        //    survive objectives.
        const combatResolvedAlive = wasCombatTurn && !resultCombat?.active && !pcDied;
        let jobsBoard = session.jobs ?? [];
        if (acceptJobId) jobsBoard = acceptJob(jobsBoard, acceptJobId);
        if (abandonJobId) jobsBoard = abandonJob(jobsBoard, abandonJobId);
        // A trusted NPC's personal favor (RELATIONSHIPS.md): generate their personal
        // job (their backstory want) straight to ACTIVE — it never lists on the public
        // board — and mark the arc started so it isn't re-offered.
        if (acceptPersonalNpcId && personalJobAvailable(session.npcRelations[acceptPersonalNpcId])) {
          const giverNpc = result.state.npcs.find((n) => n.id === acceptPersonalNpcId);
          const personal = giverNpc ? generatePersonalJob(giverNpc, result.state, liveRng, result.state.campaign.tendaysElapsed ?? 0) : null;
          if (personal) {
            jobsBoard = [...jobsBoard, personal];
            session.npcRelations[acceptPersonalNpcId] = {
              ...session.npcRelations[acceptPersonalNpcId],
              arcStage: "active",
            };
          }
        }
        const jobsRes = resolveJobsTurn({
          state: result.state,
          jobs: jobsBoard,
          events: result.events,
          combatResolvedAlive,
          rng: liveRng,
          npcRelations: session.npcRelations,
        });
        result.state = jobsRes.state; // credits + faction rep for any job paid out
        result.events = [...result.events, ...jobsRes.events];
        // Fold any personal-arc resolution back onto the live relations (mutated in
        // place by the turn) so the deepened bond persists + rides the done payload.
        session.npcRelations = jobsRes.npcRelations;

        // Bleeding Out is engine-owned end to end now (runDownedTurn resolves the
        // death saves), so the route only needs to detect the state for the chips:
        // a PC that's Downed & alive & out of combat is offered the desperate-act
        // menu — whether they just dropped in a fight (combat handed "Take stock")
        // or they're mid-sequence.
        const stillDowned =
          !!resultPc && !pcDied && !resultCombat?.active &&
          resultPc.hp <= 0 && (resultPc.injuries ?? []).some((i) => i.name === "Downed");

        const burstReady = !!result.state.ship?.burstDriveReady;
        const normalized: ChoiceOption[] = result.choices.map((c) =>
          typeof c === "string" ? { label: c } : c,
        );
        const choices: ChoiceOption[] = pcDied
          ? []
          : resultCombat?.active
            ? combatActions(
                resultCombat,
                resultPc ? usableConsumables(resultPc, resultCombat.scale) : [],
                burstReady,
                (resultPc?.gear ?? []).filter((g) => g.damage).map((g) => g.name),
              )
            : stillDowned
              ? // Bleeding Out — the engine-generated desperate-act chips (self-
                // rescue with a held stim, crawl for cover, call for help, hold on).
                downedActions(
                  resultPc ? usableConsumables(resultPc, "personal") : [],
                  session.sceneCard.presentNpcIds.some((id) => (session.npcRelations[id]?.disposition ?? 0) >= 1),
                )
              : [
                  // Full-pack SWAP chips FIRST when an item is parked (didn't fit):
                  // drop-to-take, or leave it — never a silent loss (ITEMS.md B).
                  ...(() => {
                    const pending = session.sceneCard.pendingPickup;
                    if (!pending || !resultPc) return [] as ChoiceOption[];
                    const drops: ChoiceOption[] = resultPc.gear
                      .slice(0, 6)
                      .map((g) => ({ label: `Drop ${g.name} → take ${pending.name}`, swapDrop: g.name }));
                    return [...drops, { label: `Leave ${pending.name} behind`, swapDecline: true }];
                  })(),
                  // Deterministic engine chips when they'd help — "Use X" (hurt →
                  // heal, damaged hull → patch, dry racks → reload) and a dock
                  // "Repair hull (¢X)" — so healing and repair are reliable clicks.
                  ...(resultPc ? outOfCombatItemChips(resultPc, result.state.ship) : []),
                  ...(() => {
                    const rq = repairQuote(result.state);
                    return rq ? [{ label: `Repair hull (¢${rq.cost})`, repairHull: true }] : [];
                  })(),
                  // The faction PATRON's free safety net (STARTER.md) — offered ONLY
                  // while the patron is actually PRESENT in the scene (not just
                  // "somewhere on the same station"), the player is still a
                  // struggling rookie (net worth < ¢600), AND they genuinely need it
                  // (hurt or under 2 stims). All three gate `eligible` in patronHelp.
                  ...(() => {
                    const { patron, eligible } = patronHelp(result.state, session.sceneCard.presentNpcIds);
                    return eligible && patron
                      ? [{ label: `Rest up with ${patron.name} (free)`, patronRest: true } as ChoiceOption]
                      : [];
                  })(),
                  // A trusted PRESENT NPC's personal favor (RELATIONSHIPS.md): the
                  // narrator raises their want (npcTiers section) and this chip lets
                  // the player take it on. One at a time; hidden once their arc starts.
                  ...(() => {
                    const giverId = session.sceneCard.presentNpcIds.find(
                      (id) =>
                        personalJobAvailable(session.npcRelations[id]) &&
                        !jobsRes.jobs.some((j) => j.giver === id),
                    );
                    if (!giverId) return [] as ChoiceOption[];
                    const npc = result.state.npcs.find((n) => n.id === giverId);
                    return npc && (session.npcRelations[giverId]?.disposition ?? 0) >= TRUST_THRESHOLD
                      ? [{ label: `Hear ${npc.name} out — take on their personal favor`, acceptPersonalJob: giverId } as ChoiceOption]
                      : [];
                  })(),
                  // Then the model's choices — or free next moves if it gave none
                  // (incl. right after a scene ends) so there's never a dead end.
                  ...(normalized.length === 0
                    ? buildFallbackChoices(result.state).map((label) => ({ label }))
                    : normalized),
                ];

        // Engine display lines (dice/ticks/damage/payment/combat) — the handlers
        // return them pre-prefixed; they become system transcript lines so a
        // refresh shows the same mechanics seen live.
        const engineLineTexts = [...(result.engineLines ?? []), ...jobsRes.lines];
        const engineLines = engineLineTexts.map((text) => ({ role: "system" as const, text }));

        const transcriptAdds = [
          { role: "player" as const, text: playerText },
          ...engineLines,
          { role: "dm" as const, text: result.narration || "…" },
          ...(pcDied
            ? [{ role: "system" as const, text: `— ${resultPc!.name} is dead · this character's story ends here —` }]
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
        // Did the player MOVE to a new place/location this turn? A move is a scene
        // boundary too — the memory tier turns over even though the model didn't fire
        // sceneEnd. (Only on the non-combat JSON path; combat never moves place. The
        // sceneCard was mutated in place by the turn, so it holds the post-turn place.)
        const moved =
          !wasCombatTurn &&
          isSceneMove(prevPlace, session.sceneCard.place, prevLoc, result.state.campaign.currentLocationId);
        // Scene closed this turn → snapshot the card for the background summarizer
        // and start a fresh one at the new transcript tail (CONTINUITY lifecycle).
        // A move closes the MEMORY tier only — it does NOT run the economic scene-end
        // checklist (wages/dock fees); that fires solely via the model's sceneEnd
        // (already handled inside the turn). Never carry mid-combat.
        const sceneClosed = (result.sceneEnded || moved) && !pcDied && !resultCombat?.active;
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
          // Carry whereabouts into the next scene so the sidebar never blanks (esp.
          // when the player hasn't actually moved); scene-specific state resets.
          sceneCard: sceneClosed ? carryScene(session.sceneCard, newTranscript.length) : session.sceneCard,
          // Retain the offered choices so a refresh restores them (not just combat).
          lastChoices: choices,
          // The job board after this turn's advance/payout/top-up (QUESTS.md).
          jobs: jobsRes.jobs,
          // Relationship ledger (MULTIPLAYER.md §2): promote to firsthand any reachable
          // cross-player character the GM actually brought into this scene (here-now +
          // named in the narration), so the cameo gate + Rolodex remember they've met.
          playerLedger: resultPc
            ? advanceLedger(
                session.playerLedger ?? {},
                { characterId: resultPc.id },
                reachedDossiers,
                result.narration ?? "",
                persistedState.campaign.currentLocationId,
              )
            : session.playerLedger ?? {},
        };
        setSession(campaignId, updatedSession);

        // Persist durable state (HP, credits, rep, clocks, threads) AND the runtime
        // snapshot (transcript, history, dice log) so a refresh resumes this run.
        await persistSession(campaignId, updatedSession);

        // Compress + ANALYZE the closed scene in the background (never blocks the
        // response). The analyst also refreshes NPC identities + relationship logs.
        if (closedCard) {
          const entityIds = [
            ...result.state.factions.map((f) => f.id),
            ...result.state.locations.map((l) => l.id),
          ];
          // NPCs that were actually present this scene — the analyst's roster.
          const sceneNpcs = result.state.npcs
            .filter((n) => closedCard.presentNpcIds.includes(n.id))
            .map((n) => ({ id: n.id, name: n.name, oneBreath: n.oneBreath }));
          const locId = result.state.campaign.currentLocationId;
          const title = result.sceneTitle ?? `Scene ${closedCard.seq}`;
          after(() => compressClosedScene(campaignId, closedCard, newTranscript, title, locId, entityIds, sceneNpcs));
        } else if (
          !resultCombat?.active &&
          session.sceneCard.turnCount > 0 &&
          session.sceneCard.turnCount % ANALYST_INTERVAL === 0
        ) {
          // A long scene that HASN'T closed yet (before the 12-turn cap): run the
          // analyst mid-scene in the background so figures/relations/items are picked
          // up without waiting for the close — no summary, just the continuity updates.
          after(() => runOpenSceneAnalyst(campaignId));
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
          sceneCard: updatedSession.sceneCard,
          jobs: updatedSession.jobs,
          tutorialGraduated: result.tutorialGraduated,
          model: result.model,
          usage: result.usage,
        });
      } catch (err) {
        console.error("turn error", err);
        // Roll back the in-place scene-memory mutations: the failed turn never
        // happened, so a retry resumes from exactly where the player left off.
        session.sceneCard = memorySnapshot.sceneCard;
        session.npcRelations = memorySnapshot.npcRelations;
        session.state.npcs = memorySnapshot.npcs;
        setSession(campaignId, session);
        const retryable = err instanceof TurnGenerationError;
        send({
          type: "error",
          retryable,
          error: retryable
            ? "The narrator glitched — nothing was saved and your action wasn't lost. Hit retry (or try again later)."
            : err instanceof Error
              ? err.message
              : "narration failed",
        });
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
