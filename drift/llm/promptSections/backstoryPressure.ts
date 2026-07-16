import { backstoryPressureDue, selectBackstoryBeat } from "@/shared/backstoryPressure";
import type { Section } from "./types";

/**
 * BACKSTORY.md Phase 1 — the tenday-pressure backstop. Self-contained: derives
 * everything from `state` + `memory.npcRelations` (already in every SectionCtx), so
 * it needs no new argument threaded through jsonTurn.ts. Fires only once pressure is
 * actually due (shared/backstoryPressure.ts); silent otherwise. Phrasing respects the
 * home-location invariant (world.ts's proximity gate) — an away NPC is reached
 * through comms/rumor/reflection, never teleported into the scene.
 */
export const backstoryPressure: Section = ({ state, memory }) => {
  if (!backstoryPressureDue(state.campaign)) return [];
  const rels = memory?.npcRelations ?? {};
  const present = memory?.sceneCard?.presentNpcIds ?? [];
  const beat = selectBackstoryBeat(state, rels, present);
  if (!beat) return [];

  const pcName = state.characters.find((c) => c.kind === "pc")?.name ?? "the player";
  const guidance =
    beat.kind === "npc"
      ? `Surface ${beat.npcName}'s presence THIS turn or very soon — a message, a thought, a worry, a rumor about them (history: ${beat.note}). If they're not physically here, do NOT teleport them into the scene — reach them through comms, rumor, or reflection instead, same as any other away NPC.`
      : beat.kind === "ambition"
        ? `Let ${pcName}'s ambition surface as an internal beat or a choice tied to it — ${beat.label}: ${beat.description}`
        : `Stage something, even small, that tests ${pcName}'s line: "${beat.text}"`;

  return [
    `BACKSTORY PRESSURE: it's been a while since anything personal surfaced for ${pcName}. ${guidance} Work it in naturally alongside whatever else is happening — don't derail the current scene, just don't let this turn pass without it.`,
    ``,
  ];
};
