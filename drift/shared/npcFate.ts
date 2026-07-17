import type { CampaignState } from "./schemas";
import type { NpcRelations } from "./scene";
import { appendRelationLog } from "./scene";

/**
 * NPC FATE — engine-recorded life/death (CHECKS.md §2). `Npc.status` existed and
 * retrieval already FILTERED gone NPCs (`npcIsGone`), but nothing ever WROTE it:
 * a named cast NPC killed in combat stayed alive in the cast forever, free to be
 * re-narrated alive later (the cast-level "dead guard comes back" class). The only
 * guard against the model killing a contact was a prose rule.
 *
 * Two writers, one shared path (`markNpcFate`):
 *  - DETERMINISTIC: combat resolution — a defeated enemy whose name matches a
 *    living cast NPC marks them dead the moment the fight ends (resolveCombatRound
 *    is the single dispatcher every fight path flows through).
 *  - BACKSTOP: the scene analyst reports a death/permanent departure the scene
 *    showed that no fight recorded (executed in narration, spaced, shipped off).
 */

/** Strip a name-collision disambiguation suffix ("Ren (fixer)" → "ren") so a
 *  combat name matches the stored record. Same normalization as registerNpc. */
function baseNameOf(n: string): string {
  return n.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Which cast NPC (if any) a combat enemy name refers to. Conservative — exact
 * base-name match only, never the player's own characters/crew (they fight as
 * characters, not npcs), never someone already gone. A generic mook name
 * ("Thug", "Heavy 2") matches nobody unless a cast member literally bears it.
 */
export function matchCastCasualty(
  enemyName: string,
  state: CampaignState,
): CampaignState["npcs"][number] | undefined {
  const en = baseNameOf(enemyName);
  if (!en) return undefined;
  const isCharacter = state.characters.some((c) => baseNameOf(c.name) === en);
  if (isCharacter) return undefined;
  return state.npcs.find(
    (n) => baseNameOf(n.name) === en && !/\b(dead|gone|killed|removed|inactive|departed|left)\b/i.test(n.status ?? ""),
  );
}

/**
 * The single write path for an NPC's fate: sets `status`, stamps the oneBreath-
 * visible note into the relation log so the People panel shows WHY they're gone,
 * and returns the mutated state. Used by combat (deterministic) and the analyst
 * (backstop) so the two can never disagree on what "dead" looks like.
 */
export function markNpcFate(
  state: CampaignState,
  npcRelations: NpcRelations,
  npcId: string,
  fate: "dead" | "gone",
  note: string,
  sceneSeq?: number,
): CampaignState {
  const npc = state.npcs.find((n) => n.id === npcId);
  if (!npc) return state;
  const rel = npcRelations[npcId] ?? { disposition: 0 };
  appendRelationLog(rel, note, sceneSeq);
  rel.lastNote = note.trim().slice(0, 160);
  npcRelations[npcId] = rel;
  return {
    ...state,
    npcs: state.npcs.map((n) => (n.id === npcId ? { ...n, status: fate } : n)),
  };
}

/**
 * Fight's over — record the casualties. For every defeated enemy that matches a
 * living cast NPC, mark them dead with a relation note naming the fight. Returns
 * the names marked (for the engine event log); silent otherwise.
 */
export function applyCombatDeaths(args: {
  state: CampaignState;
  npcRelations: NpcRelations;
  deadEnemyNames: string[];
  place?: string;
  sceneSeq?: number;
}): { state: CampaignState; deadNames: string[] } {
  let { state } = args;
  const deadNames: string[] = [];
  for (const name of args.deadEnemyNames) {
    const npc = matchCastCasualty(name, state);
    if (!npc) continue;
    state = markNpcFate(
      state,
      args.npcRelations,
      npc.id,
      "dead",
      `Killed in the fight${args.place ? ` at ${args.place}` : ""}.`,
      args.sceneSeq,
    );
    deadNames.push(npc.name);
  }
  return { state, deadNames };
}
