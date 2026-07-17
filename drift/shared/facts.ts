import { z } from "zod";

/**
 * FACTS LEDGER (CONTINUITY.md v2, D-2) — standing facts that outlive scenes and
 * fit neither NPC nor thread: "banned from the Meridian dock bar", "the split
 * with Kaela is 50/50 — agreed", "meeting Dex at the Rust Bucket, two hours",
 * "Doyle owes you ¢200". The model PROPOSES facts (TurnPlan.facts); the engine
 * stores them here — capped, deduped, oldest-evicted — and feeds them back every
 * turn as durable canon.
 *
 * Born from the audit patterns: narrated deal terms renegotiated as if never
 * settled ("50/50 → Done" became "30%... that was a different conversation"),
 * and a scheduled rendezvous overwritten because nothing durable remembered it.
 */

export const Fact = z.object({
  text: z.string().min(1).max(160),
  /** Entity ids this fact touches — rides retrieval like threads do. */
  entityRefs: z.array(z.string()).default([]),
  /** In-world tenday when established (display + eventual aging). */
  tenday: z.number().int().optional(),
  /** Load-bearing — a term whose loss would contradict the story (a deal's
   *  exact split, a debt, a kinship). Only the ANALYST may set this (the live
   *  turn path's TurnPlan has no such field — a cheap per-turn model choosing
   *  what's load-bearing is exactly the poisoning risk pinning exists to avoid).
   *  Pinned facts evict last, not first. */
  pinned: z.boolean().optional(),
});
export type Fact = z.infer<typeof Fact>;

/** All 20 ≈ ~300 tokens — small enough to send whole every turn. */
export const FACTS_CAP = 20;

/** A cheap model over-pinning would defeat the point (everything "load-bearing"
 *  means nothing is). Capped well under FACTS_CAP; a 9th pin bumps the oldest. */
export const PINNED_CAP = 8;

/** Normalize for dedupe: lowercase, strip punctuation, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "on", "at", "with", "to", "in", "for", "and", "is",
  "are", "was", "were", "now", "you", "your", "their", "his", "her", "its",
]);

/** The fact's SUBJECT: its first three content words ("split kaela crate").
 *  A restated deal keeps its subject even when every number in it changes. */
function subjectKey(s: string): string {
  return norm(s).split(" ").filter((t) => !STOPWORDS.has(t)).slice(0, 3).join(" ");
}

/** Two facts are "the same fact" when one nearly contains the other, their token
 *  sets mostly overlap, or they share a subject — fuzzy enough to catch "50/50 —
 *  agreed" restated as "60/40 — renegotiated", tight enough to keep distinct
 *  facts apart (different subjects part ways at the third content word). */
function sameFact(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ka = subjectKey(a);
  if (ka && ka.split(" ").length >= 3 && ka === subjectKey(b)) return true;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size < 3) return false; // too short to overlap-match safely
  let shared = 0;
  for (const t of small) if (big.has(t)) shared++;
  return shared / small.size >= 0.8;
}

/**
 * Fold the turn's proposed facts into the ledger: an addition matching an
 * existing fact REPLACES it (the newest wording wins — that's how a deal's terms
 * get corrected deliberately instead of duplicated, and a restated PINNED fact
 * keeps its pin even when the addition itself doesn't repeat it); genuinely new
 * facts append. Eviction at the cap prefers UNPINNED facts (oldest first);
 * pinned facts only evict once everything is pinned. A pin count over
 * PINNED_CAP bumps the OLDEST pinned fact back to unpinned (a cheap model
 * over-pinning would defeat the point). Pure — returns the new ledger.
 */
export function applyFactUpdates(
  facts: Fact[],
  additions: { text: string; entityRefs?: string[]; pinned?: boolean }[],
  tenday?: number,
): Fact[] {
  let next = [...facts];
  for (const raw of additions) {
    const text = (raw.text ?? "").trim().slice(0, 160);
    if (!text) continue;
    const dupIdx = next.findIndex((f) => sameFact(f.text, text));
    const wasPinned = dupIdx >= 0 && next[dupIdx].pinned === true;
    const pinned = wasPinned || raw.pinned === true;
    const fact: Fact = {
      text,
      entityRefs: (raw.entityRefs ?? []).slice(0, 6),
      tenday,
      ...(pinned ? { pinned: true } : {}),
    };
    if (dupIdx >= 0) {
      // Replace in place but move to the END (freshest — safest from eviction).
      next.splice(dupIdx, 1);
    }
    next = [...next, fact];
    if (pinned && !wasPinned) {
      const pinnedCount = next.filter((f) => f.pinned).length;
      if (pinnedCount > PINNED_CAP) {
        const oldestPinnedIdx = next.findIndex((f, i) => f.pinned && i !== next.length - 1);
        if (oldestPinnedIdx >= 0) next[oldestPinnedIdx] = { ...next[oldestPinnedIdx], pinned: undefined };
      }
    }
  }
  while (next.length > FACTS_CAP) {
    const unpinnedIdx = next.findIndex((f) => !f.pinned);
    next.splice(unpinnedIdx >= 0 ? unpinnedIdx : 0, 1);
  }
  return next;
}
