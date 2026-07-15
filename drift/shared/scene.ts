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
  /** Model-maintained whereabouts — where the player actually IS ("the black,
   *  aboard the Dust Eater"), which the fixed location table can't express (on a
   *  ship, in transit, in space). Persists across scenes until the player moves. */
  place?: string;
  /** Scene seq when `place` was last set/reaffirmed. The sidebar only shows `place`
   *  as the headline when this equals the current seq — otherwise it's stale from an
   *  earlier scene, so the accurate fixed location is shown instead. */
  placeSeq?: number;
  /** Model-appended micro-facts (promises/threats/agreements) made this scene. */
  beats: string[];
  /** ONGOING environmental dangers active right now ("toxic coolant fog") —
   *  model-overwritten; shown to the player and the narrator every turn. */
  dangers?: string[];
  /** Transcript index where this scene began — the summarizer's slice start. */
  startTranscriptIdx: number;
  /** A legit item that didn't fit the full pack (ITEMS.md slice B). Held here so
   *  the next turn can offer swap chips ("drop X to take it") instead of losing it.
   *  Cleared on swap / decline / a heal-the-pack move / scene end. */
  pendingPickup?: { name: string; itemId?: string; note?: string };
}

/** One dated beat in a relationship's history — how it actually developed. */
export interface RelationLogEntry {
  note: string;
  scene?: number;
}

/** How many history beats a relationship keeps (oldest trimmed first). */
export const MAX_RELATION_LOG = 8;

export interface NpcRelation {
  /** Who they are to the player: "estranged brother", "your handler". */
  relationship?: string;
  /** Engine-clamped standing, -3..+3 (model proposes ±1 nudges only). */
  disposition: number;
  /** Rolling one-line memory: what last happened between you (overwrite). */
  lastNote?: string;
  /** Accumulating history of notable beats (oldest→newest, capped) — so the
   *  relationship log shows how you MET and how things have gone since, not just
   *  the single last thing. Each meaningful note/standing-change appends here. */
  log?: RelationLogEntry[];
  /** Scene seq of the last interaction. */
  lastSceneSeq?: number;
  /** Does THIS player know the NPC by name yet? Per-player (name-knowledge is not
   *  shared even though the NPC entity is). Defaults to true for NPCs the player
   *  met by name; when false the UI shows the NPC's `role` handle instead. */
  nameKnown?: boolean;
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

/** Normalize a place string for move-comparison: lowercase, strip punctuation,
 *  collapse whitespace — so "Calvo's Docking Bay" and "calvo s docking bay" compare. */
export function normalizePlace(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Did the player MOVE to a new place this turn? A move is a SCENE boundary
 * (CONTINUITY): a new scene opens and the old crowd is left behind.
 *
 * - A station/location change (`newLoc` set and differing from `prevLoc`) is the
 *   reliable signal — always a move.
 * - Otherwise a genuinely different free-text place is a move: normalize both and
 *   require they differ AND neither contains the other. So "the fixer's stall" →
 *   "the Undertow bounty desk" IS a move, but a reword/elaboration
 *   ("docking bay" → "Calvo's docking bay") is NOT.
 * - First-set of a place, a re-affirmation, or empty inputs are NOT moves.
 */
export function isSceneMove(
  prevPlace: string | undefined,
  newPlace: string | undefined,
  prevLoc: string | undefined,
  newLoc: string | undefined,
): boolean {
  if (newLoc && newLoc !== prevLoc) return true;
  const a = (prevPlace ?? "").trim();
  const b = (newPlace ?? "").trim();
  if (!a || !b) return false; // first-set or missing → not a move
  const na = normalizePlace(a);
  const nb = normalizePlace(b);
  if (!na || !nb || na === nb) return false; // re-affirmation
  if (na.includes(nb) || nb.includes(na)) return false; // reword/elaboration
  return true;
}

/**
 * Open the NEXT scene, carrying forward the persistent whereabouts (place) so the
 * sidebar never blanks out — especially when the player hasn't actually moved.
 * Scene-specific state (situation, who's present, beats) resets; the narrator
 * refills it. seq++ and the transcript pointer advances to the new tail.
 */
export function carryScene(prev: SceneCard, startTranscriptIdx: number): SceneCard {
  return {
    seq: prev.seq + 1,
    turnCount: 0,
    presentNpcIds: [],
    situation: "",
    place: prev.place,
    placeSeq: prev.placeSeq,
    beats: [],
    // Dangers are scene-scoped: a new scene starts clear; the narrator re-states
    // any hazard that genuinely persists (overwrite semantics).
    dangers: [],
    startTranscriptIdx,
  };
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

/**
 * The full relationship HISTORY with an NPC, rendered for the prompt so the
 * narrator remembers what has actually passed between them (not just the single
 * last note — the "forgot the whole scene with Sera" bug). Recent beats,
 * oldest→newest, scene-tagged. Empty when there's ≤1 beat (the suffix's `last:`
 * already covers a brand-new relationship). Fed for NPCs the player is with now.
 */
export function relationHistory(rel: NpcRelation | undefined, max = 6): string {
  const log = rel?.log;
  if (!log || log.length < 2) return "";
  return log
    .slice(-max)
    .map((e) => (e.scene ? `[s${e.scene}] ${e.note}` : e.note))
    .join(" · ");
}

/** Append a dated beat to a relationship's log (oldest→newest, deduped, capped) —
 *  the pure counterpart of the engine's pushRelationLog, used by the background
 *  scene analyst to enrich the history after a scene closes. */
export function appendRelationLog(rel: NpcRelation, note: string, scene?: number): void {
  const trimmed = note.trim().slice(0, 160);
  if (!trimmed) return;
  const log = rel.log ?? [];
  if (log.length && log[log.length - 1].note === trimmed) return; // no consecutive dupes
  log.push({ note: trimmed, scene });
  rel.log = log.slice(-MAX_RELATION_LOG);
}

/** Is an NPC's oneBreath a thin/placeholder line (the dialogue-registration
 *  fallbacks, or too short to be real canon)? Only these get upgraded by the scene
 *  analyst — a hand-authored description is never clobbered. */
export function isPlaceholderOneBreath(oneBreath: string | undefined): boolean {
  const s = (oneBreath ?? "").trim();
  if (s.length < 24) return true;
  return /^spoke with the player\.?$/i.test(s) || /the player is dealing with\.?$/i.test(s);
}
