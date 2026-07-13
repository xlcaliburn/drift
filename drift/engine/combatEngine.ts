import type { RNG } from "./rng";
import { rollDamage, maxDice } from "./dice";
import { enemyTiers } from "@/content";
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
}

/** Build persisted enemies from the tier tables. Count clamped 1–4; T2+ shielded. */
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
      const hp = rng.int(t.hpRange[0], t.hpRange[1]);
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
        shieldReady: spec.tier === "T2" || spec.tier === "T3",
        multiAttack: !!t.multiAttack,
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
): PlayerAttackResult {
  const d20 = rng.int(1, 20);
  const crit = d20 === 20;
  const total = d20 + attackMod + aimBonus;
  const aimStr = aimBonus ? `+${aimBonus}(aim)` : "";
  const head = `attack: d20(${d20})+${attackMod}${aimStr} = ${total} vs AC ${enemy.ac}`;

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
