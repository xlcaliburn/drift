import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { skillProgress } from "@/engine";
import { shipIsOwned, shipThreadId } from "@/shared/recap";

/**
 * DM style rules — the voice of the game. Kept static and marked for prompt
 * caching so it costs ~10% after the first call. Refine here as drift appears.
 */
const DM_STYLE = `You are the DM of DRIFT, a brutal space-opera TTRPG. Voice and rules:

- Narrate vividly but economically. Second person, present tense. Consequences stick; there is no plot armor; the world moves on its own.
- LENGTH: a routine beat (including the opening) is 2-4 sentences, ~90 words max. Only a genuine set piece (major combat, an emotional turn, a big NPC confrontation) earns more, and even then stay under ~160 words. Never open with a sprawling scene-setting essay — drop the player in and hand them the next decision fast.
- NARRATE ONCE per turn. After a tool returns a result you only need to react to it if the result changes the outcome (a roll's pass/fail, damage dealt, a clock milestone). Do NOT re-describe the scene or add a fresh paragraph just to acknowledge bookkeeping tools (offer_choices, log_world_event) — fire those and stop.
- You do NOT do math or dice. When an action is uncertain and has stakes, call roll_check. For combat, call spawn_encounter then resolve_attack. Never invent numbers — the engine is the source of truth. Narrate the results the tools return.
- Batch your tool calls. When a beat needs several rolls/attacks (a combat round, several simultaneous checks), emit ALL of them as parallel tool calls in ONE response rather than one at a time — it is faster and cheaper. Only sequence calls when a later one genuinely depends on an earlier result.
- Keep narration tight: a few sentences per beat. Save longer, cinematic prose for genuine set pieces (major combat, emotional turns, big NPC confrontations).
- Set stakes=true only when failure has real consequences (this gates skill progression).
- Threats: the default opposition is T2 (professional). Never spawn enemies below the player's weight class; solo T1 mooks do not appear. Introduce a new tier gradually — 1-2 ships first, full groups only after the player has faced the tier.
- Enemy crits are max-damage-only; player crits reroll (the engine handles this).
- Whenever the party arrives somewhere new, give an arrival beat (an observation, an NPC, or a thread development).
- Whenever a scene meaningfully changes a faction's standing (asset destroyed, contact hit, territory shifted), call log_world_event — even in solo play; it seeds the shared universe.
- When a clock's trigger fires, call advance_clock and narrate any milestone effect it returns (these are non-optional).
- End every scene with end_scene, passing whether it was a paying job, dockings, and arrival — the engine runs wages, dock fees, and ticks.
- After narrating a beat (outside active combat resolution), call offer_choices with 2-4 short, concrete next actions the player can click. The player can always type their own, so don't include a "something else" option.
- Honor the player character's stated line they won't cross (given below); a moment that dares them to break it is high drama, never a throwaway.
- STARTING STATUS: a new character is a LOW-LEVEL MINION of their faction with little pull or standing — NPCs treat them as unproven, and access, respect, and better work are earned, not given. Don't hand them authority, big scores, or faction trust for free.
- THE LOANER SHIP: if the ship shows "on loan", the character flies it on their faction's leave and does NOT own it. They earn the title by proving themselves (roughly reaching solid standing, rep ~+4 with their faction, or completing the ship-ownership thread). When they've genuinely earned it, resolve that thread with update_thread (status "resolved") and narrate the title transferring — the ship is then theirs. A character with NO ship begs or borrows passage until they earn a hull of their own. Never narrate the loaner as fully theirs while it is still on loan.
- LOSING THE LOANER: if the player turns hard on their own faction and their standing craters, the faction repossesses the loaner — the engine does this automatically when their parent-faction rep drops low (adjust_rep returns "shipSeized"), and you MUST narrate the repossession and their sudden grounding. It's a real, earned consequence of betraying the people who lent them the hull.
- SHIP-COMBAT SCALING: the starter loaner is a weak, unshielded hull, not a warship — scale ship-scale threats to the ship the player actually flies, NOT their personal weight class. A loaner-flying minion faces a lone light craft or an evade/escape situation, never a T2 wolfpack as a fair fight. Running (the burst drive) is a legitimate and often correct answer; make fleeing a real option, not a failure. Introduce heavier ship threats only once they fly something that can take them.
- THE FAULT LINE is the season's rising pressure — a Crown–Sable war grinding the whole board toward a reckoning. It advances on its own with time, no matter what the player does. Weave its current phase into the world (see the SEASON line each turn), and read it through the lens of the player's own faction.`;

/** Build the cached system blocks: style rules + universe primer. */
export function buildSystem(state: CampaignState): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: DM_STYLE,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `UNIVERSE PRIMER\n${state.universe.primer}\n\nSTYLE ADDENDUM\n${state.universe.styleRules ?? ""}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/** Naive entity retrieval: which NPCs/threads does the player's message touch? */
export function retrieveEntities(state: CampaignState, playerText: string, focusIds: string[] = []) {
  const text = playerText.toLowerCase();
  const npcs = state.npcs.filter(
    (n) => focusIds.includes(n.id) || text.includes(n.name.toLowerCase()),
  );
  const npcFactionIds = new Set(npcs.map((n) => n.factionId).filter(Boolean));
  const threads = state.threads.filter(
    (t) =>
      t.status === "active" &&
      (t.entityRefs.some((r) => npcs.some((n) => n.id === r) || focusIds.includes(r)) ||
        text.includes(t.title.toLowerCase().split(":")[0])),
  );
  return { npcs, threads, npcFactionIds };
}

/**
 * Assemble the per-turn context slice: current location, present NPCs, relevant
 * active threads, party vitals, ship state, and any clock near a milestone.
 * This is the block that keeps token cost flat regardless of campaign length.
 */
export function buildContextSlice(state: CampaignState, playerText: string, focusIds: string[] = []): string {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const { npcs, threads } = retrieveEntities(state, playerText, focusIds);

  const pc = state.characters.find((c) => c.kind === "pc");
  const party = state.characters.filter((c) => c.kind === "party");

  const vitals = (c: (typeof state.characters)[number]) =>
    `${c.name}: HP ${c.hp}/${c.maxHp}, AC ${c.ac}${c.credits !== undefined ? `, ¢${c.credits}` : ""}${c.loyalty !== undefined ? `, loyalty ${c.loyalty}/5` : ""}${c.fragile ? " [FRAGILE: death saves -4]" : ""}`;

  const ship = state.ship;
  const shipOwnership = ship ? (shipIsOwned(state) ? "OWNED" : "ON LOAN — not yet theirs") : "";
  const shipLine = ship
    ? `${ship.name} (${ship.shipClass}) [${shipOwnership}]: HP ${ship.hp}/${ship.maxHp}, AC ${ship.ac}${ship.evasiveAcBonus ? ` (+${ship.evasiveAcBonus} evasive)` : ""}, shield ${ship.shieldReady ? "ready" : "spent"}, missiles ${ship.weapons.find((w) => w.type === "missile")?.ammo ?? 0}`
    : "no ship (grounded — begs/borrows passage until they earn a hull)";

  const clocksLine = state.clocks
    .filter((c) => c.status === "active")
    .map((c) => {
      const near = c.milestones.some((m) => !m.done && m.at === c.current + 1);
      return `${c.name}: ${c.current}/${c.max}${near ? " ⚠ next tick hits a milestone" : ""}`;
    })
    .join("; ");

  const repLine = state.factionRep
    .map((r) => `${state.factions.find((f) => f.id === r.factionId)?.name ?? r.factionId} ${r.rep >= 0 ? "+" : ""}${r.rep}`)
    .join(", ");

  // The Fault Line — the season's shared pressure. Surface its current phase every
  // turn so the narrator keeps it in play and reads it through the PC's faction.
  const faultLine = state.clocks.find((c) => c.id === "clk-faultline");
  const pcFactionName = pc?.parentFactionId
    ? state.factions.find((f) => f.id === pc.parentFactionId)?.name ?? "the PC's faction"
    : "the PC's faction";
  let seasonLine = "";
  if (faultLine) {
    const crossed = faultLine.milestones.filter((m) => m.at <= faultLine.current).slice(-1)[0];
    const next = faultLine.milestones.find((m) => m.at > faultLine.current);
    const phase = crossed ? crossed.effect : "the lanes are only beginning to crack — tension, not yet blood";
    const nextStr = next ? ` Coming at day ${next.at}: ${next.effect}.` : " The reckoning is here.";
    seasonLine = `SEASON — THE FAULT LINE (day ${faultLine.current}/${faultLine.max}): ${phase}. Shared pressure on every faction; read it through ${pcFactionName}, the PC's side.${nextStr}`;
  }
  const moralLine = pc?.moralCode ? `PC's line they won't cross: ${pc.moralCode}.` : "";

  return [
    `CURRENT SCENE`,
    `Location: ${loc ? `${loc.name} — ${loc.description}` : "unknown"}`,
    ...(seasonLine ? [seasonLine] : []),
    ``,
    `PC skills (id: ${pc?.id ?? "pc"}): ${pc ? pc.skills.map(skillProgress).join(" · ") : "—"}`,
    ...(moralLine ? [moralLine] : []),
    `Party & PC vitals:`,
    ...state.characters.map((c) => `  ${vitals(c)} (id: ${c.id})`),
    `Ship: ${shipLine}`,
    ``,
    npcs.length ? `NPCs in play:\n${npcs.map((n) => `  - ${n.name} (id: ${n.id}): ${n.oneBreath}`).join("\n")}` : `NPCs in play: none flagged`,
    ``,
    threads.length ? `Relevant threads:\n${threads.map((t) => `  - ${t.title} (id: ${t.id}): ${t.body}`).join("\n")}` : `Relevant threads: none flagged`,
    ``,
    `Clocks: ${clocksLine}`,
    `Faction rep: ${repLine}`,
    ``,
    `Entity ids for tools — characters: ${state.characters.map((c) => c.id).join(", ")}; ship: ${state.ship?.id ?? "none"}; clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}${state.ship && !shipIsOwned(state) ? `; ship-ownership thread (resolve to grant the title): ${shipThreadId(state.campaign.id)}` : ""}.`,
  ].join("\n");
}
