import type { RNG } from "./rng";

export interface DiceRoll {
  notation: string;
  dice: number[];
  total: number;
}

/** Parse "2d8" -> {count:2, sides:8, flat:0}. Supports an optional +N/-N flat. */
export function parseDice(notation: string): {
  count: number;
  sides: number;
  flat: number;
} {
  const m = notation
    .trim()
    .toLowerCase()
    .match(/^(\d+)d(\d+)\s*([+-]\s*\d+)?$/);
  if (!m) {
    throw new Error(`Unparseable dice notation: "${notation}"`);
  }
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const flat = m[3] ? parseInt(m[3].replace(/\s/g, ""), 10) : 0;
  return { count, sides, flat };
}

/** Roll a dice expression like "2d8". Returns each die plus the total. */
export function rollDice(notation: string, rng: RNG): DiceRoll {
  const { count, sides, flat } = parseDice(notation);
  const dice: number[] = [];
  for (let i = 0; i < count; i++) dice.push(rng.int(1, sides));
  const total = dice.reduce((a, b) => a + b, 0) + flat;
  return { notation, dice, total };
}

/** Maximum possible value of a dice expression (used for crit resolution). */
export function maxDice(notation: string): number {
  const { count, sides, flat } = parseDice(notation);
  return count * sides + flat;
}

/** Format a multi-die roll like "2d8: (3,7) = 10". */
export function formatDice(roll: DiceRoll): string {
  if (roll.dice.length === 1) return `${roll.notation}: ${roll.total}`;
  return `${roll.notation}: (${roll.dice.join(",")}) = ${roll.total}`;
}
