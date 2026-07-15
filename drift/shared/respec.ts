/**
 * Character re-customization balance rules (Chrome's studio, Rook). A player may
 * rename, reshape appearance, and REALLOCATE their attributes — but only WITHIN
 * the creation budget, so a remake can never power-creep past a fresh character.
 *
 * Creation nets exactly +3 across the six attributes (primary +3, secondary +1,
 * weakness -1), each landing in roughly [-1, +4]. A respec keeps that same total
 * and per-stat range, so it's pure reallocation — no free points, no dump-stat
 * exploits. Pure + engine-owned so the invariant holds (the LLM never sets stats).
 */
import type { Attributes } from "./schemas";

export const ATTR_KEYS: (keyof Attributes)[] = [
  "might",
  "reflex",
  "vitality",
  "intellect",
  "perception",
  "presence",
];

/** The fixed attribute budget every character (created OR remade) must total. */
export const ATTR_BUDGET = 3;
/** Per-stat range — a touch wider than creation's [-1,+4] to give point-buy room,
 *  but capped so the total constraint can't be gamed into one monster stat. */
export const ATTR_MIN = -2;
export const ATTR_MAX = 4;

export function attrTotal(attrs: Attributes): number {
  return ATTR_KEYS.reduce((sum, k) => sum + (attrs[k] ?? 0), 0);
}

/**
 * Is this a legal attribute spread for a remake? Every key present + integer +
 * within [ATTR_MIN, ATTR_MAX], and the whole thing sums to exactly ATTR_BUDGET.
 * Returns a specific reason on failure so the UI/engine can surface it.
 */
export function validateAttributes(attrs: Attributes): { ok: boolean; error?: string } {
  for (const k of ATTR_KEYS) {
    const v = attrs[k];
    if (typeof v !== "number" || !Number.isInteger(v)) return { ok: false, error: `${k} must be a whole number` };
    if (v < ATTR_MIN || v > ATTR_MAX) return { ok: false, error: `${k} must be between ${ATTR_MIN} and ${ATTR_MAX}` };
  }
  const total = attrTotal(attrs);
  if (total !== ATTR_BUDGET) {
    return { ok: false, error: `attributes must total ${ATTR_BUDGET} (currently ${total})` };
  }
  return { ok: true };
}

/** Points still unspent against the budget (for a live "N points left" display). */
export function pointsRemaining(attrs: Attributes): number {
  return ATTR_BUDGET - attrTotal(attrs);
}
