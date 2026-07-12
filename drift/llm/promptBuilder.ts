import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { skillProgress } from "@/engine";

/**
 * DM style rules — the voice of the game. Kept static and marked for prompt
 * caching so it costs ~10% after the first call. Refine here as drift appears.
 */
const DM_STYLE = `You are the DM of DRIFT, a brutal space-opera TTRPG. Voice and rules:

- Narrate vividly but economically. Second person, present tense. Consequences stick; there is no plot armor; the world moves on its own.
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
- The player's line she won't cross: people aren't cargo.`;

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
  const shipLine = ship
    ? `${ship.name} (${ship.shipClass}): HP ${ship.hp}/${ship.maxHp}, AC ${ship.ac}${ship.evasiveAcBonus ? ` (+${ship.evasiveAcBonus} evasive)` : ""}, shield ${ship.shieldReady ? "ready" : "spent"}, missiles ${ship.weapons.find((w) => w.type === "missile")?.ammo ?? 0}, buyout ¢${ship.buyoutRemaining}`
    : "no ship";

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

  return [
    `CURRENT SCENE`,
    `Location: ${loc ? `${loc.name} — ${loc.description}` : "unknown"}`,
    ``,
    `PC skills (id: vess): ${pc ? pc.skills.map(skillProgress).join(" · ") : "—"}`,
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
    `Entity ids for tools — characters: ${state.characters.map((c) => c.id).join(", ")}; ship: lark; clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}.`,
  ].join("\n");
}
