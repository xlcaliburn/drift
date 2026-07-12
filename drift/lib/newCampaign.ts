import type { CampaignState, Character } from "@/shared/schemas";
import { universe, factions, locations, npcs } from "@/scripts/seedData";
import { seasonOneSpine, factionBriefs } from "@/content/briefs";

/** Where each faction plants a new recruit at the start. */
const FACTION_HOME: Record<string, string> = {
  "f-crown": "loc-meridian",
  "f-meridian": "loc-meridian",
  "f-sable": "loc-rook",
  "f-ledger": "loc-rook",
  "f-undertow": "loc-undertow",
  "f-talos": "loc-talos",
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
    clocks: [],
    threads,
    contracts: [],
  };
}
