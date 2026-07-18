import { describe, it, expect } from "vitest";
import type { CampaignState, Character } from "./schemas";
import type { ChoiceOption } from "./turnPlan";
import type { Job } from "./quests";
import { freshSceneCard, TRUST_THRESHOLD } from "./scene";
import { revalidateChoices } from "./choices";

function pc(over: Partial<Character> = {}): Character {
  return {
    id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 500,
    attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    skills: [], actionModifiers: {}, gear: [], injuries: [], ...over,
  } as unknown as Character;
}

function state(over: {
  characters?: Character[];
  shipHp?: number;
  npcs?: { id: string; name: string; role?: string; locationId?: string }[];
} = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: over.characters ?? [pc()],
    ship: over.shipHp !== undefined
      ? { id: "s", campaignId: "c", name: "Wren", shipClass: "hauler", hp: over.shipHp, maxHp: 10, ac: 12,
          evasiveAcBonus: 0, damageReduction: 0, weapons: [], hasShield: false, shieldReady: false,
          hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0, notes: "" }
      : undefined,
    factions: [], factionRep: [],
    locations: [{ id: "l", universeId: "u", name: "Dock", tags: [] }],
    npcs: (over.npcs ?? []).map((n) => ({ ...n, universeId: "u", oneBreath: "..." })),
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", title: "Courier run", blurb: "", giver: "board", playstyle: "commerce", archetype: "courier", tier: "T1",
  objectives: [], reward: { tier: "T1" }, status: "offered", createdTenday: 0, ...over,
} as unknown as Job);

const ctx = (over: Partial<Parameters<typeof revalidateChoices>[1]> = {}) => ({
  state: state(),
  sceneCard: freshSceneCard(),
  npcRelations: {},
  jobs: [] as Job[],
  ...over,
});

describe("revalidateChoices — the refresh-time chip contract check", () => {
  it("narrative choices (label/verb/check only) always pass through", () => {
    const choices: ChoiceOption[] = [{ label: "Ask the clerk", verb: "talk" }];
    expect(revalidateChoices(choices, ctx())).toEqual(choices);
  });

  it("buyItem: kept while the market still shelves it affordably; dropped elsewhere/broke", () => {
    const marketState = (tags: string[], credits: number) => {
      const s = state({ characters: [pc({ credits })] });
      (s.locations[0] as { tags: string[] }).tags = tags;
      return s;
    };
    const chip: ChoiceOption[] = [{ label: "Buy Medkit — ¢75", buyItem: "medkit" }];
    expect(revalidateChoices(chip, ctx({ state: marketState(["blackmarket"], 500) }) as never)).toHaveLength(1);
    // Spent down → can't afford → chip drops.
    expect(revalidateChoices(chip, ctx({ state: marketState(["blackmarket"], 5) }) as never)).toHaveLength(0);
    // Moved to a marketless site (hazard/hidden) → chip drops.
    expect(revalidateChoices(chip, ctx({ state: marketState(["hazard"], 500) }) as never)).toHaveLength(0);
  });

  it("useItemId: kept while held, dropped once spent", () => {
    const held = ctx({ state: state({ characters: [pc({ gear: [{ name: "Stim", itemId: "stim", qty: 1 }] })] }) }) as never;
    const gone = ctx({ state: state({ characters: [pc({ gear: [] })] }) }) as never;
    const chip: ChoiceOption[] = [{ label: "Use Stim", useItemId: "stim" }];
    expect(revalidateChoices(chip, held)).toHaveLength(1);
    expect(revalidateChoices(chip, gone)).toHaveLength(0);
  });

  it("repairHull: kept while the hull is damaged, dropped once it's already full", () => {
    const damaged = ctx({ state: state({ shipHp: 5 }) });
    const full = ctx({ state: state({ shipHp: 10 }) });
    const chip: ChoiceOption[] = [{ label: "Repair hull (¢60)", repairHull: true }];
    expect(revalidateChoices(chip, damaged as never)).toHaveLength(1);
    expect(revalidateChoices(chip, full as never)).toHaveLength(0);
  });

  it("patronRest: dropped once the PC no longer needs it (healed up elsewhere)", () => {
    const patronNpc = { id: "npc-patron-c", name: "Steward Harrow" };
    const hurt = ctx({
      state: state({ characters: [pc({ hp: 2 })], npcs: [patronNpc] }),
      sceneCard: { ...freshSceneCard(), presentNpcIds: ["npc-patron-c"] },
    });
    const healed = ctx({
      // Full HP AND stocked on stims — patronHelp's needsHelp gate checks both.
      state: state({ characters: [pc({ hp: 18, stims: 3 })], npcs: [patronNpc] }),
      sceneCard: { ...freshSceneCard(), presentNpcIds: ["npc-patron-c"] },
    });
    const chip: ChoiceOption[] = [{ label: "Rest up with Steward Harrow (free)", patronRest: true }];
    expect(revalidateChoices(chip, hurt as never)).toHaveLength(1);
    expect(revalidateChoices(chip, healed as never)).toHaveLength(0);
  });

  it("recruitNpc: dropped once that npc is no longer the live offer (left, already hired, trust dropped)", () => {
    const npc = { id: "npc-kessa", name: "Kessa", role: "medic" };
    const trusted = ctx({
      state: state({ npcs: [npc] }),
      npcRelations: { "npc-kessa": { disposition: TRUST_THRESHOLD, log: [] } },
      sceneCard: { ...freshSceneCard(), presentNpcIds: ["npc-kessa"] },
    });
    const left = ctx({
      state: state({ npcs: [npc] }),
      npcRelations: { "npc-kessa": { disposition: TRUST_THRESHOLD, log: [] } },
      sceneCard: freshSceneCard(), // no longer present
    });
    const chip: ChoiceOption[] = [{ label: "Hire Kessa", recruitNpc: "npc-kessa" }];
    expect(revalidateChoices(chip, trusted as never)).toHaveLength(1);
    expect(revalidateChoices(chip, left as never)).toHaveLength(0);
  });

  it("acceptJob / abandonJob: match the job's LIVE status, not the snapshot", () => {
    const offered = ctx({ jobs: [job({ id: "j1", status: "offered" })] });
    const takenAlready = ctx({ jobs: [job({ id: "j1", status: "active" })] });
    const acceptChip: ChoiceOption[] = [{ label: "Take it", acceptJob: "j1" }];
    expect(revalidateChoices(acceptChip, offered as never)).toHaveLength(1);
    expect(revalidateChoices(acceptChip, takenAlready as never)).toHaveLength(0); // already accepted elsewhere

    const active = ctx({ jobs: [job({ id: "j2", status: "active" })] });
    const finished = ctx({ jobs: [job({ id: "j2", status: "complete" })] });
    const abandonChip: ChoiceOption[] = [{ label: "Walk away", abandonJob: "j2" }];
    expect(revalidateChoices(abandonChip, active as never)).toHaveLength(1);
    expect(revalidateChoices(abandonChip, finished as never)).toHaveLength(0);
  });

  it("swap chips: dropped once the pending pickup is resolved (no longer parked)", () => {
    const pending = ctx({ sceneCard: { ...freshSceneCard(), pendingPickup: { name: "a rifle" } } });
    const resolved = ctx({ sceneCard: freshSceneCard() });
    const chips: ChoiceOption[] = [{ label: "Drop knife → take rifle", swapDrop: "Combat knife" }];
    expect(revalidateChoices(chips, pending as never)).toHaveLength(1);
    expect(revalidateChoices(chips, resolved as never)).toHaveLength(0);
  });

  it("confirmDeath is never filtered — the self-harm gate stays live either way", () => {
    const chip: ChoiceOption[] = [{ label: "Yes — end it", confirmDeath: true }];
    expect(revalidateChoices(chip, ctx() as never)).toHaveLength(1);
  });

  it("a mixed list drops only the invalid entries, keeps the rest in order", () => {
    const s = state({ characters: [pc({ gear: [] })] }); // no stim held
    const choices: ChoiceOption[] = [
      { label: "Ask around", verb: "talk" },
      { label: "Use Stim", useItemId: "stim" },
      { label: "Push on", verb: "go" },
    ];
    const kept = revalidateChoices(choices, ctx({ state: s }) as never);
    expect(kept.map((c) => c.label)).toEqual(["Ask around", "Push on"]);
  });

  it("storyChoice: kept only while the chapter is ACTIVE and UNPICKED (HANDOFF_STORY_1 review)", () => {
    const chip: ChoiceOption[] = [{ label: "The Crown", storyChoice: { chapterId: "ch-1", optionId: "crown" } }];
    const progress = (over: Partial<{ status: "active" | "complete"; choiceOptionId: string }> = {}) => ({
      chapters: { "ch-1": { status: "active" as const, objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0, ...over } },
    });
    // Live and unpicked → kept.
    expect(revalidateChoices(chip, ctx({ storyline: progress() }) as never)).toHaveLength(1);
    // Picked in another tab → the stale chip drops (a story choice can't be re-decided).
    expect(revalidateChoices(chip, ctx({ storyline: progress({ choiceOptionId: "chain" }) }) as never)).toHaveLength(0);
    // Chapter completed → drops.
    expect(revalidateChoices(chip, ctx({ storyline: progress({ status: "complete", choiceOptionId: "chain" }) }) as never)).toHaveLength(0);
    // Chapter unknown to the slice (content edit dropped it) → drops.
    expect(revalidateChoices(chip, ctx({ storyline: { chapters: {} } }) as never)).toHaveLength(0);
    // No storyline slice provided at all → fail open (engine refuses re-picks anyway).
    expect(revalidateChoices(chip, ctx() as never)).toHaveLength(1);
  });
});
