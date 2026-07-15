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
/** One labeled contributor to a check's modifier (attribute, skill, signature,
 *  situational, or a non-skill action's baked bonus) — for the audit breakdown. */
export interface ModifierPart {
  label: string;
  value: number;
}

/**
 * The itemized sources of a check's modifier — the same math computeModifier
 * sums, but broken out so the player can SEE where a +2 (or a +0) comes from
 * ("presence +1, skill +1"). Governing attribute + skill proficiency always
 * appear (even at +0, so a flat roll is explained); signature/situational only
 * when they contribute. A non-skill action key with a baked actionModifiers
 * value shows that as its own line.
 */
export function modifierParts(
  character: Character,
  skill: string,
  situationalMod = 0,
): ModifierPart[] {
  const parts: ModifierPart[] = [];
  const passive = passiveBonus(character, skill);

  if (!isKnownSkill(skill)) {
    const override = character.actionModifiers?.[skill];
    if (override !== undefined) {
      parts.push({ label: skill, value: override });
      if (passive) parts.push({ label: "signature", value: passive });
      if (situationalMod) parts.push({ label: "situational", value: situationalMod });
      return parts;
    }
  }

  const attrKey = skillAttribute(skill) as keyof Character["attributes"];
  const attrMod = character.attributes[attrKey] ?? 0;
  const sk = character.skills.find((s) => s.name === skill);
  parts.push({ label: String(attrKey), value: attrMod });
  parts.push({ label: "skill", value: skillProficiency(sk?.level ?? 0) });
  if (passive) parts.push({ label: "signature", value: passive });
  if (situationalMod) parts.push({ label: "situational", value: situationalMod });
  return parts;
}

/** Format the parts as a compact source annotation: "presence +1, skill +1". */
export function formatModifierParts(parts: ModifierPart[]): string {
  return parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : ""}${p.value}`).join(", ");
}

export function computeModifier(
  character: Character,
  skill: string,
  situationalMod = 0,
): number {
  return modifierParts(character, skill, situationalMod).reduce((sum, p) => sum + p.value, 0);
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
  // Tick on a real gamble measured RELATIVE to the character — the raw d20 they had
  // to beat (FACE = dc − modifier) — NOT an absolute DC. The risk-based DC system
  // scales DCs to each character's modifier, so an absolute floor locked low-modifier
  // characters out of XP on their weak skills: a novice's "risky" roll (DC ~10, +0
  // mod) never reached 13, while a specialist's identical-odds roll did. FACE ≥ 10 is
  // a "risky" (~55%) attempt or worse; safe ~80% routines still never tick.
  const faceNeeded = input.dc - modifier;
  const tickEligible = stakes && faceNeeded >= economy.tickRule.minFaceForTick;

  const sign = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const sig = input.forceNat20
    ? " [SIGNATURE]"
    : critical
      ? " [CRIT]"
      : criticalFailure
        ? " [FUMBLE]"
        : "";
  // Itemize where the modifier comes from ("presence +1, skill +1") so a +2 — or a
  // flat +0 — is never a mystery. Omitted only when there's genuinely nothing to
  // show (no parts).
  const parts = modifierParts(character, skill, situationalMod);
  const detail = parts.length ? ` (${formatModifierParts(parts)})` : "";
  const breakdown = `${skill}: d20(${d20})${sig} ${sign}${detail} = ${total} vs DC ${dc} → ${outcome}`;

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
