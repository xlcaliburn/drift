import type { CampaignState, Character, Clock } from "@/shared/schemas";
import { universe, factions, locations, npcs } from "@/scripts/seedData";
import { seasonOneSpine, factionBriefs } from "@/content/briefs";

/** Season length in in-world days — the span the Fault Line clock is mapped over. */
export const SEASON_LENGTH_DAYS = 14;

/**
 * The Fault Line — the season's fixed pressure clock, seeded identically into
 * every campaign. It advances +1 per in-world day (see engine/sceneEnd.ts), NOT
 * on player action: a predetermined metronome that grinds the whole board toward
 * the season reckoning no matter what any one character does. Milestones are
 * phrased faction-neutrally so the narrator localizes each phase to whatever
 * faction the player started in (Crown reads a threat, Sable an opening, and so
 * on). This is the shared, underlying pressure every faction lives under.
 */
export function buildFaultLineClock(campaignId: string): Clock {
  return {
    id: "clk-faultline",
    campaignId,
    name: "The Fault Line",
    current: 0,
    max: SEASON_LENGTH_DAYS,
    triggerText:
      "The season metronome — +1 per in-world day, regardless of anyone's actions. The Crown–Sable war is tearing the lanes apart; every faction lives under it.",
    milestones: [
      { at: 3, effect: "Probing — Crown and Sable escalate; checkpoints and armed escorts multiply on the main lanes", done: false },
      { at: 6, effect: "First blood — an open clash closes a lane; prices spike; neutrals are pressured to declare a side", done: false },
      { at: 9, effect: "No neutral ground — the war spreads; couriers and independents are squeezed, raiders emboldened, law stretched thin", done: false },
      { at: 12, effect: "Open war — the lanes are a battlefield; safe passage is gone; commit or be prey", done: false },
      { at: 14, effect: "The reckoning — the old order breaks and the board is redrawn; the season closes", done: false },
    ],
    status: "active",
  };
}

/** Where each faction plants a new recruit at the start. */
const FACTION_HOME: Record<string, string> = {
  "f-crown": "loc-meridian",
  "f-meridian": "loc-meridian",
  "f-sable": "loc-rook",
  "f-ledger": "loc-rook",
  "f-undertow": "loc-undertow",
  "f-talos": "loc-talos",
  "f-wreckers": "loc-nest",
  "f-free": "loc-rook",
  "f-reclaimers": "loc-rook",
  "f-commons": "loc-meridian",
};

/**
 * Build a fresh shared-world campaign for a newly created character. Reuses the
 * shared universe canon (factions, locations, NPCs) but gives this player their
 * own campaign, starting reputation with their parent faction, and an opening
 * situation tied to the season spine. No ship yet — mobility is earned in play.
 */
export function buildNewCampaignState(character: Character): CampaignState {
  const campaignId = character.campaignId;
  const parent = character.parentFactionId;
  const brief = factionBriefs.find((b) => b.factionId === parent);
  const factionName = factions.find((f) => f.id === parent)?.name ?? "your faction";
  const homeLoc = FACTION_HOME[parent ?? ""] ?? "loc-meridian";

  const factionRep = factions.map((f) => ({
    campaignId,
    factionId: f.id,
    rep: f.id === parent ? 3 : 0,
    standing: f.id === parent ? "Your faction — a new but promising recruit" : undefined,
  }));

  const spineHeadline = seasonOneSpine.split("\n\n")[1] ?? seasonOneSpine;

  const campaign = {
    id: campaignId,
    universeId: universe.id,
    name: character.name,
    status: "active" as const,
    currentLocationId: homeLoc,
    tendaysElapsed: 0,
    situation: `You've thrown in with ${factionName}. ${brief?.tagline ?? ""} The lanes are shifting: ${spineHeadline}`,
  };

  const threads = [
    {
      id: `th-start-${campaignId}`,
      campaignId,
      title: `Earn your place with ${factionName}`,
      body: `You're new and unproven. Prove useful — and decide, before long, whether ${factionName}'s cause is really yours, or whether you're building toward something of your own.`,
      status: "active" as const,
      entityRefs: parent ? [parent] : [],
    },
  ];

  return {
    universe,
    campaign,
    characters: [character],
    ship: undefined,
    factions,
    factionRep,
    locations,
    npcs,
    clocks: [buildFaultLineClock(campaignId)],
    threads,
    contracts: [],
  };
}
