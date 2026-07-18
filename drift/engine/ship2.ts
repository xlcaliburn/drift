import type { RNG } from "./rng";
import { rollDice } from "./dice";
import { fmtCredits } from "@/shared/lexicon";

/**
 * Pure ship2 combat resolution (COMBAT_V2.md Part B, HANDOFF_COMBAT_V2_2.md) —
 * the Eclipse-style power/dice duel. No I/O, no state mutation: every function
 * takes plain data + an RNG and returns results, so the whole thing is
 * unit-testable with a fixed RNG (mirrors engine/combatEngine.ts's contract).
 *
 * Round shape: roll every FIRED mount's dice (rollMount) → the firing side's
 * gunner boosts the single best near-miss across all of them (applyGunnerBoost)
 * → the defending side's point defense rolls down missile hits (applyPointDefense)
 * → armor/shields reduce the total (resolveVolley), which also builds the ONE
 * summary line for the round (matches crewPhase's one-line-per-side convention).
 */

export interface Ship2MountProfile {
  id: string;
  name: string;
  dice: number;
  hitOn: number;
  dmgPerHit: number;
  power: number;
  /** The lowered hit-on when +1 power overcharges this mount (beam lance only
   *  this slice). Absent = this mount can't be overcharged. */
  overchargeHitOn?: number;
  /** Missile racks: subject to the defender's point-defense roll-down. */
  ammoLimited?: boolean;
  /** Point-defense hit-on (defender's roll) — only meaningful when ammoLimited. */
  pdHitOn?: number;
}

export interface MountFireResult {
  mountId: string;
  mountName: string;
  power: number;
  dmgPerHit: number;
  dice: number[];
  hitOn: number;
  overcharged: boolean;
  hits: number;
  /** Missile hits shot down by the defender's point defense (0 if n/a). */
  pdDowned: number;
  /** hits × dmgPerHit, PRE armor/shield (POST point defense). */
  damage: number;
}

/** Roll one mount's dice against the DEFENDER's evasion bonus. A natural 6
 *  always hits, even if the raised threshold would otherwise exceed 6 —
 *  nothing is immune, just harder to land (COMBAT_V2.md's design). */
export function rollMount(
  mount: Ship2MountProfile,
  opts: { evasionBonus: number; overcharged?: boolean },
  rng: RNG,
): MountFireResult {
  const overcharged = !!opts.overcharged && mount.overchargeHitOn !== undefined;
  const baseHitOn = overcharged ? mount.overchargeHitOn! : mount.hitOn;
  const hitOn = baseHitOn + Math.max(0, opts.evasionBonus);
  const dice = mount.dice > 0 ? rollDice(`${mount.dice}d6`, rng).dice : [];
  let hits = 0;
  for (const d of dice) if (d === 6 || d >= hitOn) hits++;
  return {
    mountId: mount.id,
    mountName: mount.name,
    power: mount.power,
    dmgPerHit: mount.dmgPerHit,
    dice,
    hitOn,
    overcharged,
    hits,
    pdDowned: 0,
    damage: hits * mount.dmgPerHit,
  };
}

/**
 * The firing side's gunner boosts a SINGLE die this round (not per mount) —
 * the highest die that didn't already hit, across every mount fired. Pure +
 * deterministic: ties break by mount order, then die order. A no-op when
 * every fired die already hit (nothing to boost).
 */
export function applyGunnerBoost(results: MountFireResult[]): MountFireResult[] {
  let bestMount = -1;
  let bestDie = -1;
  let bestVal = -1;
  results.forEach((r, mi) => {
    r.dice.forEach((d, di) => {
      const alreadyHit = d === 6 || d >= r.hitOn;
      if (!alreadyHit && d > bestVal) {
        bestVal = d;
        bestMount = mi;
        bestDie = di;
      }
    });
  });
  if (bestMount < 0) return results;
  return results.map((r, mi) => {
    if (mi !== bestMount) return r;
    const dice = [...r.dice];
    dice[bestDie] += 1;
    const nowHits = dice[bestDie] === 6 || dice[bestDie] >= r.hitOn;
    return nowHits ? { ...r, dice, hits: r.hits + 1, damage: r.damage + r.dmgPerHit } : { ...r, dice };
  });
}

/** The DEFENDER shoots down incoming missile hits before armor/shields ever
 *  see them — one PD roll per hit, `pdHitOn`+ downs it. No-op for non-missile
 *  mounts or a defender without point defense. */
export function applyPointDefense(result: MountFireResult, mount: Ship2MountProfile, hasPointDefense: boolean, rng: RNG): MountFireResult {
  if (!mount.ammoLimited || !hasPointDefense || result.hits <= 0) return result;
  const pdHitOn = mount.pdHitOn ?? 5;
  let downed = 0;
  for (let i = 0; i < result.hits; i++) {
    if (rng.int(1, 6) >= pdHitOn) downed++;
  }
  const hits = result.hits - downed;
  return { ...result, pdDowned: downed, hits, damage: hits * result.dmgPerHit };
}

export interface VolleyOutcome {
  mounts: MountFireResult[];
  grossDamage: number;
  shieldAbsorbed: number;
  netDamage: number;
  /** ONE compact line for this side's whole round (crewPhase convention). */
  breakdown: string;
}

/**
 * Combine every mount a side fired this round into ONE outcome: armor shaves
 * flat damage per hit, the shield pool absorbs what's left, the remainder is
 * hull damage. Mounts must already be POST gunner-boost and POST point
 * defense (see the module doc for the call order).
 */
export function resolveVolley(sideLabel: string, mounts: MountFireResult[], defense: { armor: number; shieldPool: number }): VolleyOutcome {
  let gross = 0;
  const parts: string[] = [];
  for (const m of mounts) {
    const perHit = Math.max(0, m.dmgPerHit - defense.armor);
    const dmg = m.hits * perHit;
    gross += dmg;
    const diceStr = m.dice.length ? `d6(${m.dice.join(",")})` : "—";
    const pdStr = m.pdDowned > 0 ? ` · ${m.pdDowned} shot down` : "";
    parts.push(`${m.mountName} ${m.power}P${m.overcharged ? " overcharged" : ""}: ${diceStr}≥${m.hitOn} → ${m.hits} hit${m.hits === 1 ? "" : "s"}${pdStr} → ${dmg} dmg`);
  }
  const shieldAbsorbed = Math.min(gross, Math.max(0, defense.shieldPool));
  const netDamage = gross - shieldAbsorbed;
  const shieldStr = shieldAbsorbed > 0 ? ` · shields absorb ${shieldAbsorbed}` : "";
  const breakdown =
    mounts.length === 0
      ? `${sideLabel}: holds fire.`
      : `${sideLabel} — ${parts.join(" · ")}${shieldStr} → hull −${netDamage}`;
  return { mounts, grossDamage: gross, shieldAbsorbed, netDamage, breakdown };
}

/** Ship2 salvage payout on victory — same LOOT_BAND-style bands as classic
 *  ship combat, formatted through the lexicon facade (new code, not a
 *  migrated call site). */
export function ship2SalvageLine(amount: number): string {
  return `💰 Enemy driven off / destroyed — salvage worth ${fmtCredits(amount)}.`;
}
