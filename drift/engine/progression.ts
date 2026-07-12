import type { Character, Skill } from "@/shared/schemas";
import type { EngineEvent } from "./events";

/** Ticks required to reach the next level: (currentLevel + 1) * 3. */
export function nextLevelCost(currentLevel: number): number {
  return (currentLevel + 1) * 3;
}

/** Display max for the tick bar at the character's current level. */
export function tickMax(currentLevel: number): number {
  return nextLevelCost(currentLevel);
}

export interface TickResult {
  character: Character;
  ticked: boolean;
  leveledUp: boolean;
  event: EngineEvent;
}

/**
 * Award one tick to a skill, respecting the max-1-tick-per-skill-per-scene cap.
 * `alreadyTicked` is the set of skill names already ticked this scene for this
 * character. Levels up when ticks reach (level+1)*3, carrying any overflow.
 *
 * Message format matches the save file's disambiguation rule:
 *   "Gunnery (lvl 1): 4→5/6"  or on level up  "Gunnery LEVEL UP → lvl 2 (0/9)"
 */
export function awardTick(
  character: Character,
  skillName: string,
  alreadyTicked: Set<string>,
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
  const beforeLevel = sk.level;
  sk.ticks += 1;
  let leveledUp = false;

  const cost = nextLevelCost(sk.level);
  if (sk.ticks >= cost) {
    sk.level += 1;
    sk.ticks -= cost; // carry overflow
    leveledUp = true;
  }

  const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
  const label = cap(skillName);
  const breakdown = leveledUp
    ? `${label} LEVEL UP → lvl ${sk.level} (${sk.ticks}/${tickMax(sk.level)})`
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
