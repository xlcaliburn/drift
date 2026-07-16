import type { RNG } from "@/engine/rng";

/**
 * Combat STATUS EFFECTS (ITEMS.md — the effect layer that makes weapon choice a
 * decision, not just a bigger damage die). Pure + engine-owned: statuses live on a
 * combatant (enemy `statuses`, player `playerStatuses`), the combat loop applies them
 * on hit, ticks them at the afflicted's turn start, and reads their modifiers when
 * resolving an attack. The narrator only voices the 🔥/⚡ system lines.
 *
 * v1 set (the damage-type core):
 *  - 🔥 burning  — 1d4/turn for 2 rounds, ignores armor; a heal clears it. Fast
 *                  pressure that only needs ONE hit to land (answer to high AC).
 *  - 🩸 bleeding — 2×stacks/turn for 3 rounds, STACKS (rewards volume of fire);
 *                  a heal clears it. Ramping pressure.
 *  - ⚡ shocked  — the afflicted SKIPS its next turn; also the hook the combat loop
 *                  uses to strip a shield / disable tech. Pure tempo denial.
 *  - 🧪 corroded — −2 AC per stack (max −4) for 3 rounds. A setup effect: makes every
 *                  following attack land.
 */

export type StatusKind = "burning" | "bleeding" | "shocked" | "corroded";

export interface StatusEffect {
  kind: StatusKind;
  /** Rounds remaining; ticked down at the afflicted's turn start. */
  rounds: number;
  /** ≥1. Only bleeding/corroded grow it; the rest stay 1. */
  stacks: number;
}

interface StatusSpec {
  icon: string;
  label: string;
  /** Rounds a fresh (or refreshed) application lasts. */
  baseRounds: number;
  /** Stack ceiling (1 = non-stacking). */
  maxStacks: number;
  /** Damage dealt per tick for a given stack count (0 for control effects). */
  tickDamage: (stacks: number, rng: RNG) => number;
}

const SPECS: Record<StatusKind, StatusSpec> = {
  burning: { icon: "🔥", label: "Burning", baseRounds: 2, maxStacks: 1, tickDamage: (_s, rng) => rng.int(1, 4) },
  bleeding: { icon: "🩸", label: "Bleeding", baseRounds: 3, maxStacks: 5, tickDamage: (s) => 2 * s },
  shocked: { icon: "⚡", label: "Shocked", baseRounds: 1, maxStacks: 1, tickDamage: () => 0 },
  corroded: { icon: "🧪", label: "Corroded", baseRounds: 3, maxStacks: 2, tickDamage: () => 0 },
};

export const statusIcon = (k: StatusKind): string => SPECS[k].icon;
export const statusLabel = (k: StatusKind): string => SPECS[k].label;
export const hasStatus = (list: StatusEffect[] | undefined, kind: StatusKind): boolean =>
  !!list?.some((s) => s.kind === kind);

/**
 * Apply (or refresh) a status on a list — immutable. A repeat refreshes the duration;
 * a stacking kind also adds a stack up to its cap. Returns the new list.
 */
export function applyStatus(list: StatusEffect[], kind: StatusKind): StatusEffect[] {
  const spec = SPECS[kind];
  const existing = list.find((s) => s.kind === kind);
  if (existing) {
    return list.map((s) =>
      s.kind === kind ? { ...s, rounds: spec.baseRounds, stacks: Math.min(spec.maxStacks, s.stacks + 1) } : s,
    );
  }
  return [...list, { kind, rounds: spec.baseRounds, stacks: 1 }];
}

export interface StatusTick {
  /** Total damage-over-time this tick (already armor-agnostic — subtract from HP). */
  damage: number;
  /** Shocked → the afflicted loses its action this turn. */
  skipTurn: boolean;
  /** Statuses after this tick (durations decremented, expired ones dropped). */
  statuses: StatusEffect[];
  /** System lines for the transcript. */
  lines: string[];
}

/**
 * Resolve statuses at the afflicted's turn start: deal DoT, flag a skipped turn,
 * decrement every duration, drop the expired. `who` names the afflicted for the lines.
 */
export function tickStatuses(list: StatusEffect[] | undefined, who: string, rng: RNG): StatusTick {
  let damage = 0;
  let skipTurn = false;
  const lines: string[] = [];
  const next: StatusEffect[] = [];
  for (const s of list ?? []) {
    const spec = SPECS[s.kind];
    const dot = spec.tickDamage(s.stacks, rng);
    if (dot > 0) {
      damage += dot;
      lines.push(`${spec.icon} ${who} — ${spec.label}${s.stacks > 1 ? ` ×${s.stacks}` : ""}: ${dot} damage`);
    }
    if (s.kind === "shocked") {
      skipTurn = true;
      lines.push(`${spec.icon} ${who} is Shocked — loses the turn.`);
    }
    const rounds = s.rounds - 1;
    if (rounds > 0) next.push({ ...s, rounds });
    else lines.push(`${spec.icon} ${who}'s ${spec.label} wears off.`);
  }
  return { damage, skipTurn, statuses: next, lines };
}

/** Corroded eats armor: −2 AC per stack (so −4 at the 2-stack cap). */
export function acPenalty(list: StatusEffect[] | undefined): number {
  const c = list?.find((s) => s.kind === "corroded");
  return c ? 2 * c.stacks : 0;
}

/** A heal clears the wound-type DoTs (burning/bleeding); control effects persist. */
export function clearOnHeal(list: StatusEffect[] | undefined): { statuses: StatusEffect[]; cleared: StatusKind[] } {
  const src = list ?? [];
  const isWound = (k: StatusKind) => k === "burning" || k === "bleeding";
  return {
    statuses: src.filter((s) => !isWound(s.kind)),
    cleared: src.filter((s) => isWound(s.kind)).map((s) => s.kind),
  };
}

/** Compact badge for a sheet/context line: "🔥🩸×3". Empty when clean. */
export function summarizeStatuses(list: StatusEffect[] | undefined): string {
  return (list ?? [])
    .map((s) => `${SPECS[s.kind].icon}${s.stacks > 1 ? `×${s.stacks}` : ""}`)
    .join("");
}
