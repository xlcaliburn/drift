import { Character, type Attributes, type Skill } from "@/shared/schemas";
import type { CreationInput } from "@/shared/multiplayer";
import { backgrounds, biasSkills, biasAttribute, attributeBaseline } from "@/content/creation";

/**
 * Turn character-creation answers into a starting sheet — pure and
 * deterministic. Tuned for parity: every background nets +3 attribute points
 * and comparable gear, so answers change shape, not power.
 */
export function buildCharacterFromCreation(
  input: CreationInput,
  ids: { id: string; campaignId: string },
): Character {
  const bg = backgrounds.find((b) => b.id === input.background);
  if (!bg) throw new Error(`unknown background: ${input.background}`);

  // Attributes: your FOCUS drives the primary (+3) — it's the main build choice —
  // and the background adds a secondary (+1) and a weakness (-1) for texture.
  // Net is always +3 regardless of overlap, so every character stays equal-footing.
  const attributes: Attributes = { ...attributeBaseline };
  attributes[biasAttribute[input.bias]] += 3;
  attributes[bg.secondary] += 1;
  attributes[bg.weakness] -= 1;

  // Skills: bias grants + the background's signature skill (+1, merged).
  const skills: Skill[] = biasSkills[input.bias].map((s) => ({
    name: s.name,
    level: s.level,
    ticks: 0,
  }));
  addSkillLevel(skills, bg.signatureSkill, 1);

  // Vitals derived from attributes + gear. Base 10: pairs with the hazard-damage
  // scale (⚠5 max = 10 = exactly one-shot territory for a fresh character).
  const maxHp = Math.max(1, 10 + attributes.vitality);
  const armorBonus = bg.gear.reduce((sum, g) => sum + (g.acBonus ?? 0), 0);
  const ac = 10 + attributes.reflex + armorBonus;

  return Character.parse({
    id: ids.id,
    campaignId: ids.campaignId,
    kind: "pc",
    name: input.name,
    attributes,
    hp: maxHp,
    maxHp,
    ac,
    slots: 8,
    maxSlots: 8,
    stims: 2,
    credits: 120, // flat starting credits — equal footing, thin (a low-level minion's pocket)
    fragile: false,
    skills,
    actionModifiers: {},
    backstory: bg.hook,
    drives: input.flavor.moralCode,
    gear: bg.gear,
    injuries: [],
    parentFactionId: input.parentFactionId,
    loyaltyToParent: 4,
    bias: input.bias,
    alignment: input.alignment,
    sex: input.sex,
    background: input.background,
    ambition: input.ambition,
    moralCode: input.flavor.moralCode,
    uniqueSkill: input.uniqueSkill,
  });
}

function addSkillLevel(skills: Skill[], name: string, delta: number) {
  const existing = skills.find((s) => s.name === name);
  if (existing) existing.level += delta;
  else skills.push({ name, level: delta, ticks: 0 });
}
