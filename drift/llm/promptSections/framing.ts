import { inTutorial, TUTORIAL_CHOICE_DIRECTIVE, TUTORIAL_JSON_DIRECTIVE } from "@/shared/tutorial";
import { RECENT_SCENES_IN_PROMPT } from "@/shared/scene";
import { tokenize } from "../retrieval";
import type { Section } from "./types";

/**
 * Scene-framing sections: the tutorial directive, the "PREVIOUSLY" story-so-far,
 * the player's own aim, the current-scene header, the season pressure, and the
 * live scene card. These set the stage before the mechanical state.
 */

/** While the player is still on training wheels, lead with the tutorial directive
 *  so it outranks the static style rules for this beat. */
export const tutorial: Section = ({ state, jsonMode }) =>
  inTutorial(state) ? [jsonMode ? TUTORIAL_JSON_DIRECTIVE : TUTORIAL_CHOICE_DIRECTIVE, ``] : [];

/** PREVIOUSLY: the last few scene summaries — the rolling "story so far" — plus up
 *  to 2 OLDER scenes retrieved because their people/places resurfaced. */
export const previously: Section = ({ playerText, focusIds, npcs, memory }) => {
  const allRecent = memory?.recentScenes ?? [];
  const tail = allRecent.slice(-RECENT_SCENES_IN_PROMPT);
  const tailSeqs = new Set(tail.map((s) => s.seq));
  const turnTokens = new Set(tokenize(playerText));
  const surfacedIds = new Set<string>([...npcs.map((n) => n.id), ...focusIds]);
  const recalled = allRecent
    .filter((s) => !tailSeqs.has(s.seq))
    .map((s) => {
      let score = 0;
      if (s.entityRefs.some((r) => surfacedIds.has(r))) score += 50;
      score += tokenize(s.title).filter((w) => turnTokens.has(w)).length * 20;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.s)
    .sort((a, b) => a.seq - b.seq);
  const previously = [...recalled, ...tail];
  if (!previously.length) return [];
  return [
    `PREVIOUSLY (older scenes, oldest first — this HAPPENED; stay consistent with it):\n${previously
      .map((s) => `  ${s.seq}. ${s.title}: ${s.summary}`)
      .join("\n")}`,
    ``,
  ];
};

/** The player's OWN stated aim (campaign.directive) — the single strongest signal
 *  of what THIS player wants out of play. The narrator bends the world toward it
 *  and, crucially, does NOT force an unrelated questline. */
export const directive: Section = ({ state }) =>
  state.campaign.directive?.trim()
    ? [
        `PLAYER'S OWN AIM (what THIS player wants from the game — weight this heavily): "${state.campaign.directive.trim()}". Bend the world toward it: offer NPCs, scenes, and hooks that serve it, and let it BE the throughline. Do NOT force an unrelated questline on a player who wants something else — if they lean toward people and talk, relationships and social play are the point, not a detour from "the real quest."`,
        ``,
      ]
    : [];

export const sceneHeader: Section = ({ loc }) => [
  `CURRENT SCENE`,
  `Location: ${loc ? `${loc.name} — ${loc.description}` : "unknown"}`,
];

/** The Fault Line — the season's shared pressure. Surface its current phase every
 *  turn so the narrator keeps it in play and reads it through the PC's faction. */
export const season: Section = ({ state, pc }) => {
  const faultLine = state.clocks.find((c) => c.id === "clk-faultline");
  if (!faultLine) return [];
  const pcFactionName = pc?.parentFactionId
    ? state.factions.find((f) => f.id === pc.parentFactionId)?.name ?? "the PC's faction"
    : "the PC's faction";
  const crossed = faultLine.milestones.filter((m) => m.at <= faultLine.current).slice(-1)[0];
  const next = faultLine.milestones.find((m) => m.at > faultLine.current);
  const phase = crossed ? crossed.effect : "the lanes are only beginning to crack — tension, not yet blood";
  const nextStr = next ? ` Coming at day ${next.at}: ${next.effect}.` : " The reckoning is here.";
  return [
    `SEASON — THE FAULT LINE (day ${faultLine.current}/${faultLine.max}): ${phase}. Shared pressure on every faction; read it through ${pcFactionName}, the PC's side.${nextStr}`,
  ];
};

/** SCENE NOW: the current scene's working memory (engine-owned card). */
export const sceneNow: Section = ({ memory }) => {
  const card = memory?.sceneCard;
  if (!card) return [];
  return [
    [
      `SCENE NOW (scene ${card.seq}, turn ${card.turnCount})`,
      ...(card.place ? [`Where: ${card.place} (the player is HERE now, not necessarily the station above)`] : []),
      ...(card.situation ? [`Situation: ${card.situation}`] : []),
      ...(card.dangers?.length
        ? [`⚠ ACTIVE DANGERS: ${card.dangers.join(" · ")} — keep these in play until dealt with (clear via scene.dangers).`]
        : []),
      ...(card.beats.length ? [`Established this scene: ${card.beats.join(" · ")}`] : []),
    ].join("\n"),
  ];
};
