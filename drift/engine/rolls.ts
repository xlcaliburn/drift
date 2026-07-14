import type { Character } from "@/shared/schemas";
import { skillAttribute, skills, economy } from "@/content";
import type { RNG } from "./rng";
import type { EngineEvent } from "./events";
import { skillProficiency } from "./progression";

export interface CheckInput {
  character: Character;
  /** Skill or action key, e.g. "piloting", "gunnery", "shipSensors". */
  skill: string;
  dc: number;
  /** Real stakes? Only stakes DC13+ rolls are tick-eligible. */
  stakes?: boolean;
  /** One-off modifier: assists, cover, gear not baked into actionModifiers. */
  situationalMod?: number;
  /** Ship DC modifier (racing thrusters = -2, i.e. easier). Applied to DC. */
  dcModifier?: number;
  /** Unique-skill trigger: resolve this check as a natural 20 (auto-crit). */
  forceNat20?: boolean;
}

export interface CheckResult {
  d20: number;
  modifier: number;
  total: number;
  dc: number;
  outcome: "success" | "failure";
  /** Natural 20 — auto-success + a stronger result. */
  critical: boolean;
  /** Natural 1 — auto-failure + a worse result (fumble). */
  criticalFailure: boolean;
  tickEligible: boolean;
  breakdown: string;
  event: EngineEvent;
}

/**
 * A passive unique-skill bonus applicable to this skill, if any.
 * Skill-targeted buffs match by skill name; attribute-targeted buffs match any
 * skill governed by that attribute.
 */
export function passiveBonus(character: Character, skill: string): number {
  const u = character.uniqueSkill;
  if (!u || u.kind !== "passive" || !u.passiveAmount) return 0;
  if (u.passiveTargetType === "skill" && u.passiveTarget === skill) return u.passiveAmount;
  if (u.passiveTargetType === "attribute" && skillAttribute(skill) === u.passiveTarget) {
    return u.passiveAmount;
  }
  return 0;
}

/** Is this action key a real, level-able skill (has a skills.json entry)? */
function isKnownSkill(skill: string): boolean {
  return (skills.skills as Record<string, unknown>)[skill] !== undefined;
}

/**
 * The character's modifier for a skill/action.
 *
 * A real SKILL is ALWAYS live-derived: governing attribute mod + COMPRESSED
 * skill proficiency (`skillProficiency(level)` = ceil(level/2) → +0…+5, NOT raw
 * level) + unique-skill passive + situational. We deliberately IGNORE any
 * `actionModifiers` ("Quick Reference Card") entry for a real skill — that value
 * is a snapshot frozen at authoring/creation time, so it goes stale the instant
 * the skill levels up via `awardTick`. That freeze was the cause of the
 * "negotiation level 2 still rolls +0" bug: the QRC entry was captured at level
 * 0 and never re-derived. (Creation only ever writes an empty `{}` anyway, so
 * this changes nothing for app-created characters.)
 *
 * NON-skill action keys (`deathSave`, `shipSensors`, `initiative`, …) have no
 * governing-attribute mapping in skills.json and never accrue skill levels, so
 * they can't go stale. For those we honor the stored `actionModifiers` value —
 * it's the only place that bonus lives (e.g. a fragile character's
 * vitality-routed death save, or a ship's sensor gear) — falling back to plain
 * derivation when absent. A passive bonus and situational modifier stack on top
 * in both branches.
 */
export function computeModifier(
  character: Character,
  skill: string,
  situationalMod = 0,
): number {
  const passive = passiveBonus(character, skill);

  if (!isKnownSkill(skill)) {
    const override = character.actionModifiers?.[skill];
    if (override !== undefined) return override + passive + situationalMod;
  }

  const attrKey = skillAttribute(skill) as keyof Character["attributes"];
  const attrMod = character.attributes[attrKey] ?? 0;
  const sk = character.skills.find((s) => s.name === skill);
  const level = sk?.level ?? 0;
  return attrMod + skillProficiency(level) + passive + situationalMod;
}

export function rollCheck(input: CheckInput, rng: RNG): CheckResult {
  const { character, skill, stakes = false, situationalMod = 0 } = input;
  const modifier = computeModifier(character, skill, situationalMod);
  const dc = input.dc + (input.dcModifier ?? 0);
  const d20 = input.forceNat20 ? 20 : rng.int(1, 20);
  const critical = d20 === 20;
  const criticalFailure = d20 === 1 && !input.forceNat20;
  const total = d20 + modifier;
  // Naturals are decisive: a 20 always succeeds, a 1 always fails, regardless of
  // the modifier — that's what makes them worth calling out.
  const outcome = critical ? "success" : criticalFailure ? "failure" : total >= dc ? "success" : "failure";
  const tickEligible = stakes && input.dc >= economy.tickRule.minDcForTick;

  const sign = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const sig = input.forceNat20
    ? " [SIGNATURE]"
    : critical
      ? " [CRIT]"
      : criticalFailure
        ? " [FUMBLE]"
        : "";
  const breakdown = `${skill}: d20(${d20})${sig} ${sign} = ${total} vs DC ${dc} → ${outcome}`;

  return {
    d20,
    modifier,
    total,
    dc,
    outcome,
    critical,
    criticalFailure,
    tickEligible,
    breakdown,
    event: {
      type: "roll",
      breakdown,
      skill,
      total,
      dc,
      outcome,
      tickEligible,
    },
  };
}
