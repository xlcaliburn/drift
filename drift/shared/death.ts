/**
 * Bleeding Out — D&D-style death saves for a Downed character (COMBAT.md). Pure
 * logic so it's engine-owned and unit-testable; the bridge supplies the d20 and
 * mutates state. While Downed, each turn the player makes a desperate act that
 * resolves to a death save: 3 successes → stabilise (alive, out of the fight),
 * 3 failures → dead. A nat 20 rallies you to your feet; a nat 1 is two failures;
 * a hostile standing over you tacks on a failure a turn (the D&D "hit while down").
 */

export interface DeathSaves {
  successes: number;
  failures: number;
}

/** D&D thresholds: three of either ends it. */
export const SAVES_TO_STABILIZE = 3;
export const FAILS_TO_DIE = 3;
/** A plain death save succeeds on 10+ (no modifiers, like 5e). */
export const DEATH_SAVE_DC = 10;

export const freshDeathSaves = (): DeathSaves => ({ successes: 0, failures: 0 });

export type DeathSaveKind =
  | "success"
  | "failure"
  | "rally"; // nat 20 — back on your feet at 1 HP

/** Interpret one raw d20 into its effect on the track (before pressure/outcome).
 *  nat 20 → rally; nat 1 → two failures; ≥ (DC − edge) → success; else failure.
 *  `edge` lowers the bar (crawling to cover steadies the hand: edge 2 → 8+). */
export function readDeathSave(d20: number, edge = 0): { kind: DeathSaveKind; successes: number; failures: number } {
  if (d20 === 20) return { kind: "rally", successes: 0, failures: 0 };
  if (d20 === 1) return { kind: "failure", successes: 0, failures: 2 };
  if (d20 >= DEATH_SAVE_DC - edge) return { kind: "success", successes: 1, failures: 0 };
  return { kind: "failure", successes: 0, failures: 1 };
}

/** Add successes/failures to a track (never negative). */
export function advanceSaves(track: DeathSaves, add: Partial<DeathSaves>): DeathSaves {
  return {
    successes: Math.max(0, track.successes + (add.successes ?? 0)),
    failures: Math.max(0, track.failures + (add.failures ?? 0)),
  };
}

export type DeathOutcome = "continue" | "stabilized" | "dead";

/** Where a track stands. In the tutorial, death is off the table — failures can
 *  ride up to the wire but never tip into "dead". */
export function trackOutcome(track: DeathSaves, opts: { inTutorial?: boolean } = {}): DeathOutcome {
  if (track.successes >= SAVES_TO_STABILIZE) return "stabilized";
  if (track.failures >= FAILS_TO_DIE && !opts.inTutorial) return "dead";
  return "continue";
}

/** Compact track badge for prompt/UI: filled/empty pips, e.g. "saves ●●○ / fails ✕○○". */
export function saveTrackLabel(track: DeathSaves): string {
  const pips = (n: number, on: string, off: string) => on.repeat(Math.min(3, n)) + off.repeat(Math.max(0, 3 - n));
  return `saves ${pips(track.successes, "●", "○")} / fails ${pips(track.failures, "✕", "○")}`;
}

export type DownedActionKind = "hold" | "cover" | "item" | "help";

export interface DownedAction {
  kind: DownedActionKind;
  /** For kind "item": the catalog id of the consumable to reach for. */
  itemId?: string;
}

/** The engine-owned desperate-act chips a Downed player picks from (mirrors
 *  combatActions — engine-generated so the model can't derail a death). A held
 *  stim/medkit is the self-rescue; "call for help" appears only when a friendly
 *  face is in the scene to answer. */
export function downedActions(
  consumables: { itemId: string; name: string; count: number }[],
  allyPresent: boolean,
): { label: string; downedAction: DownedAction }[] {
  const chips: { label: string; downedAction: DownedAction }[] = [
    { label: "Grit your teeth and hold on", downedAction: { kind: "hold" } },
    { label: "Drag yourself to cover", downedAction: { kind: "cover" } },
  ];
  for (const u of consumables) {
    if (u.itemId !== "stim" && u.itemId !== "medkit") continue;
    chips.push({ label: `Claw for your ${u.name} (×${u.count})`, downedAction: { kind: "item", itemId: u.itemId } });
  }
  if (allyPresent) chips.push({ label: "Call out for help", downedAction: { kind: "help" } });
  return chips;
}

/** Map a downed player's free text to a desperate act (chips carry the kind
 *  explicitly; this covers typed input). Reaching for a stim/medkit → item;
 *  crawling/hiding → cover; calling out → help; anything else → hold on. */
export function interpretDownedText(text: string): { kind: DownedActionKind; itemId?: string } {
  const t = text.toLowerCase();
  if (/\b(stim|medkit|med\s?kit|inject|patch|heal|pain)\b/.test(t)) {
    return { kind: "item", itemId: /medkit|med\s?kit/.test(t) ? "medkit" : "stim" };
  }
  if (/\b(cover|crawl|hide|drag|behind|duck|shelter|away)\b/.test(t)) return { kind: "cover" };
  if (/\b(help|call|shout|yell|croak|comm|radio|scream)\b/.test(t)) return { kind: "help" };
  return { kind: "hold" };
}
