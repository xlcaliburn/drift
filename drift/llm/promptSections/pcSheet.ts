import { skillProgress } from "@/engine";
import { backgrounds, ambitions } from "@/content/creation";
import { allItems, itemCount } from "@/shared/items";
import { shipIsOwned } from "@/shared/recap";
import type { Section } from "./types";

/**
 * The character-sheet sections: skills + identity + carried gear + consumables +
 * moral line, then the party/PC vitals, then the ship. The mechanical "who you are
 * and what you're carrying" block the narrator grounds every turn in.
 */

/** PC skills + identity + gear + consumables + the line they won't cross. */
export const pcSheet: Section = ({ pc }) => {
  const lines: string[] = [
    `PC skills (id: ${pc?.id ?? "pc"}): ${pc ? pc.skills.map(skillProgress).join(" · ") : "—"}`,
  ];

  // NAME PIN: the player character is addressed by THIS name and no other. Born
  // from a live drift — an NPC coincidentally named like a past example PC
  // ("Vess") surfaced in context and the narrator started calling the player by
  // it; the summarizer then baked the wrong name into scene memory.
  if (pc?.name) {
    lines.push(
      `THE PLAYER CHARACTER IS "${pc.name}" — NPCs address them as ${pc.name} (or a title/nickname the story earned). NEVER call them by any other character's name, even one that sounds like a protagonist.`,
    );
  }

  // SEX PIN (CHECKS.md §2): sex was never fed to the narrator, so it coin-flipped
  // gender off the NAME — a live PC got "hips swaying" one scene and "stubble…
  // a man" at the mirror the next. Known → a hard every-turn directive covering
  // narration, body descriptions, and how NPCs perceive/address them. Unset
  // (legacy characters predating the field) → explicit NEUTRALITY, never a guess.
  if (pc) {
    lines.push(
      pc.sex
        ? `${pc.name} is ${pc.sex.toUpperCase()} (${pc.sex === "female" ? "she/her" : "he/him"}). Every body description, reflection, and NPC reaction must be consistent with this — never describe or address them as any other sex.`
        : `${pc.name}'s sex has NOT been established. Keep every reference to their body and gender NEUTRAL — no gendered anatomy, facial hair, "the man"/"the woman", or gendered address (sir/ma'am) — until the player establishes it themselves.`,
    );
  }

  // Identity — the PC's past and their drive. Creation bakes these into gear and
  // backstory but they weren't re-fed at play time, so the narrator couldn't pull
  // on them. Surface background + ambition each turn as material for scenes, NPCs,
  // and personal hooks (the ambition's blurb is the emotional lever).
  const bgLabel = pc?.background ? backgrounds.find((b) => b.id === pc.background)?.label ?? pc.background : "";
  const amb = pc?.ambition ? ambitions.find((a) => a.id === pc.ambition) : undefined;
  const identityBits = [
    bgLabel ? `background: ${bgLabel}` : "",
    amb ? `ambition: ${amb.label} — ${amb.description}` : "",
    pc?.appearance ? `appearance: ${pc.appearance}` : "",
  ].filter(Boolean);
  if (pc && identityBits.length) {
    lines.push(
      `PC identity — ${identityBits.join("; ").replace(/\.$/, "")}. Pull on this past and this drive when framing scenes, NPCs, and personal hooks; surface it naturally, don't recite it.`,
    );
  }

  // Everything the PC carries — weapons with damage, tools/flavor items by name —
  // so recently-acquired gear (a looted facemask, a crowbar) stays usable in the
  // fiction instead of vanishing when its pickup scrolls out of history.
  if (pc?.gear.length) {
    lines.push(
      `PC gear (they carry EXACTLY this): ${pc.gear
        .map((g) => `${g.name}${g.qty && g.qty > 1 ? ` ×${g.qty}` : ""}${g.damage ? ` (${g.damage})` : ""}`)
        .join(", ")}.`,
    );
  }

  // Consumables the PC actually holds — so the narrator only offers useItem for
  // items in hand (and knows what's available to spend between fights).
  const held = pc
    ? allItems()
        .filter((i) => i.type === "consumable")
        .map((i) => ({ name: i.name, n: itemCount(pc, i.id) }))
        .filter((x) => x.n > 0)
    : [];
  if (held.length) lines.push(`PC consumables: ${held.map((h) => `${h.name} ×${h.n}`).join(", ")}.`);

  if (pc?.moralCode) lines.push(`PC's line they won't cross: ${pc.moralCode}.`);

  return lines;
};

/** Party & PC vitals — one line each (HP/AC/credits/loyalty/fragile; a hired crew
 *  member also shows their tier/role/wage so the narrator plays them true). */
export const vitals: Section = ({ state }) => {
  const line = (c: (typeof state.characters)[number]) =>
    `${c.name}: HP ${c.hp}/${c.maxHp}, AC ${c.ac}${c.credits !== undefined ? `, ¢${c.credits}` : ""}${c.loyalty !== undefined ? `, loyalty ${c.loyalty}/5` : ""}${c.crewRole ? ` [crew: ${c.crewTier ?? "T1"} ${c.crewRole}, ¢${c.wage ?? 0}/tenday]` : ""}${c.fragile ? " [FRAGILE: death saves -4]" : ""}`;
  return [
    `Party & PC vitals:`,
    ...state.characters.map((c) => `  ${line(c)} (id: ${c.id})`),
    // A Downed PC is handled by the Bleeding Out turn (death saves), not this path,
    // so no downed directive is needed here.
  ];
};

/** The ship line — ownership + exact armament (so the narrator can't invent a
 *  weapon the hull doesn't carry). */
export const ship: Section = ({ state }) => {
  const shipState = state.ship;
  const shipOwnership = shipState ? (shipIsOwned(state) ? "OWNED" : "ON LOAN — not yet theirs") : "";
  const armament = shipState
    ? shipState.weapons.length
      ? shipState.weapons
          .map((w) => `${w.name} (${w.type}${w.type === "missile" ? `, ${w.ammo ?? 0} left` : ""})`)
          .join(", ")
      : "UNARMED — no weapons"
    : "";
  const shipLine = shipState
    ? `${shipState.name} (${shipState.shipClass}) [${shipOwnership}]: HP ${shipState.hp}/${shipState.maxHp}, AC ${shipState.ac}${shipState.evasiveAcBonus ? ` (+${shipState.evasiveAcBonus} evasive)` : ""}, ${shipState.hasShield ? `shield ${shipState.shieldReady ? "ready" : "spent"}` : "no shield"}, burst ${shipState.burstDriveReady ? "ready" : "used"}. Weapons: ${armament} (this is EXACTLY what it carries — invent nothing more).`
    : "no ship (grounded — begs/borrows passage until they earn a hull)";
  return [`Ship: ${shipLine}`];
};
