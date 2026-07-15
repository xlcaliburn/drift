import type { CampaignState } from "@/shared/schemas";
import type { CombatState } from "@/shared/combat";
import type { SpawnSpec, ShipClass } from "@/engine/combatEngine";
import type { TurnRuntime } from "./engineBridge";
import { playerThreatTier, clampTier } from "@/shared/netWorth";

/**
 * The gun-skill → combat reroute. A gun skill (smallArms/gunnery) is an act of
 * violence, not a skill check, so invoking one opens a fight instead of rolling a
 * self-only check. Shared by the pre-roll (clicked/inferred check) and mid-turn
 * (model `roll`) paths in jsonTurn. Pure aside from the TurnRuntime it drives.
 */

/** Default enemy ship class when only a tier is known for a ship fight. */
export const TIER_TO_CLASS: Record<"T1" | "T2" | "T3", string> = { T1: "scout", T2: "fighter", T3: "gunship" };

/** Gun skills are acts of violence, not skill checks — invoking one opens a fight.
 *  smallArms → on-foot, gunnery → ship. */
export const COMBAT_SKILLS = new Set(["smallArms", "gunnery"]);

/** A bare gun-skill check carries only a rough DC; read it as enemy toughness. */
export function dcToTier(dc: number): "T1" | "T2" | "T3" {
  return dc >= 17 ? "T3" : dc >= 13 ? "T2" : "T1";
}

/**
 * Reroute a gun-skill attempt into the combat engine: spawn the target (the player
 * drew first, so a surprise edge), resolve the OPENING SHOT (roll-to-hit → damage),
 * then hand back the live CombatState so the beat continues as normal multi-turn
 * combat. Names the foe after a present NPC the player targeted ("shoot Yuri") so
 * the fight shows their name, not a generic "Thug". `preState` is the PRE-turn
 * state used for the net-worth ceiling (a rookie faces T1, not a professional).
 *
 * Returns the lines to emit and the "ENGINE RESULT" context line for the prompt;
 * the caller owns the emit/engineLines side effects.
 */
export function openFightFromSkill(
  runtime: TurnRuntime,
  preState: CampaignState,
  playerText: string,
  skill: string,
  dc: number,
): { combat: CombatState | null; engineLine: string; lines: string[] } {
  const tier = clampTier(dcToTier(dc), playerThreatTier(preState));
  const useShip = skill === "gunnery" && !!preState.ship;
  const text = playerText.toLowerCase();
  const target = runtime.sceneCard.presentNpcIds
    .map((npcId) => runtime.state.npcs.find((n) => n.id === npcId))
    .find((n) => n && n.name.length > 2 && text.includes(n.name.toLowerCase()));
  const started = useShip
    ? runtime.startShipCombat([{ shipClass: TIER_TO_CLASS[tier] as ShipClass, count: 1, tier }], "player")
    : runtime.startCombat([{ tier, count: 1, name: target?.name }] as SpawnSpec[], "player");
  const lines = [...started.lines];
  let cbt = started.combat;
  const firstEnemy = cbt.enemies.find((e) => e.hp > 0);
  if (cbt.active && firstEnemy) {
    const round = runtime.resolveCombatRound(cbt, { type: "attack", enemyId: firstEnemy.id });
    lines.push(...round.lines);
    cbt = round.combat;
  }
  return { combat: cbt.active ? cbt : null, engineLine: `ENGINE RESULT: ${lines.join(" · ")}`, lines };
}
