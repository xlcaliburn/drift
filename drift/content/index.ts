import economyJson from "./economy.json";
import weaponsJson from "./weapons.json";
import matrixJson from "./matrix.json";
import shipClassesJson from "./shipClasses.json";
import enemyTiersJson from "./enemyTiers.json";
import skillsJson from "./skills.json";

export const economy = economyJson;
export const weapons = weaponsJson;
export const matrix = matrixJson;
export const shipClasses = shipClassesJson;
export const enemyTiers = enemyTiersJson;
export const skills = skillsJson;

export type DamageType = "kinetic" | "energy" | "missile" | "ion";
export type DefenseType = "armor" | "shields" | "evasion" | "pd";

/** Return the {hit, dmg, special} modifier a damage type applies vs a defense. */
export function interaction(dmg: DamageType, def: DefenseType) {
  return matrix.interactions[dmg][def] as {
    hit: number;
    dmg: number;
    special?: string;
  };
}

/** Governing attribute for a skill (falls back to reflex if unknown). */
export function skillAttribute(skill: string): string {
  const key = skill as keyof typeof skills.skills;
  return skills.skills[key]?.attribute ?? "reflex";
}
