/**
 * Multi-turn combat state (COMBAT.md). Scene-scoped runtime data, persisted in
 * campaign_runtime alongside transcript/history — NOT part of the mechanical
 * CampaignState. Null when there is no fight. The engine owns every number here;
 * the narrator only voices results.
 */
import type { UsableConsumable } from "./items";

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

export type CombatActionType = "attack" | "aim" | "cover" | "stim" | "flee" | "item";
export interface CombatAction {
  type: CombatActionType;
  enemyId?: string;
  /** For type "item": the catalog id of the consumable to use. */
  itemId?: string;
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
 *  rebuild them on reload). Kept here (types only) to avoid a server import;
 *  `consumables` is the pre-filtered held-item list from shared/items. */
export function combatActions(
  combat: CombatState,
  consumables: UsableConsumable[],
  burstReady = false,
): { label: string; combatAction: CombatAction }[] {
  const verb = combat.scale === "ship" ? "Fire on" : "Attack";
  const actions: { label: string; combatAction: CombatAction }[] = combat.enemies.map((e) => ({
    label: `${verb} ${e.name} (${e.hp}/${e.maxHp})`,
    combatAction: { type: "attack", enemyId: e.id },
  }));
  const itemChips = consumables.map((u) => ({
    label: `${u.verb} ${u.name} (×${u.count})`,
    combatAction: { type: "item" as const, itemId: u.itemId },
  }));
  if (combat.scale === "ship") {
    actions.push({ label: "Evasive maneuvers (+AC)", combatAction: { type: "cover" } });
    actions.push(...itemChips);
    actions.push({ label: burstReady ? "Burst-drive away" : "Break off and run", combatAction: { type: "flee" } });
    return actions;
  }
  actions.push({ label: "Take aim (+2 next hit)", combatAction: { type: "aim" } });
  actions.push({ label: "Take cover (+2 AC)", combatAction: { type: "cover" } });
  actions.push(...itemChips);
  actions.push({ label: "Flee", combatAction: { type: "flee" } });
  return actions;
}

/**
 * Map a FREE-TYPED action during a live fight to a combat action, so typing can
 * never bypass the engine (the player narrating "I gun them all down" must still
 * resolve a real round). Keyword-parsed; the default is an attack on the named
 * enemy, else the first living one — combat's overwhelming intent.
 */
export function interpretCombatText(
  text: string,
  combat: CombatState,
  consumables: UsableConsumable[],
): CombatAction {
  const t = ` ${text.toLowerCase()} `;
  if (/\b(flee|run|escape|retreat|disengage|break off|bail|burst|withdraw)\b/.test(t)) return { type: "flee" };
  if (consumables.length && /\b(stim|heal|medkit|patch|shield cell|inject|use)\b/.test(t)) {
    const named = consumables.find((c) => t.includes(c.name.toLowerCase()));
    return { type: "item", itemId: (named ?? consumables[0]).itemId };
  }
  if (/\b(cover|duck|hide|shelter|evasive|evade|dodge|behind)\b/.test(t)) return { type: "cover" };
  if (/\b(aim|steady|line up|line-up|focus|brace|sight)\b/.test(t)) return { type: "aim" };
  const living = combat.enemies.filter((e) => e.hp > 0);
  const named = living.find((e) => t.includes(e.name.toLowerCase()));
  return { type: "attack", enemyId: (named ?? living[0])?.id };
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
