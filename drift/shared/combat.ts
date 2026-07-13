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
  /** T2+ / shielded ships negate the first hit. */
  shieldReady: boolean;
  /** T3 elites / corvettes attack twice. */
  multiAttack: boolean;
  // ── Ship-scale only (undefined for personal enemies) ──
  weaponType?: "kinetic" | "energy" | "missile" | "ion";
  isEvasive?: boolean;
  hasPointDefense?: boolean;
  armored?: boolean;
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

export type CombatActionType = "attack" | "aim" | "cover" | "stim" | "flee";
export interface CombatAction {
  type: CombatActionType;
  enemyId?: string;
}
/** How the round ended (or didn't). "disabled" is the ship-scale analog of
 *  "downed" — hull at 0, adrift, aftermath narrated (not instant death). */
export type CombatOutcome = "continue" | "victory" | "escaped" | "downed" | "dead" | "disabled";

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

/** Engine-generated combat action chips for a round (shared so the client can
 *  rebuild them on reload). Kept here (types only) to avoid a server import. */
export function combatActions(
  combat: CombatState,
  stims: number,
  burstReady = false,
): { label: string; combatAction: CombatAction }[] {
  const verb = combat.scale === "ship" ? "Fire on" : "Attack";
  const actions: { label: string; combatAction: CombatAction }[] = combat.enemies.map((e) => ({
    label: `${verb} ${e.name} (${e.hp}/${e.maxHp})`,
    combatAction: { type: "attack", enemyId: e.id },
  }));
  if (combat.scale === "ship") {
    actions.push({ label: "Evasive maneuvers (+AC)", combatAction: { type: "cover" } });
    actions.push({ label: burstReady ? "Burst-drive away" : "Break off and run", combatAction: { type: "flee" } });
    return actions;
  }
  actions.push({ label: "Take aim (+2 next hit)", combatAction: { type: "aim" } });
  actions.push({ label: "Take cover (+2 AC)", combatAction: { type: "cover" } });
  if (stims > 0) actions.push({ label: `Use stim (${stims} left)`, combatAction: { type: "stim" } });
  actions.push({ label: "Flee", combatAction: { type: "flee" } });
  return actions;
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
