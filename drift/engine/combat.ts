import { interaction, matrix, type DamageType } from "@/content";
import { rollDice, maxDice, formatDice } from "./dice";
import type { RNG } from "./rng";
import type { EngineEvent } from "./events";

export interface CombatTarget {
  id: string;
  name: string;
  hp: number;
  /** Effective AC, already including any evasive bonus. */
  ac: number;
  /** Uses the evasion to-hit column (scouts/fighters/flown evasive). */
  isEvasive?: boolean;
  /** Armor plating present -> damage faces the "armor" matrix column. */
  armored?: boolean;
  /** Shield capacitor up: negates the first hit of combat, then spent. */
  shieldReady?: boolean;
  hasPointDefense?: boolean;
}

export interface ShipAttackInput {
  attackerSide: "player" | "enemy";
  /** Precomputed gunnery/attack modifier. */
  attackMod: number;
  weaponType: DamageType;
  /** Damage dice, e.g. "2d8". */
  damage: string;
  target: CombatTarget;
  /** Unique-skill trigger: resolve this attack as a natural 20 (crit hit). */
  forceCrit?: boolean;
}

export interface ShipAttackResult {
  attackRoll: { d20: number; mod: number; hitMod: number; total: number };
  hit: boolean;
  intercepted: boolean;
  crit: boolean;
  shieldNegated: boolean;
  shieldStripped: boolean;
  damageDealt: number;
  targetHpAfter: number;
  targetShieldReadyAfter: boolean;
  breakdown: string;
  events: EngineEvent[];
}

/** Which matrix damage column the target's defenses present. */
function facingDefense(t: CombatTarget): "armor" | "evasion" | "none" {
  if (t.armored) return "armor";
  if (t.isEvasive) return "evasion";
  return "none";
}

/**
 * Resolve one ship-scale attack against a target using the interaction matrix,
 * shield/PD rules, and the balanced crit rules (player crit rerolls, enemy crit
 * is max-only). Pure: returns new target hp/shield state; the caller applies it.
 */
export function resolveShipAttack(
  input: ShipAttackInput,
  rng: RNG,
): ShipAttackResult {
  const { attackerSide, attackMod, weaponType, damage, target } = input;
  const events: EngineEvent[] = [];
  let shieldReady = target.shieldReady ?? false;

  // 1. Point-defense may destroy an incoming missile mid-flight.
  if (weaponType === "missile" && target.hasPointDefense) {
    const pdRoll = rng.int(1, 20);
    const pdTotal = pdRoll + 3;
    if (pdTotal >= matrix.pd.destroyDc) {
      const breakdown = `PD intercept: d20(${pdRoll})+3 = ${pdTotal} vs ${matrix.pd.destroyDc} → missile destroyed`;
      events.push({ type: "attack", breakdown, hit: false, damage: 0 });
      return {
        attackRoll: { d20: 0, mod: attackMod, hitMod: 0, total: 0 },
        hit: false,
        intercepted: true,
        crit: false,
        shieldNegated: false,
        shieldStripped: false,
        damageDealt: 0,
        targetHpAfter: target.hp,
        targetShieldReadyAfter: shieldReady,
        breakdown,
        events,
      };
    }
  }

  // 2. To-hit. Only the evasion column modifies to-hit.
  const hitMod = target.isEvasive ? interaction(weaponType, "evasion").hit : 0;
  const d20 = input.forceCrit ? 20 : rng.int(1, 20);
  const total = d20 + attackMod + hitMod;
  const crit = d20 === 20;
  const hit = crit || total >= target.ac;

  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  const hitStr = hitMod !== 0 ? ` ${sign(hitMod)}(vs evasion)` : "";
  let breakdown = `${target.name}: d20(${d20}) ${sign(attackMod)}${hitStr} = ${total} vs AC ${target.ac}`;

  if (!hit) {
    breakdown += " → miss";
    events.push({ type: "attack", breakdown, hit: false, damage: 0 });
    return {
      attackRoll: { d20, mod: attackMod, hitMod, total },
      hit: false,
      intercepted: false,
      crit: false,
      shieldNegated: false,
      shieldStripped: false,
      damageDealt: 0,
      targetHpAfter: target.hp,
      targetShieldReadyAfter: shieldReady,
      breakdown,
      events,
    };
  }

  breakdown += crit ? " → CRIT hit" : " → hit";

  // 3. Shield interactions (this campaign's shields negate the first hit).
  let shieldNegated = false;
  let shieldStripped = false;
  if (shieldReady) {
    if (weaponType === "ion") {
      shieldStripped = true;
      shieldReady = false;
      breakdown += " · ion strips the shield (no hull damage)";
      events.push({ type: "attack", breakdown, hit: true, damage: 0 });
      return {
        attackRoll: { d20, mod: attackMod, hitMod, total },
        hit: true,
        intercepted: false,
        crit,
        shieldNegated: false,
        shieldStripped: true,
        damageDealt: 0,
        targetHpAfter: target.hp,
        targetShieldReadyAfter: false,
        breakdown,
        events,
      };
    }
    shieldNegated = true;
    shieldReady = false;
    breakdown += " · shield negates the hit";
    events.push({ type: "attack", breakdown, hit: true, damage: 0 });
    return {
      attackRoll: { d20, mod: attackMod, hitMod, total },
      hit: true,
      intercepted: false,
      crit,
      shieldNegated: true,
      shieldStripped: false,
      damageDealt: 0,
      targetHpAfter: target.hp,
      targetShieldReadyAfter: false,
      breakdown,
      events,
    };
  }

  // 4. Damage. Crit: player = max + reroll; enemy = max only.
  let rawTotal: number;
  let damageStr: string;
  if (crit && attackerSide === "player") {
    const reroll = rollDice(damage, rng);
    rawTotal = maxDice(damage) + reroll.total;
    damageStr = `crit ${maxDice(damage)} + reroll ${formatDice(reroll)} = ${rawTotal}`;
  } else if (crit) {
    rawTotal = maxDice(damage);
    damageStr = `enemy crit: max ${rawTotal}`;
  } else {
    const roll = rollDice(damage, rng);
    rawTotal = roll.total;
    damageStr = formatDice(roll);
  }

  // 5. Matrix damage modifier for the facing defense.
  const facing = facingDefense(target);
  let dmgMod = 0;
  if (facing === "armor") dmgMod = interaction(weaponType, "armor").dmg;
  const finalDamage = Math.max(0, rawTotal + dmgMod);
  const modStr =
    dmgMod !== 0 ? ` ${sign(dmgMod)}(vs armor) = ${finalDamage}` : "";

  const hpAfter = Math.max(0, target.hp - finalDamage);
  breakdown += ` · ${damageStr}${modStr} · ${target.name} ${target.hp}→${hpAfter} HP`;

  events.push({ type: "attack", breakdown, hit: true, damage: finalDamage });
  events.push({
    type: "damage",
    breakdown: `${target.name} takes ${finalDamage} (${target.hp}→${hpAfter})`,
    targetId: target.id,
    amount: finalDamage,
    hpAfter,
  });

  return {
    attackRoll: { d20, mod: attackMod, hitMod, total },
    hit: true,
    intercepted: false,
    crit,
    shieldNegated,
    shieldStripped,
    damageDealt: finalDamage,
    targetHpAfter: hpAfter,
    targetShieldReadyAfter: shieldReady,
    breakdown,
    events,
  };
}

/** Personal-scale attack: d20+mod vs AC; vest/plate DR reduces damage. */
export function resolvePersonalAttack(
  input: {
    attackerSide: "player" | "enemy";
    attackMod: number;
    damage: string;
    target: { id: string; name: string; hp: number; ac: number; damageReduction?: number };
    forceCrit?: boolean;
  },
  rng: RNG,
): ShipAttackResult {
  const { attackerSide, attackMod, damage, target } = input;
  const events: EngineEvent[] = [];
  const d20 = input.forceCrit ? 20 : rng.int(1, 20);
  const total = d20 + attackMod;
  const crit = d20 === 20;
  const hit = crit || total >= target.ac;
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  let breakdown = `${target.name}: d20(${d20}) ${sign(attackMod)} = ${total} vs AC ${target.ac}`;

  if (!hit) {
    breakdown += " → miss";
    events.push({ type: "attack", breakdown, hit: false, damage: 0 });
    return {
      attackRoll: { d20, mod: attackMod, hitMod: 0, total },
      hit: false,
      intercepted: false,
      crit: false,
      shieldNegated: false,
      shieldStripped: false,
      damageDealt: 0,
      targetHpAfter: target.hp,
      targetShieldReadyAfter: false,
      breakdown,
      events,
    };
  }

  let rawTotal: number;
  let damageStr: string;
  if (crit && attackerSide === "player") {
    const reroll = rollDice(damage, rng);
    rawTotal = maxDice(damage) + reroll.total;
    damageStr = `crit ${maxDice(damage)} + reroll ${formatDice(reroll)} = ${rawTotal}`;
  } else if (crit) {
    rawTotal = maxDice(damage);
    damageStr = `enemy crit: max ${rawTotal}`;
  } else {
    const roll = rollDice(damage, rng);
    rawTotal = roll.total;
    damageStr = formatDice(roll);
  }
  const dr = target.damageReduction ?? 0;
  const finalDamage = Math.max(0, rawTotal - dr);
  const hpAfter = Math.max(0, target.hp - finalDamage);
  const drStr = dr ? ` -${dr}(DR) = ${finalDamage}` : "";
  breakdown += `${crit ? " → CRIT" : " → hit"} · ${damageStr}${drStr} · ${target.name} ${target.hp}→${hpAfter} HP`;
  events.push({ type: "attack", breakdown, hit: true, damage: finalDamage });
  events.push({
    type: "damage",
    breakdown: `${target.name} takes ${finalDamage} (${target.hp}→${hpAfter})`,
    targetId: target.id,
    amount: finalDamage,
    hpAfter,
  });
  return {
    attackRoll: { d20, mod: attackMod, hitMod: 0, total },
    hit: true,
    intercepted: false,
    crit,
    shieldNegated: false,
    shieldStripped: false,
    damageDealt: finalDamage,
    targetHpAfter: hpAfter,
    targetShieldReadyAfter: false,
    breakdown,
    events,
  };
}
