import type { RNG } from "./rng";
import { rollDamage, maxDice } from "./dice";
import { enemyTiers, shipClasses } from "@/content";
import type { CombatEnemy, CombatTier } from "@/shared/combat";

/**
 * Pure combat resolution — the deterministic heart of multi-turn fights. No I/O,
 * no state mutation: functions take the combatants + an RNG and return the
 * results + new HP, so the orchestration layer applies them and the whole thing
 * is unit-testable with a fixed RNG.
 */

export interface SpawnSpec {
  tier: CombatTier;
  count?: number;
  name?: string;
  /** Named antagonist — the longer fight. Rolled HP is multiplied ×1.8 (a T2
   *  major ≈ 25, a T3 major ≈ 43), so a boss outlasts a general enemy of its
   *  tier. Set by the combatStart agent, never on rank-and-file mooks. */
  major?: boolean;
}

/** Boss HP multiplier — a `major` enemy is ~1.8× the general tier HP. */
const MAJOR_HP_MULT = 1.8;

/** Build persisted enemies from the tier tables. Count clamped 1–4; T2+ shielded.
 *  A `major` spec scales each spawned enemy's HP ×1.8 (rounded) → the boss fight. */
export function spawnCombatEnemies(specs: SpawnSpec[], rng: RNG): CombatEnemy[] {
  const out: CombatEnemy[] = [];
  let n = 0;
  for (const spec of specs) {
    const t = enemyTiers.tiers[spec.tier] as unknown as {
      label: string;
      hpRange: [number, number];
      ac?: number;
      acRange?: [number, number];
      atk: number;
      damage: string;
      multiAttack?: boolean;
    };
    if (!t) continue;
    const count = Math.max(1, Math.min(4, spec.count ?? 1));
    for (let i = 0; i < count; i++) {
      const rolledHp = rng.int(t.hpRange[0], t.hpRange[1]);
      const hp = spec.major ? Math.round(rolledHp * MAJOR_HP_MULT) : rolledHp;
      const ac = t.acRange ? rng.int(t.acRange[0], t.acRange[1]) : t.ac ?? 14;
      out.push({
        id: `e-${++n}`,
        name: count > 1 ? `${spec.name ?? t.label} ${i + 1}` : spec.name ?? t.label,
        tier: spec.tier,
        hp,
        maxHp: hp,
        ac,
        atk: t.atk,
        damage: t.damage,
        // Shields are a T3/boss defense only — standardized off the T2 mook roll so
        // early fights are consistent and don't get a surprise first-hit-negate.
        shieldReady: spec.tier === "T3" || !!spec.major,
        multiAttack: !!t.multiAttack,
      });
    }
  }
  return out;
}

export type ShipClass = keyof typeof shipClasses.classes;
export interface ShipSpawnSpec {
  shipClass: ShipClass;
  count?: number;
  name?: string;
  tier?: CombatTier;
  /** Named flagship — ×1.8 hull, the longer ship fight. Mirror of SpawnSpec.major. */
  major?: boolean;
}

/** Rough gunnery-attack bonus for an enemy ship of a class. */
const SHIP_ATK: Record<string, number> = { scout: 4, fighter: 5, hauler: 4, gunship: 6, corvette: 7 };

/** Build enemy SHIPS from the ship-class tables (hp/ac/weapon/defenses). */
export function spawnCombatShips(specs: ShipSpawnSpec[], rng: RNG): CombatEnemy[] {
  const out: CombatEnemy[] = [];
  let n = 0;
  for (const spec of specs) {
    const cls = shipClasses.classes[spec.shipClass] as unknown as {
      label: string;
      hpRange: [number, number];
      acRange: [number, number];
      weapon: { type: string; damage: string };
      defenses: string[];
      multiAttack?: boolean;
    };
    if (!cls) continue;
    const count = Math.max(1, Math.min(4, spec.count ?? 1));
    for (let i = 0; i < count; i++) {
      const rolledHp = rng.int(cls.hpRange[0], cls.hpRange[1]);
      const hp = spec.major ? Math.round(rolledHp * MAJOR_HP_MULT) : rolledHp;
      const ac = rng.int(cls.acRange[0], cls.acRange[1]);
      out.push({
        id: `e-${++n}`,
        name: count > 1 ? `${spec.name ?? cls.label} ${i + 1}` : spec.name ?? cls.label,
        tier: spec.tier ?? "T2",
        hp,
        maxHp: hp,
        ac,
        atk: SHIP_ATK[spec.shipClass] ?? 5,
        damage: cls.weapon.damage,
        weaponType: cls.weapon.type as CombatEnemy["weaponType"],
        shieldReady: cls.defenses.includes("shields"),
        hasPointDefense: cls.defenses.includes("pd"),
        isEvasive: cls.defenses.includes("evasion"),
        armored: cls.defenses.includes("armor"),
        multiAttack: !!cls.multiAttack,
      });
    }
  }
  return out;
}

export interface AttackOutcome {
  hit: boolean;
  crit: boolean;
  damage: number;
  breakdown: string;
}

export interface PlayerAttackResult extends AttackOutcome {
  enemyHpAfter: number;
  shieldReadyAfter: boolean;
  killed: boolean;
}

/**
 * The player attacks one enemy. Player crit = max damage + a bonus roll (heroic,
 * per critRules); an enemy shield negates the first hit. `aimBonus` is added to
 * the to-hit (consumed by the caller).
 */
export function playerAttack(
  enemy: CombatEnemy,
  attackMod: number,
  weaponDamage: string,
  aimBonus: number,
  rng: RNG,
  /** Unseen/surprise strike — roll 2d20 and take the higher (D&D advantage). */
  advantage = false,
): PlayerAttackResult {
  let d20: number;
  let rollStr: string;
  if (advantage) {
    const a = rng.int(1, 20);
    const b = rng.int(1, 20);
    d20 = Math.max(a, b);
    rollStr = `d20(adv ${a}/${b}→${d20})`;
  } else {
    d20 = rng.int(1, 20);
    rollStr = `d20(${d20})`;
  }
  const crit = d20 === 20;
  const total = d20 + attackMod + aimBonus;
  const aimStr = aimBonus ? `+${aimBonus}(aim)` : "";
  const head = `attack: ${rollStr}+${attackMod}${aimStr} = ${total} vs AC ${enemy.ac}`;

  if (!crit && total < enemy.ac) {
    return { hit: false, crit: false, damage: 0, enemyHpAfter: enemy.hp, shieldReadyAfter: enemy.shieldReady, killed: false, breakdown: `${head} → miss` };
  }
  if (enemy.shieldReady) {
    return { hit: true, crit, damage: 0, enemyHpAfter: enemy.hp, shieldReadyAfter: false, killed: false, breakdown: `${head} → hit, ${enemy.name}'s shield absorbs it` };
  }
  const dmg = crit ? maxDice(weaponDamage) + rollDamage(weaponDamage, rng) : rollDamage(weaponDamage, rng);
  const hpAfter = Math.max(0, enemy.hp - dmg);
  return {
    hit: true,
    crit,
    damage: dmg,
    enemyHpAfter: hpAfter,
    shieldReadyAfter: false,
    killed: hpAfter <= 0,
    breakdown: `${head}${crit ? " CRIT" : ""} → ${weaponDamage} = ${dmg} · ${enemy.name} ${enemy.hp}→${hpAfter} HP`,
  };
}

/**
 * One enemy attacks the player (or ship). Returns the damage NUMBER; the caller
 * applies it through applyDamage so downed/dead rules run. Enemy crit = max
 * damage only (no bonus roll). `targetAc` should already include cover.
 */
export function enemyAttack(enemy: CombatEnemy, targetAc: number, rng: RNG): AttackOutcome {
  const d20 = rng.int(1, 20);
  const crit = d20 === 20;
  const total = d20 + enemy.atk;
  const head = `${enemy.name} attacks: d20(${d20})+${enemy.atk} = ${total} vs AC ${targetAc}`;
  if (!crit && total < targetAc) return { hit: false, crit: false, damage: 0, breakdown: `${head} → miss` };
  const dmg = crit ? maxDice(enemy.damage) : rollDamage(enemy.damage, rng);
  return { hit: true, crit, damage: dmg, breakdown: `${head}${crit ? " CRIT" : ""} → ${enemy.damage} = ${dmg}` };
}
