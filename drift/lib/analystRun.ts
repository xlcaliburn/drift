import "server-only";
import { getSession, setSession, persistSession, type SessionData } from "@/lib/state";
import { analyzeScene, type NpcAnalysis, type ItemAnalysis, type ThreadAnalysis } from "@/llm/summarizer";
import { isPlaceholderOneBreath } from "@/shared/scene";
import type { ChatEntry } from "@/shared/chat";

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
): Promise<boolean> {
  if (!npcUpdates.length && !itemUpdates.length && !threadUpdates.length) return false;
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
  }
  for (const it of itemUpdates) rt.grantSceneItem(it.name, it.note);

  // QUEST backstop: the analyst caught an objective the live turn's threads[] missed
  // (or an OPEN thread the scene finished) — reconcile it into the tracked threads.
  const { applyThreadUpdates } = await import("@/llm/threadReconcile");
  applyThreadUpdates(rt, threadUpdates);

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
    res = await analyzeScene(text + beatsNote, sceneNpcs, entityIds, openThreads);
  } catch (e) {
    console.error("[analyst] open-scene run failed:", e instanceof Error ? e.message : e);
    return false;
  }
  const changed = await applyAnalystUpdates(live, res.npcs, res.items, res.threads);
  setSession(campaignId, live);
  if (changed) await persistSession(campaignId, live);
  return changed;
}
