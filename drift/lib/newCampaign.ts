import type { CampaignState, Character, Clock, Ship } from "@/shared/schemas";
import { universe, factions, locations, npcs } from "@/scripts/seedData";
import { seasonOneSpine, factionBriefs } from "@/content/briefs";
import { openingFor, type GeneratedOpening, type LoanerDef } from "@/content/openings";
import { shipThreadId } from "@/shared/recap";

/**
 * Every new character starts as a low-level faction minion flying a LOANER hull
 * they do not own. The hull's stats are seeded uniformly here (a weak starter
 * ship) for equal footing; only the name/class/flavor differ per faction. The
 * title is earned in play — not bought — by proving yourself to your faction
 * (see the ship-ownership thread and the narrator guidance in promptBuilder).
 */
function buildLoanerShip(campaignId: string, loaner: LoanerDef): Ship {
  return {
    id: `ship-${campaignId}`,
    campaignId,
    name: loaner.name,
    shipClass: loaner.shipClass,
    // A weak-but-viable starter: enough hull to survive a scrape, one light gun,
    // no shield (that's an earned upgrade). Its real defense is running — the
    // burst drive is charged. Threats are scaled to it by narrator guidance.
    hp: 18,
    maxHp: 18,
    ac: 12,
    evasiveAcBonus: 2,
    damageReduction: 0,
    weapons: [{ name: loaner.weaponName, type: "kinetic", damage: "1d8", count: 1 }],
    hasShield: false,
    shieldReady: false,
    hasPointDefense: false,
    burstDriveReady: true,
    dcModifier: 0,
    buyoutRemaining: 0, // ownership is milestone-earned, not credit-bought
    notes: loaner.notes,
  };
}

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
  "f-sable": "loc-rook",
  "f-undertow": "loc-undertow",
  "f-wreckers": "loc-nest",
  "f-free": "loc-rook",
  "f-reclaimers": "loc-rook",
};

/**
 * Build a fresh shared-world campaign for a newly created character. Reuses the
 * shared universe canon (factions, locations, NPCs) but gives this player their
 * own campaign, starting reputation with their parent faction, and an opening
 * situation tied to the season spine. No ship yet — mobility is earned in play.
 */
export function buildNewCampaignState(
  character: Character,
  playerId?: string,
  generated?: GeneratedOpening,
): CampaignState {
  const campaignId = character.campaignId;
  const parent = character.parentFactionId;
  const brief = factionBriefs.find((b) => b.factionId === parent);
  const factionName = factions.find((f) => f.id === parent)?.name ?? "your faction";
  const homeLoc = FACTION_HOME[parent ?? ""] ?? "loc-meridian";

  // Thinner "minion" start: you begin as a low-level runner with little pull, not
  // a promising recruit. Standing (and the ship title) are climbed from here.
  const factionRep = factions.map((f) => ({
    campaignId,
    factionId: f.id,
    rep: f.id === parent ? 1 : 0,
    standing: f.id === parent ? "Your faction — a low-level minion, unproven" : undefined,
  }));

  const spineHeadline = seasonOneSpine.split("\n\n")[1] ?? seasonOneSpine;
  const opening = openingFor(parent);
  // Context headline: prefer the per-character generated cold-open (from the
  // creation story pass), then the static faction hook, then the tagline. Keeps
  // the free opening recap reading as a real situation, not an empty prompt.
  const context = generated?.situation ?? opening?.hook ?? brief?.tagline ?? "";

  const campaign = {
    id: campaignId,
    universeId: universe.id,
    name: character.name,
    playerId,
    status: "active" as const,
    currentLocationId: homeLoc,
    tendaysElapsed: 0,
    situation: `You've thrown in with ${factionName}. ${context} The lanes are shifting: ${spineHeadline}`,
  };

  // Starting mobility: a faction loaner hull (if the faction gives one), flown but
  // not owned. Factions with no loaner leave the recruit grounded — begging and
  // borrowing passage until they earn a hull of their own.
  const loaner = opening?.loaner;
  const ship = loaner ? buildLoanerShip(campaignId, loaner) : undefined;

  const threads = [
    {
      id: `th-start-${campaignId}`,
      campaignId,
      // The starting questline: prefer the generated, character-specific quest;
      // fall back to the static faction quest, then a generic prompt.
      title: generated?.questTitle ?? opening?.threadTitle ?? `Earn your place with ${factionName}`,
      body:
        generated?.questBody ??
        opening?.threadBody ??
        `You're new and unproven. Prove useful — and decide, before long, whether ${factionName}'s cause is really yours, or whether you're building toward something of your own.`,
      status: "active" as const,
      entityRefs: parent ? [parent] : [],
    },
    // The ship-ownership (or "earn a hull") questline. Its ACTIVE state is what the
    // UI reads to show the loaner as "on loan"; the narrator resolves it when the
    // player earns the title (roughly solid standing / rep ~+4, or completing the
    // arc), which permanently marks the ship as owned.
    ship
      ? {
          id: shipThreadId(campaignId),
          campaignId,
          title: `Earn the title to ${ship.name}`,
          body: `You fly ${ship.name} on ${factionName}'s leave, not your own — it's a loaner, and they can pull it whenever they like. Prove yourself to ${factionName} until they sign the title over, and the ship is finally, fully yours.`,
          status: "active" as const,
          entityRefs: parent ? [parent] : [],
        }
      : {
          id: shipThreadId(campaignId),
          campaignId,
          title: "Earn a hull of your own",
          body: `You have no ship — you beg and borrow passage to move between stations, at other people's mercy and schedule. Build enough standing and coin to get a hull that answers to you, and the lanes open up.`,
          status: "active" as const,
          entityRefs: parent ? [parent] : [],
        },
  ];

  return {
    universe,
    campaign,
    characters: [character],
    ship,
    factions,
    factionRep,
    locations,
    npcs,
    clocks: [buildFaultLineClock(campaignId)],
    threads,
    contracts: [],
  };
}
