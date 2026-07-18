// Mechanical tuning catalogs now live PHYSICALLY inside the pack
// (content/pack/drift/*.json — Modularity M1 Task A: canonLint scans loose
// content/ for world data, so these can't sit here anymore). Imported directly
// (not via `pack.catalogs`, which is deliberately loosely-typed for validation
// only) so every consumer keeps its precise JSON-inferred type — zero call-site
// churn outside this file plus the one direct JSON importer (shared/items.ts,
// repointed to this facade below).
import economyJson from "./pack/drift/economy.json";
import weaponsJson from "./pack/drift/weapons.json";
import shipClassesJson from "./pack/drift/shipClasses.json";
import enemyTiersJson from "./pack/drift/enemyTiers.json";
import crewJson from "./pack/drift/crew.json";
import itemsJson from "./pack/drift/items.json";
// Ship2 CombatSystem statlines — a typed .ts module, not raw JSON (see that
// file's comment); imported directly here for the same reason the other
// catalogs are (precise types, zero call-site churn outside this facade).
import { driftShip2 } from "./pack/drift/ship2";
// RULES vocabulary (verb→skill map, damage-interaction matrix) — NOT world
// flavor, stays global. See HANDOFF_MODULARITY_M1.md's out-of-scope note.
import matrixJson from "./matrix.json";
import skillsJson from "./skills.json";

export const economy = economyJson;
export const weapons = weaponsJson;
export const matrix = matrixJson;
export const shipClasses = shipClassesJson;
export const enemyTiers = enemyTiersJson;
export const skills = skillsJson;
export const crew = crewJson;
export const items = itemsJson;
export const ship2 = driftShip2;

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

/** Compact "name — what it covers" list of every skill, for the narrator prompt
 *  so it picks the right skill (e.g. an FTL jump = navigation, not zeroG). */
export function skillReference(): string {
  return Object.entries(skills.skills)
    .map(([name, def]) => `${name} — ${(def as { does?: string }).does ?? ""}`)
    .join("\n");
}

/** Governing attribute for a skill (falls back to reflex if unknown). */
export function skillAttribute(skill: string): string {
  const key = skill as keyof typeof skills.skills;
  return skills.skills[key]?.attribute ?? "reflex";
}

/** Whether failing this skill can physically hurt you (carries failure damage).
 *  Only hazard skills do — ability checks (perception, negotiation…) never do. */
export function isHazardSkill(skill: string): boolean {
  const def = skills.skills[skill as keyof typeof skills.skills] as { hazard?: boolean } | undefined;
  return def?.hazard === true;
}
