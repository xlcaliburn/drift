import { TRUST_THRESHOLD, ALLY_THRESHOLD } from "@/shared/scene";
import type { Section } from "./types";

/**
 * RELATIONSHIPS.md — relationship-TIER guidance for the NPCs in the scene. Deepening
 * a bond unlocks concrete behavior the narrator should play; the engine owns WHEN
 * (the disposition scalar), the narrator owns HOW. Only PRESENT NPCs are considered,
 * to bound tokens. Each present NPC contributes at most one directive line:
 *
 * - resolved arc → the campaign-side outcome, layered over the shared oneBreath.
 * - trusted (+2) & arc not started → OFFER their personal want as a favor (the engine
 *   also surfaces an accept chip that turn).
 * - trusted & arc active → reference the ongoing favor.
 * - ally (+3) → they'll take real risks for the player.
 */
export const npcTiers: Section = ({ state, memory }) => {
  const rels = memory?.npcRelations ?? {};
  const present = memory?.sceneCard?.presentNpcIds ?? [];
  if (!present.length) return [];

  const lines: string[] = [];
  for (const id of present) {
    const rel = rels[id];
    if (!rel) continue;
    const npc = state.npcs.find((n) => n.id === id);
    if (!npc) continue;
    const name = npc.name;

    if (rel.arcStage === "resolved") {
      if (rel.arcNote) lines.push(`  - ${name} (in YOUR story): ${rel.arcNote} — treat this as fact.`);
      continue;
    }
    if (rel.disposition >= TRUST_THRESHOLD && !rel.arcStage) {
      const want = npc.backstory?.trim();
      lines.push(
        `  - ${name} TRUSTS you — have them open up and RAISE their personal stake in their own voice, then offer you help with it${want ? ` (${want})` : ""}. Do NOT resolve it or hand over a reward; the engine tracks it once accepted.`,
      );
      continue;
    }
    if (rel.arcStage === "active") {
      lines.push(`  - ${name} is counting on your help with their personal favor — reference it; the engine tracks completion.`);
      continue;
    }
    if (rel.disposition >= ALLY_THRESHOLD) {
      lines.push(`  - ${name} is a true ally — they will take real risks for you (back you in a fight, cover for you, vouch to their people).`);
    }
  }

  if (!lines.length) return [];
  return [`RELATIONSHIP CUES (how these people act toward you now — play them):\n${lines.join("\n")}`, ``];
};
