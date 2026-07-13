/**
 * Multi-turn combat state (COMBAT.md). Scene-scoped runtime data, persisted in
 * campaign_runtime alongside transcript/history — NOT part of the mechanical
 * CampaignState. Null when there is no fight. The engine owns every number here;
 * the narrator only voices results.
 */

export type CombatTier = "T1" | "T2" | "T3";

export interface CombatEnemy {
  id: string;
  name: string;
  tier: CombatTier;
  hp: number;
  maxHp: number;
  ac: number;
  atk: number;
  /** Damage dice, e.g. "2d8". */
  damage: string;
  /** T2+ may carry a shield that negates the first hit. */
  shieldReady: boolean;
  /** T3 elites attack twice. */
  multiAttack: boolean;
}

export interface CombatState {
  active: boolean;
  round: number; // 1-based
  scale: "personal" | "ship";
  enemies: CombatEnemy[];
  /** +AC vs the enemy volley while in cover (persists until the player acts otherwise). */
  playerCoverAc: number;
  /** +to-hit on the player's next attack (consumed after one attack). */
  playerAimBonus: number;
  /** Escalates the flee DC on repeated attempts. */
  fleeAttempts: number;
}

/** The player's derived combat profile for the current scale. */
export interface PlayerCombatant {
  hp: number;
  maxHp: number;
  ac: number;
  attackMod: number;
  weaponDamage: string;
  /** Best combat-skill level, for the flee-disparity math. */
  combatLevel: number;
}

const TIER_LEVEL: Record<CombatTier, number> = { T1: 1, T2: 2, T3: 3 };

/** Highest threat tier currently in play. */
export function threatLevel(enemies: CombatEnemy[]): number {
  return enemies.reduce((m, e) => Math.max(m, TIER_LEVEL[e.tier]), 0);
}

/**
 * Escape-by-disparity (COMBAT.md): the more outmatched you are, the easier it is
 * to run — so "flee the pros/the warship" is the reliable play when outclassed,
 * without nerfing enemies. DC rises on repeated attempts.
 */
export function fleeDC(threat: number, playerCombatLevel: number, fleeAttempts: number): number {
  const disparity = Math.max(0, threat - playerCombatLevel);
  return Math.max(5, Math.min(20, 10 + 2 * fleeAttempts - 3 * disparity));
}
