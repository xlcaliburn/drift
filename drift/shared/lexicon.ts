/**
 * TODO(M2): this facade is a SEED, not the full lexicon migration. Modularity
 * M2 (deferred — see STATUS.md) moves these WORDS into the pack so a fantasy
 * world can say "sennight"/"silver" without touching engine code; today the
 * values below are hardcoded DRIFT wording, same as everywhere else.
 *
 * The rule (WORKFLOW.md house mechanics): new engine/UI strings use this
 * facade — never a bare ¢/tenday/hull literal — so M2 has one place to
 * migrate FROM instead of hunting new literals that accrued in the meantime.
 * Existing call sites are NOT migrated here; that's M2's job.
 */

/** Format a credit amount exactly like the engine's existing lines (`¢${n}`). */
export function fmtCredits(n: number): string {
  return `¢${n}`;
}

export const TENDAY = "tenday";
export const TENDAYS = "tendays";

export const WORLD_NOUNS = {
  ship: "ship",
  hull: "hull",
  dock: "dock",
  station: "station",
} as const;
