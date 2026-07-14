/**
 * Scene memory (CONTINUITY.md) — the scene as the unit of memory.
 *
 * SceneCard  = tier NOW: engine-owned working memory for the current scene,
 *              rebuilt into every prompt. The model may only propose `situation`
 *              (overwrite) and `beats` (append, capped); everything else is
 *              engine-derived and cannot drift.
 * NpcRelation = tier CANON: the player's standing with one NPC — a CAMPAIGN-side
 *              overlay keyed by npc id (seed NPCs are universe-shared and must
 *              never be mutated per-player).
 */

export interface SceneCard {
  /** 1-based scene number for this campaign. */
  seq: number;
  /** Turns taken inside this scene (auto-close backstop reads this, D-1). */
  turnCount: number;
  /** NPC ids seen/used this scene — forced into retrieval every turn. */
  presentNpcIds: string[];
  /** Model-maintained one-liner: what is happening right now (overwrite). */
  situation: string;
  /** Model-appended micro-facts (promises/threats/agreements) made this scene. */
  beats: string[];
  /** Transcript index where this scene began — the summarizer's slice start. */
  startTranscriptIdx: number;
}

export interface NpcRelation {
  /** Who they are to the player: "estranged brother", "your handler". */
  relationship?: string;
  /** Engine-clamped standing, -3..+3 (model proposes ±1 nudges only). */
  disposition: number;
  /** Rolling one-line memory: what last happened between you (overwrite). */
  lastNote?: string;
  /** Scene seq of the last interaction. */
  lastSceneSeq?: number;
}

export type NpcRelations = Record<string, NpcRelation>;

/** A scene's compressed record (persisted to the scenes table). */
export interface SceneMemory {
  seq: number;
  title: string;
  summary: string;
  entityRefs: string[];
  locationId?: string;
}

/** Engine caps (F-2/F-4): the model can't grow these without bound. */
export const MAX_BEATS = 6;
export const MAX_BEAT_CHARS = 120;
export const MAX_SITUATION_CHARS = 200;
export const DISPOSITION_MIN = -3;
export const DISPOSITION_MAX = 3;
/** Auto-close backstop (D-1): force a scene boundary after this many turns. */
export const SCENE_TURN_CAP = 12;
/** How many recent scene summaries ride in every prompt (PREVIOUSLY block). */
export const RECENT_SCENES_IN_PROMPT = 3;

export function freshSceneCard(seq = 1, startTranscriptIdx = 0): SceneCard {
  return { seq, turnCount: 0, presentNpcIds: [], situation: "", beats: [], startTranscriptIdx };
}

const DISPOSITION_LABELS: Record<number, string> = {
  [-3]: "hostile",
  [-2]: "cold",
  [-1]: "wary",
  [0]: "neutral",
  [1]: "warm",
  [2]: "trusted",
  [3]: "ally",
};

export function dispositionLabel(d: number): string {
  const clamped = Math.max(DISPOSITION_MIN, Math.min(DISPOSITION_MAX, Math.round(d)));
  return DISPOSITION_LABELS[clamped] ?? "neutral";
}

/** The relation suffix rendered onto an NPC's context line (empty if default). */
export function relationSuffix(rel: NpcRelation | undefined): string {
  if (!rel) return "";
  const bits: string[] = [];
  if (rel.disposition !== 0 || rel.relationship || rel.lastNote) {
    bits.push(`${dispositionLabel(rel.disposition)} (${rel.disposition >= 0 ? "+" : ""}${rel.disposition})`);
  }
  if (rel.relationship) bits.push(rel.relationship);
  if (rel.lastNote) bits.push(`last: ${rel.lastNote}`);
  return bits.length ? ` [${bits.join(" · ")}]` : "";
}
