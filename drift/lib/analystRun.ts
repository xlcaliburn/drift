import "server-only";
import { getSession, setSession, persistSession, hasSupabase, type SessionData } from "@/lib/state";
import { analyzeScene, type NpcAnalysis, type ItemAnalysis, type ThreadAnalysis, type FactAnalysis, type SummaryTelemetry } from "@/llm/summarizer";
import { recordAiCall } from "@/lib/audit";
import { isPlaceholderOneBreath } from "@/shared/scene";
import { npcIsGone } from "@/llm/retrieval";
import type { ChatEntry } from "@/shared/chat";

/**
 * Record one analyst call into ai_calls (kind "summary") — the memory tier used
 * to be the system's only UNAUDITED model path, which is how a summarizer
 * epidemic silently junked 30-86% of scene summaries per campaign before a
 * player felt it. Best-effort like every audit write.
 */
export async function recordSummaryCall(
  campaignId: string,
  label: string,
  t: SummaryTelemetry,
  summary: string,
): Promise<void> {
  await recordAiCall({
    campaignId,
    kind: "summary",
    model: t.model,
    latencyMs: t.latencyMs,
    usage: t.usage,
    fellBack: t.fellBack,
    prompt: label,
    response: summary || undefined,
    error: t.error ?? (t.repaired ? "truncated (salvaged by jsonRepair)" : undefined),
  });
}

/**
 * Fold the scene analyst's NPC + item updates into a live session — register
 * figures the live turn MISSED (Yuri), refresh placeholder identities, enrich the
 * relationship logs, and grant flavor props. Runs everything through a TurnRuntime
 * so it reuses the engine's dedup / id-gen / caps, then writes the mutated slices
 * back onto the session. Returns whether anything changed. Shared by the scene-
 * close pass, the mid-scene interval, and the manual re-sync.
 */
export async function applyAnalystUpdates(
  live: SessionData,
  npcUpdates: NpcAnalysis[],
  itemUpdates: ItemAnalysis[],
  threadUpdates: ThreadAnalysis[] = [],
  factUpdates: FactAnalysis[] = [],
  /** The scene PLACE backstop (HANDOFF_PLAYTEST_POLISH_2.md) — the analyst's
   *  corrected `place`, applied ONLY if the live session's scene card is still
   *  the exact one this analysis was for (`expectedSeq`). A mid-scene pass
   *  expects the card it read; a scene-close pass expects the NEW carried-
   *  forward card (closedSeq + 1). Any other live seq means the session moved
   *  on while this ran in the background — drop it silently rather than
   *  stamp a place onto the wrong scene. */
  placeUpdate?: { place: string; expectedSeq: number },
): Promise<boolean> {
  const applyPlace = placeUpdate && live.sceneCard.seq === placeUpdate.expectedSeq;
  if (!npcUpdates.length && !itemUpdates.length && !threadUpdates.length && !factUpdates.length && !applyPlace) {
    return false;
  }
  const { TurnRuntime } = await import("@/llm/engineBridge");
  const { liveRng } = await import("@/engine");
  const { isPlausibleNpcName, isCollectiveName } = await import("@/shared/npcExtract");
  const rt = new TurnRuntime(live.state, liveRng, { sceneCard: live.sceneCard, npcRelations: live.npcRelations });

  for (const u of npcUpdates) {
    // Resolve to a known cast member — by id, else by name.
    const known =
      (u.id ? rt.state.npcs.find((n) => n.id === u.id) : undefined) ??
      (u.name ? rt.state.npcs.find((n) => n.name.toLowerCase() === u.name!.toLowerCase()) : undefined);
    let id: string | undefined = known?.id;
    if (known) {
      // Upgrade a thin/placeholder identity; never clobber real canon.
      if (u.oneBreath && isPlaceholderOneBreath(known.oneBreath)) rt.setNpcOneBreath(known.id, u.oneBreath, u.role);
    } else if (u.name && isPlausibleNpcName(u.name) && !isCollectiveName(u.name)) {
      // A figure the live turn missed — register it now. Someone PRESENT (Yuri) or
      // merely MENTIONED (Calvo, a named target): both join the cast, only PRESENT
      // ones are marked into Here & now.
      id = rt.registerNpc(u.name, u.oneBreath, u.role).id;
    }
    if (id && (u.note || u.relationship)) {
      rt.updateNpcRelation(id, { note: u.note ?? undefined, relationship: u.relationship ?? undefined });
    }
    if (id && u.presence === "present") rt.markPresent(id);
    // FATE backstop (shared/npcFate.ts): a death/permanent departure the scene
    // showed that no fight recorded (executed in narration, spaced, shipped off).
    // Only a KNOWN cast member (the summarizer already gates fate to trusted ids)
    // — the same write path combat uses, so canon can't disagree with itself.
    if (known && u.fate && !npcIsGone(known.status)) {
      const { markNpcFate } = await import("@/shared/npcFate");
      rt.state = markNpcFate(
        rt.state,
        rt.npcRelations,
        known.id,
        u.fate,
        u.fate === "dead" ? (u.note ?? "Died this scene.") : (u.note ?? "Gone for good — left this scene."),
        live.sceneCard.seq,
      );
    }
    // FACTION backstop (HANDOFF_NPC_CANON Task B): only a KNOWN cast member —
    // the summarizer already gates factionId to a real known faction id — and
    // set-once (rt.setNpcFaction no-ops if already pinned); an allegiance
    // CHANGE is a separate, unbuilt slice.
    if (known && u.factionId) rt.setNpcFaction(known.id, u.factionId);
  }
  for (const it of itemUpdates) rt.grantSceneItem(it.name, it.note);

  // PLACE backstop (HANDOFF_PLAYTEST_POLISH_2.md) — see the param doc above
  // for the seq guard. Self-heals a frozen `scene.place` within ANALYST_
  // INTERVAL turns, and corrects the carried-forward card at scene close.
  if (applyPlace) rt.sceneCard = { ...rt.sceneCard, place: placeUpdate!.place };

  // QUEST backstop: the analyst caught an objective the live turn's threads[] missed
  // (or an OPEN thread the scene finished) — reconcile it into the tracked threads.
  const { applyThreadUpdates } = await import("@/llm/threadReconcile");
  applyThreadUpdates(rt, threadUpdates);

  // FACTS backstop (CONTINUITY v2): the turn path under-fires `facts` (live data:
  // zero emitted across a 164-turn campaign), so the analyst is the ledger's real
  // writer — same capped/deduped fold as the live path.
  if (factUpdates.length) {
    const { applyFactUpdates } = await import("@/shared/facts");
    const next = applyFactUpdates(live.facts ?? [], factUpdates, live.state.campaign.tendaysElapsed ?? 0);
    live.facts.splice(0, live.facts.length, ...next);
  }

  live.state = rt.state;
  live.npcRelations = rt.npcRelations;
  live.sceneCard = rt.sceneCard;
  return true;
}

/** Turns since the scene opened at which the analyst runs mid-scene (before the
 *  12-turn auto-close cap), so a long scene doesn't lose context. */
export const ANALYST_INTERVAL = 10;

function sliceText(transcript: ChatEntry[], startIdx: number): string {
  return transcript
    .slice(startIdx)
    .map((e) => `${e.role === "player" ? "PLAYER" : e.role.toUpperCase()}: ${e.text}`)
    .join("\n")
    .slice(0, 12000);
}

/**
 * Run the analyst on the CURRENT (still-open) scene and fold its continuity updates
 * into the live session — WITHOUT closing the scene or writing a summary. Used by
 * the mid-scene interval and the manual re-sync so figures/relations are picked up
 * before the scene ever closes. Best-effort; returns whether anything changed.
 */
export async function runOpenSceneAnalyst(campaignId: string): Promise<boolean> {
  const live = await getSession(campaignId);
  if (!live) return false;
  const slice = live.transcript.slice(live.sceneCard.startTranscriptIdx);
  if (slice.length < 3) return false; // too little has happened to analyze
  // Captured BEFORE the analyst call — the place backstop's seq guard (trap 1)
  // compares against this, not whatever live.sceneCard.seq happens to be by
  // the time the (possibly slow) call returns.
  const analyzedSeq = live.sceneCard.seq;
  const text = sliceText(live.transcript, live.sceneCard.startTranscriptIdx);
  const beatsNote = live.sceneCard.beats.length ? `\nEstablished so far: ${live.sceneCard.beats.join(" · ")}` : "";
  const entityIds = [
    ...live.state.factions.map((f) => f.id),
    ...live.state.locations.map((l) => l.id),
  ];
  const sceneNpcs = live.state.npcs
    .filter((n) => live.sceneCard.presentNpcIds.includes(n.id))
    .map((n) => ({ id: n.id, name: n.name, oneBreath: n.oneBreath }));
  const openThreads = live.state.threads
    .filter((t) => t.status !== "resolved")
    .map((t) => ({ id: t.id, title: t.title }));

  let res;
  try {
    res = await analyzeScene(text + beatsNote, sceneNpcs, entityIds, openThreads, {
      establishedFacts: (live.facts ?? []).map((f) => f.text),
      factions: live.state.factions.map((f) => ({ id: f.id, name: f.name })),
    });
  } catch (e) {
    console.error("[analyst] open-scene run failed:", e instanceof Error ? e.message : e);
    return false;
  }
  await recordSummaryCall(campaignId, `mid-scene analyst (scene ${live.sceneCard.seq})`, res.telemetry, res.summary);
  const changed = await applyAnalystUpdates(
    live,
    res.npcs,
    res.items,
    res.threads,
    res.facts,
    res.place ? { place: res.place, expectedSeq: analyzedSeq } : undefined,
  );
  setSession(campaignId, live);
  if (changed) await persistSession(campaignId, live);
  return changed;
}

/**
 * SELF-HEALING MEMORY (CONTINUITY): re-run the analyst over DEGRADED scene rows —
 * failed compressions that persisted as F-3 stubs but kept their raw transcript
 * slice (migration 026). A success replaces the stub with a real summary (and
 * folds in the NPC/thread updates the original failure dropped); a failure
 * leaves the row flagged for the next attempt. Bounded per run so a repair never
 * meaningfully delays the turn that piggybacks it. NOT retro-editing story: the
 * same transcript in, the same tier written — just a working compression of it.
 */
export async function repairDegradedScenes(campaignId: string, limit = 2): Promise<number> {
  if (!hasSupabase()) return 0;
  const live = await getSession(campaignId);
  if (!live) return 0;
  const { getServiceClient, listDegradedScenes, saveScene } = await import("@/db/queries");
  const db = getServiceClient();
  const queue = await listDegradedScenes(db, campaignId, limit);
  if (!queue.length) return 0;

  const entityIds = [...live.state.factions.map((f) => f.id), ...live.state.locations.map((l) => l.id)];
  const roster = live.state.npcs.map((n) => ({ id: n.id, name: n.name, oneBreath: n.oneBreath }));
  const openThreads = live.state.threads
    .filter((t) => t.status !== "resolved")
    .map((t) => ({ id: t.id, title: t.title }));

  let repaired = 0;
  for (const row of queue) {
    let res;
    try {
      res = await analyzeScene(row.rawSlice, roster, entityIds, openThreads, {
        establishedFacts: (live.facts ?? []).map((f) => f.text),
        factions: live.state.factions.map((f) => ({ id: f.id, name: f.name })),
      });
    } catch (e) {
      console.error(`[analyst] repair of scene ${row.seq} failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    await recordSummaryCall(campaignId, `scene ${row.seq} repair (was degraded)`, res.telemetry, res.summary);
    if (!res.summary.trim()) continue; // still failing — stays flagged for next time

    const scene = {
      seq: row.seq,
      title: row.title || `Scene ${row.seq}`,
      summary: res.summary.trim(),
      entityRefs: res.entityRefs,
      locationId: row.locationId,
      degraded: false,
    };
    try {
      await saveScene(db, campaignId, scene); // healthy save clears flag + raw_slice
    } catch (e) {
      console.error(`[analyst] repair persist of scene ${row.seq} failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    // Reflect the healed summary in the live PREVIOUSLY list, and fold in the
    // continuity updates the original failed run never delivered.
    live.recentScenes = live.recentScenes.map((s) => (s.seq === scene.seq ? scene : s));
    await applyAnalystUpdates(live, res.npcs, res.items, res.threads, res.facts);
    repaired++;
  }
  if (repaired > 0) {
    setSession(campaignId, live);
    await persistSession(campaignId, live);
    console.info(`[analyst] repaired ${repaired} degraded scene summar${repaired === 1 ? "y" : "ies"} for ${campaignId}`);
  }
  return repaired;
}
