/**
 * DRIFT shared-world canon — the objective universe every campaign is built on:
 * the setting primer, the faction roster, the known locations, and the standing
 * NPC figures a narrator can reach for. This is faction/world data only; it holds
 * NO protagonist, party, or in-progress story. Real play starts from character
 * creation (see lib/newCampaign.ts), which stamps a fresh campaign onto this
 * canon. (The original Vess Karo playthrough now lives only as an engine test
 * fixture: engine/__fixtures__/vessCampaign.ts.)
 */
import type { Universe, Faction, Location, Npc } from "@/shared/schemas";

export const UNIVERSE_ID = "uni-drift";

export const universe: Universe = {
  id: UNIVERSE_ID,
  name: "DRIFT",
  ownerId: undefined,
  primer:
    "Space opera, brutal lethality, no plot armor. THE DRIFT is a hard, lawless stretch of settled space strung between three stations. Known locations: Meridian Ring (Crown territory — legitimate commerce, clean docks, the closest thing to order); Rook Station (~3 days out — the lawless black-market hub of fixers, couriers, and bounty desks); Talos Station (~4 days through the Shear — an isolated, hard-line frontier post in hostile country); The Shear (a deadly debris field between them that eats the careless); the Undertow outpost (a debt-collector base in contested space); the Nest (a Wreckers raider anchorage hidden in the Shear); Halcyon (a neutral independent freeport — a safe harbor for unaligned crews); Coldharbor (the Sable Chain's fortified staging station, pushing openly onto the Crown lanes); Cinderhaul (a grimy ore-refining colony where the Commons organizes the dock crews); the Wake (a colony-ship graveyard at the Shear's edge — Reclaimer salvage country). Factions: the Hollow Crown (establishment loan syndicate) and the rising Sable Chain feud over the Meridian–Rook lanes; the Undertow (debt-collectors and enforcers); the Ledger network (Rook courier-fixers) and Meridian commerce (legitimate trade); Talos security (frontier law); and the lawless or unaligned currents — the Wreckers (pure raiders), Free Drift (independent crews, no patron), the Reclaimers (salvage-tech crews who suspect the Shear wrecks were sabotage), and the Commons (a hunted movement against debt and syndicate rule). The balance of power is cracking: for years the Crown owned these lanes; now the Sable Chain is pushing into them in the open, and everyone is choosing a side or carving out their own. Tone: consequences stick, dice are honest, the world moves on its own.",
  styleRules:
    "Run at the END of every scene: update state; award ticks ONLY on DC13+ stakes rolls (max 1/skill/scene); apply crew wages on paying jobs and dock fees on docking; advance any clock whose trigger fired; give an arrival beat whenever the party reaches somewhere new. Show every roll as a full breakdown. Never spawn enemies below the party's weight class (default threat is T2). Introduce new threat tiers gradually. Enemy crits are max-damage-only; player crits reroll. People aren't cargo.",
};

/** The faction roster of the shared world. Not all are joinable at creation (see
 *  content/briefs.ts for the playable start list) — the rest exist as NPC-run
 *  powers the narrator plays and the player can deal with. */
export const factions: Faction[] = [
  { id: "f-crown", universeId: UNIVERSE_ID, name: "Hollow Crown", description: "Establishment loan syndicate turned patron; contractor tiers (courier/escort/intel). Owns the Meridian–Rook lanes — for now.", defaultRep: 0 },
  { id: "f-undertow", universeId: UNIVERSE_ID, name: "The Undertow", description: "Debt-collection outfit, morally grim — bounties, enforcement, leverage.", defaultRep: 0 },
  { id: "f-ledger", universeId: UNIVERSE_ID, name: "Ledger network (Rook)", description: "Symbol-marked courier-fixers on Rook; move cargo and secrets for anyone, beholden to none.", defaultRep: 0 },
  { id: "f-meridian", universeId: UNIVERSE_ID, name: "Meridian commerce", description: "The legitimate trade houses of the Meridian Ring — brokers, Harrow & Vane, parts depots.", defaultRep: 0 },
  { id: "f-rook", universeId: UNIVERSE_ID, name: "Rook Station street", description: "The lawless hub's general reputation economy.", defaultRep: 0 },
  { id: "f-talos", universeId: UNIVERSE_ID, name: "Talos security", description: "Station security four days through the Shear; hard-line frontier law, suspicious of the inner lanes.", defaultRep: 0 },
  { id: "f-sable", universeId: UNIVERSE_ID, name: "Sable Chain", description: "Rising rival syndicate pushing openly into Crown lanes — aggressive, hungry, the reason the balance is cracking.", defaultRep: 0 },
  { id: "f-wreckers", universeId: UNIVERSE_ID, name: "The Wreckers", description: "Lawless raiders nesting in the Shear; prey on the bulk lanes. No patron, no law — plunder and fear.", defaultRep: 0 },
  { id: "f-free", universeId: UNIVERSE_ID, name: "Free Drift", description: "Loose brotherhood of independent crews; no patron, mutual aid, a no-questions code. Contacts on every side, allegiance to none.", defaultRep: 0 },
  { id: "f-reclaimers", universeId: UNIVERSE_ID, name: "The Reclaimers", description: "Salvage-tech collective pulling hardware and buried truths from derelicts; suspect the Shear wrecks aren't all accidents.", defaultRep: 0 },
  { id: "f-commons", universeId: UNIVERSE_ID, name: "The Commons", description: "Hunted movement against debt and syndicate rule; protects dock crews, sabotages the powerful.", defaultRep: 0 },
];

// `tier` is the LOCATIONS.md danger band (T1 secure / T2 rough / T3 deadly). Set
// explicitly here so canon is deliberate; Rook is a STARTING station so it's pinned
// T1 even though its blackmarket/lawless tags would derive T2 (see shared/locations.ts).
export const locations: Location[] = [
  // ── Safe hubs (T1) — where new players start and lie low ──
  { id: "loc-meridian", universeId: UNIVERSE_ID, name: "Meridian Ring", description: "Crown territory — legitimate commerce, clean docks, the closest thing to order in the lanes.", tags: ["crown", "commerce", "order"], tier: "T1" },
  { id: "loc-rook", universeId: UNIVERSE_ID, name: "Rook Station", description: "Lawless black-market hub ~3 days out — fixers, courier syndicates, bounty desks. Rough edges, but a newcomer's landing spot.", tags: ["blackmarket", "lawless"], tier: "T1" },
  { id: "loc-freeport", universeId: UNIVERSE_ID, name: "Halcyon", description: "A neutral independent freeport — no patron owns it; crews of every stripe dock, trade, and lie low under a no-questions code. A safe harbor for the unaligned.", tags: ["free", "neutral", "haven", "commerce"], tier: "T1" },
  // ── Rough territory (T2) — contested, criminal, working-class ──
  { id: "loc-undertow", universeId: UNIVERSE_ID, name: "Undertow outpost", description: "Debt-collector base in contested space.", tags: ["contested"], tier: "T2" },
  { id: "loc-sable", universeId: UNIVERSE_ID, name: "Coldharbor", description: "The Sable Chain's fortified staging station on the Meridian–Rook lane — sleek, aggressive, the syndicate's open push into Crown territory.", tags: ["sable", "syndicate", "contested"], tier: "T2" },
  { id: "loc-cinder", universeId: UNIVERSE_ID, name: "Cinderhaul", description: "A grimy ore-refining colony of scaffolds and slag — cheap fuel, hard people, and the Commons quietly organizing the dock crews against the syndicates.", tags: ["industrial", "commons", "frontier"], tier: "T2" },
  // ── Deadly frontier (T3) — punch above your weight for the big scores ──
  { id: "loc-talos", universeId: UNIVERSE_ID, name: "Talos Station", description: "Isolated frontier post ~4 days through the Shear — hard-line security, hostile to outsiders.", tags: ["frontier", "hostile"], tier: "T3" },
  { id: "loc-shear", universeId: UNIVERSE_ID, name: "The Shear", description: "Deadly debris field between Meridian and Talos; eats the careless and the unlucky.", tags: ["hazard", "unexplained"], tier: "T3" },
  { id: "loc-nest", universeId: UNIVERSE_ID, name: "The Nest", description: "A raider anchorage hidden deep in the Shear — lashed-together hulls and stolen fuel, home to the Wreckers.", tags: ["lawless", "hidden", "shear", "raiders"], tier: "T3" },
  { id: "loc-wake", universeId: UNIVERSE_ID, name: "The Wake", description: "A drifting graveyard of colony-ship hulls at the Shear's edge, where Reclaimer salvage crews pick through the dead — and the buried truths of the sabotage they suspect.", tags: ["salvage", "reclaimers", "shear", "hazard"], tier: "T3" },
];

/** Standing world figures the narrator can reach for — faction anchors, not tied
 *  to any one player's story. New campaigns start knowing of them as canon. */
export const npcs: Npc[] = [
  { id: "npc-ilyana", universeId: UNIVERSE_ID, name: "Ilyana", oneBreath: "Hollow Crown debt handler on Meridian — pragmatic, watches debtors fail for a living; a gateway to Crown contractor work for those who prove reliable.", factionId: "f-crown", locationId: "loc-meridian" },
  { id: "npc-broker", universeId: UNIVERSE_ID, name: "Meridian broker", oneBreath: "A pragmatic Meridian trade-house broker who offers standing bulk contracts; increasingly wary as Sable Chain pressure creeps onto the lanes.", factionId: "f-meridian", locationId: "loc-meridian" },
  { id: "npc-ledger", universeId: UNIVERSE_ID, name: "The Ledger", oneBreath: "Rook's symbol-marked courier-fixer, no real name — moves cargo and secrets for anyone, trusted by all sides and beholden to none.", factionId: "f-ledger", locationId: "loc-rook" },
  { id: "npc-undertow", universeId: UNIVERSE_ID, name: "Undertow contact", oneBreath: "The Undertow's bounty desk at Rook — respects a clean operator and pays for results.", factionId: "f-undertow", locationId: "loc-rook" },
  { id: "npc-kesh", universeId: UNIVERSE_ID, name: "Kesh", oneBreath: "Wreck-field researcher aligned with the Reclaimers; holds proof a colony ship's 'accident' was decades-old sabotage, and is undecided what to do with it.", factionId: "f-reclaimers" },
  { id: "npc-chrome", universeId: UNIVERSE_ID, name: "Chrome", oneBreath: "Rook's back-room body artist — reshapes a face, a build, a whole silhouette for anyone with the credits and a reason to become someone new. Discreet, unbothered, expensive.", role: "body-modification artist", locationId: "loc-rook" },
  // NOTE: no faction-as-NPC entries. "Sable Chain" used to be seeded here as npc-sable,
  // which made a FACTION show up as a person in retrieval, prompts, and the People tab
  // (deleted from the live DB too). Factions live in the factions table only; to give
  // one a human face, add a real named/role NPC with factionId instead.
];
