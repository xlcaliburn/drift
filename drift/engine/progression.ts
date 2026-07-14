import type { Character, Skill } from "@/shared/schemas";
import type { EngineEvent } from "./events";

/** Skill levels cap here — the top of the curve. */
export const MAX_SKILL_LEVEL = 10;

/** Ticks required to reach the next level: (currentLevel + 1) * 6. XP earned per
 *  qualifying roll is 2 on a success, 1 on a failure (engineBridge), so this is a
 *  long grind by design — a level is ~3 clean successes at level 0, more each rung. */
export function nextLevelCost(currentLevel: number): number {
  return (currentLevel + 1) * 6;
}

/** Display max for the tick bar at the character's current level. */
export function tickMax(currentLevel: number): number {
  return nextLevelCost(currentLevel);
}

/**
 * Compressed proficiency — a skill's contribution to a d20 roll. Levels run
 * 0–10, but the die bonus is deliberately bounded (+0…+5), 5e-style bounded
 * accuracy: `ceil(level / 2)` → +0,1,1,2,2,3,3,4,4,5,5. A maxed specialist
 * reliably clears routine DCs without swamping the d20 on hard ones, and since
 * combat attack rolls share this modifier, high level never trivialises a fight.
 * (The tick COST stays quadratic — climbing to 10 is a long grind.)
 */
export function skillProficiency(level: number): number {
  return Math.min(5, Math.ceil(Math.max(0, level) / 2));
}

export interface TickResult {
  character: Character;
  ticked: boolean;
  leveledUp: boolean;
  event: EngineEvent;
}

/**
 * Award XP to a skill, respecting the max-1-award-per-skill-per-scene cap.
 * `amount` is the XP for this event — 2 on a success, 1 on a failure (the caller
 * decides from the roll outcome). `alreadyTicked` is the set of skill names already
 * awarded this scene for this character. Levels up when ticks reach the cost,
 * carrying overflow (looped, so a big award can cross a boundary safely).
 *
 * Message format matches the save file's disambiguation rule:
 *   "Gunnery (lvl 1): 4→6/12"  or on level up  "Gunnery LEVEL UP → lvl 2 (0/18)"
 */
export function awardTick(
  character: Character,
  skillName: string,
  alreadyTicked: Set<string>,
  amount = 1,
): TickResult {
  if (alreadyTicked.has(skillName)) {
    return {
      character,
      ticked: false,
      leveledUp: false,
      event: {
        type: "tick",
        breakdown: `${skillName}: already ticked this scene (capped)`,
        characterId: character.id,
        skill: skillName,
        leveledUp: false,
      },
    };
  }

  const skills = character.skills.map((s) => ({ ...s }));
  let sk = skills.find((s) => s.name === skillName);
  if (!sk) {
    sk = { name: skillName, level: 0, ticks: 0 };
    skills.push(sk);
  }

  const before = sk.ticks;
  sk.ticks += Math.max(1, Math.round(amount));
  let leveledUp = false;

  // Carry overflow across as many level boundaries as the award covers.
  while (sk.level < MAX_SKILL_LEVEL && sk.ticks >= nextLevelCost(sk.level)) {
    sk.ticks -= nextLevelCost(sk.level);
    sk.level += 1;
    leveledUp = true;
  }
  // At the cap the bar sits full; ticks never accrue past it.
  if (sk.level >= MAX_SKILL_LEVEL) sk.ticks = Math.min(sk.ticks, tickMax(MAX_SKILL_LEVEL));

  const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
  const label = cap(skillName);
  const breakdown = leveledUp
    ? `${label} LEVEL UP → lvl ${sk.level} (${sk.ticks}/${tickMax(sk.level)})`
    : sk.level >= MAX_SKILL_LEVEL
      ? `${label} (lvl ${sk.level}, maxed)`
      : `${label} (lvl ${sk.level}): ${before}→${sk.ticks}/${tickMax(sk.level)}`;

  alreadyTicked.add(skillName);

  return {
    character: { ...character, skills },
    ticked: true,
    leveledUp,
    event: {
      type: "tick",
      breakdown,
      characterId: character.id,
      skill: skillName,
      leveledUp,
    },
  };
}

/** Convenience: current progress string for a single skill. */
export function skillProgress(skill: Skill): string {
  return `${skill.name} (lvl ${skill.level}): ${skill.ticks}/${tickMax(skill.level)}`;
}
