import type { Npc } from "./schemas";
import type { SceneMemory } from "./scene";
import { applyFactUpdates, type Fact } from "./facts";

/**
 * Pure merge functions for the `campaign_runtime` optimistic-concurrency conflict
 * path (CHECKS.md §0 "campaign_runtime CAS"). Writers have multiplied — the live
 * turn, background scene compression, the mid-scene analyst, degraded repair,
 * manual re-sync — all persist independently, and a background pass finishing
 * DURING a player's turn used to silently overwrite the turn's fresher
 * facts/npcs/scenes with its own stale copy (`updated_at` was written but never
 * checked). `lib/state.persistSession` calls these on a detected CONFLICT
 * (compare-and-swap failure) to fold the OTHER writer's slice into ours before
 * one retry. Perfect merging is not the goal — no silent clobber is.
 */

/** Merge the facts ledger on a CONFLICT: the freshly-reloaded ("theirs") ledger
 *  wins the base, and OUR facts are re-applied on top as additions — the normal
 *  dedupe/replace/cap semantics (shared/facts.applyFactUpdates) then decide
 *  whether ours were already present, restate theirs, or are genuinely new.
 *  Order matters: replaying ours LAST means a fact we just established this
 *  turn is never silently dropped in favor of a stale copy. */
export function mergeFactsOnConflict(theirs: Fact[], mine: Fact[]): Fact[] {
  return applyFactUpdates(
    theirs,
    mine.map((f) => ({ text: f.text, entityRefs: f.entityRefs, pinned: f.pinned })),
  );
}

/** Merge recent scene summaries on a CONFLICT: union by seq. When both sides
 *  have the same seq (a scene both writers touched — e.g. we're mid-turn while
 *  a delayed repair pass just healed an old degraded row), prefer the
 *  non-degraded entry, then the longer summary as a proxy for "more complete." */
export function mergeRecentScenesOnConflict(theirs: SceneMemory[], mine: SceneMemory[]): SceneMemory[] {
  const bySeq = new Map<number, SceneMemory>();
  for (const s of theirs) bySeq.set(s.seq, s);
  for (const s of mine) {
    const existing = bySeq.get(s.seq);
    if (!existing) {
      bySeq.set(s.seq, s);
      continue;
    }
    if (existing.degraded && !s.degraded) {
      bySeq.set(s.seq, s); // ours healed what theirs still has as a stub
    } else if (!existing.degraded && s.degraded) {
      // keep existing (theirs is healthy, ours is the stub) — no-op
    } else if (s.summary.length > existing.summary.length) {
      bySeq.set(s.seq, s); // same health — prefer the more complete text
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** How many continuity-bearing fields an NPC record carries — a cheap proxy for
 *  "more complete" when the same id shows up on both sides of a merge. */
function richness(n: Npc): number {
  return (
    (n.aliases?.length ?? 0) +
    (n.oneBreath && n.oneBreath !== "Someone the player met." ? 2 : 0) +
    (n.role ? 1 : 0) +
    (n.appearance ? 1 : 0) +
    (n.quirk ? 1 : 0) +
    (n.backstory ? 1 : 0) +
    (n.sex ? 1 : 0)
  );
}

/** Merge campaign-local NPCs on a CONFLICT: union by id, preferring whichever
 *  side's record is RICHER (more fields filled — an analyst pass on one side may
 *  have refreshed an identity/alias the other side's snapshot doesn't have yet).
 *  A tie prefers "mine" (the in-memory session mid-turn is usually the freshest
 *  actual play). */
export function mergeNpcsOnConflict(theirs: Npc[], mine: Npc[]): Npc[] {
  const byId = new Map<string, Npc>();
  for (const n of theirs) byId.set(n.id, n);
  for (const n of mine) {
    const existing = byId.get(n.id);
    if (!existing || richness(n) >= richness(existing)) byId.set(n.id, n);
  }
  return [...byId.values()];
}
