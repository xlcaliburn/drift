/**
 * Vess Karo campaign — the original hand-transcribed save (vess-karo-save_1.md),
 * preserved as a TEST FIXTURE only. It is no longer seeded into the app: the
 * shared world (universe/factions/locations/npcs) lives in scripts/seedData.ts,
 * and real play starts from character creation. These fully-formed characters,
 * clocks, and a complete CampaignState give the engine tests deterministic,
 * numerically-deliberate inputs. Nothing here is imported by runtime code.
 */
import type {
  Universe,
  Campaign,
  Character,
  Ship,
  Faction,
  FactionRep,
  Location,
  Npc,
  Clock,
  Thread,
  Contract,
  CampaignState,
} from "@/shared/schemas";

export const UNIVERSE_ID = "uni-drift";
export const CAMPAIGN_ID = "camp-vess";

export const universe: Universe = {
  id: UNIVERSE_ID,
  name: "DRIFT",
  ownerId: undefined,
  primer:
    "Space opera, brutal lethality, no plot armor. Known locations: Meridian Ring (Crown territory, legitimate commerce); Rook Station (lawless black-market hub ~3 days away); Talos Station (~4 days through the Shear — hostile territory); The Shear (deadly debris field between Meridian and Talos); Undertow outpost (contested space, debt-collector base); the Nest (a Wreckers raider anchorage hidden in the Shear). Tone: consequences stick, dice are honest, the world moves on its own.",
  styleRules:
    "Run at the END of every scene: update state; award ticks ONLY on DC13+ stakes rolls (max 1/skill/scene); apply crew wages on paying jobs and dock fees on docking; advance any clock whose trigger fired; give an arrival beat whenever the party reaches somewhere new. Show every roll as a full breakdown. Never spawn enemies below the party's weight class (default threat is T2). Enemy crits are max-damage-only; player crits reroll.",
};

export const campaign: Campaign = {
  id: CAMPAIGN_ID,
  universeId: UNIVERSE_ID,
  name: "Vess Karo",
  status: "active",
  currentLocationId: "loc-meridian",
  tendaysElapsed: 0,
  narratorModel: undefined,
  situation:
    "Escort complete — the convoy is delivered safe, but the Sable Chain is now openly tracking Vess. The broker's cargo is still aboard the Lark, waiting on a run to Rook Station.",
};

export const vess: Character = {
  id: "vess",
  campaignId: CAMPAIGN_ID,
  kind: "pc",
  name: "Vess Karo",
  attributes: {
    might: 0,
    reflex: 4,
    vitality: 0,
    intellect: 0,
    perception: -2,
    presence: -1,
  },
  hp: 7,
  maxHp: 7,
  ac: 18,
  slots: 8,
  maxSlots: 8,
  stims: 5,
  credits: 2008,
  fragile: false,
  skills: [
    { name: "piloting", level: 4, ticks: 6 },
    { name: "zeroG", level: 2, ticks: 0 },
    { name: "streetwise", level: 3, ticks: 0 },
    { name: "negotiation", level: 2, ticks: 4 },
    { name: "mechanics", level: 1, ticks: 5 },
    { name: "gunnery", level: 2, ticks: 5 },
    { name: "electronics", level: 1, ticks: 3 },
    { name: "navigation", level: 1, ticks: 2 },
    { name: "smallArms", level: 1, ticks: 0 },
    { name: "melee", level: 0, ticks: 2 },
    { name: "deception", level: 0, ticks: 2 },
    { name: "intimidation", level: 0, ticks: 2 },
    { name: "stealth", level: 0, ticks: 1 },
  ],
  actionModifiers: {
    smallArms: 5,
    gunnery: 5,
    piloting: 8,
    melee: 0,
    stealth: 4,
    perception: -2,
    shipSensors: 1,
    streetwise: 1,
    negotiation: 1,
    deception: -1,
    intimidation: -1,
    mechanics: 1,
    electronics: 1,
    navigation: 3,
    initiative: 4,
    deathSave: 0,
  },
  backstory:
    "Born on Meridian Ring dock levels; mother (cargo-loader) died in a pressure accident when Vess was eleven. Raised half-feral by the dock community. Fastest hands on the ring; genuinely misses faces/tails/details outside a cockpit (Perception 6). At 23 lost a ship-share stake to a partner's smuggling charge and took a Hollow Crown loan that compounded to ¢2,400; flew it off. Debt now paid — first thing she's ever fully owned is her own freedom; wants the Lark's title next.",
  drives:
    "An exciting life over a safe one. Loyalty to the few who earn it. A line she won't cross: people aren't cargo.",
  gear: [
    { name: "Dart pistol", damage: "1d6", rounds: 29 },
    { name: "Sidearm", damage: "1d8", rounds: 31 },
    { name: "Combat rifle", damage: "2d6", rounds: 40 },
    { name: "Multitool" },
    { name: "Rations ×3 + military case" },
    { name: "Cracked datapad" },
    { name: "Reinforced plating", detail: "+4 AC, hot goods", acBonus: 4 },
    { name: "Enforcer's personal data chip", detail: "unexamined" },
  ],
  injuries: [],
};

export const denna: Character = {
  id: "denna",
  campaignId: CAMPAIGN_ID,
  kind: "party",
  name: "Denna",
  attributes: {
    might: 0,
    reflex: 0,
    vitality: 0,
    intellect: 2,
    perception: 2,
    presence: -1,
  },
  hp: 7,
  maxHp: 7,
  ac: 13,
  stims: 5,
  loyalty: 5,
  fragile: false,
  skills: [
    { name: "piloting", level: 2, ticks: 0 },
    { name: "navigation", level: 1, ticks: 0 },
    { name: "zeroG", level: 1, ticks: 0 },
    { name: "survival", level: 1, ticks: 0 },
  ],
  actionModifiers: {},
  backstory:
    "Sole known survivor of a salvage crew lost in the Shear; sealed the airlock on dying crewmates to save the ship, carried the guilt until Vess backed the call — then learned crewmate Torres survived too. Dry humor, socially sharper than Vess, completely loyal.",
  gear: [
    { name: "Sidearm", damage: "1d8" },
    { name: "Trauma kit" },
    { name: "Vess's old vest+plate", detail: "+3 AC", acBonus: 3 },
  ],
  injuries: [],
};

export const josen: Character = {
  id: "josen",
  campaignId: CAMPAIGN_ID,
  kind: "party",
  name: "Josen",
  attributes: {
    might: 0,
    reflex: -2,
    vitality: -4,
    intellect: -1,
    perception: -2,
    presence: 0,
  },
  hp: 8,
  maxHp: 8,
  ac: 10,
  stims: 0,
  loyalty: 3,
  fragile: true,
  skills: [
    { name: "smallArms", level: 2, ticks: 0 },
    { name: "intimidation", level: 2, ticks: 0 },
    { name: "survival", level: 1, ticks: 0 },
  ],
  actionModifiers: { deathSave: -4 },
  backstory:
    "Big ex-military contractor from Rook's Drift Anchor bar. Talks and shoots like a hardened professional (two one-shot ship kills) but the body under the persona is failing — old injuries or worse. Paid his back pay unprompted; trust building.",
  gear: [
    { name: "Sidearm", damage: "1d8" },
    { name: "Second gun mount" },
  ],
  injuries: [],
};

export const lark: Ship = {
  id: "lark",
  campaignId: CAMPAIGN_ID,
  name: "The Lark",
  shipClass: "hauler",
  hp: 4,
  maxHp: 23,
  ac: 12,
  evasiveAcBonus: 2,
  damageReduction: 2,
  weapons: [
    { name: "Turrets ×2", type: "kinetic", damage: "2d8", count: 2 },
    { name: "Missile pod", type: "missile", damage: "3d8", ammo: 3 },
  ],
  hasShield: true,
  shieldReady: true,
  hasPointDefense: false,
  burstDriveReady: true,
  dcModifier: -2,
  buyoutRemaining: 4903,
  notes:
    "Wren-class, Crown loaner. Sensor suite (+3 detection), nav computer (+2 Navigation), racing thrusters (ship DCs -2). One hardpoint max reached — no more weapons fit. No energy weapons, no ion, no PD.",
};

export const factions: Faction[] = [
  { id: "f-crown", universeId: UNIVERSE_ID, name: "Hollow Crown", description: "Loan syndicate turned patron; contractor tiers (courier/escort/intel).", defaultRep: 0 },
  { id: "f-undertow", universeId: UNIVERSE_ID, name: "The Undertow", description: "Debt-collection outfit, morally grim.", defaultRep: 0 },
  { id: "f-ledger", universeId: UNIVERSE_ID, name: "Ledger network (Rook)", description: "Symbol-marked courier fixers on Rook.", defaultRep: 0 },
  { id: "f-meridian", universeId: UNIVERSE_ID, name: "Meridian commerce", description: "Broker, Harrow & Vane, parts depot — legitimate bulk trade.", defaultRep: 0 },
  { id: "f-rook", universeId: UNIVERSE_ID, name: "Rook Station street", description: "The lawless hub's general reputation economy.", defaultRep: 0 },
  { id: "f-talos", universeId: UNIVERSE_ID, name: "Talos security", description: "Station security; frontier law.", defaultRep: 0 },
  { id: "f-sable", universeId: UNIVERSE_ID, name: "Sable Chain", description: "Rival syndicate expanding into Crown lanes.", defaultRep: 0 },
  { id: "f-wreckers", universeId: UNIVERSE_ID, name: "The Wreckers", description: "Lawless raiders nesting in the Shear.", defaultRep: 0 },
  { id: "f-free", universeId: UNIVERSE_ID, name: "Free Drift", description: "Loose brotherhood of independent crews.", defaultRep: 0 },
  { id: "f-reclaimers", universeId: UNIVERSE_ID, name: "The Reclaimers", description: "Salvage-tech collective pulling hardware and buried truths from derelicts.", defaultRep: 0 },
  { id: "f-commons", universeId: UNIVERSE_ID, name: "The Commons", description: "Hunted movement against debt and syndicate rule.", defaultRep: 0 },
];

export const factionRep: FactionRep[] = [
  { campaignId: CAMPAIGN_ID, factionId: "f-crown", rep: 3, standing: "Debt paid in full; Ilyana vouches; contractor tiers open" },
  { campaignId: CAMPAIGN_ID, factionId: "f-undertow", rep: 2, standing: "Reliable bounty hunter; route-log payout pending" },
  { campaignId: CAMPAIGN_ID, factionId: "f-ledger", rep: 2, standing: "Trusted courier, no-drama deliveries" },
  { campaignId: CAMPAIGN_ID, factionId: "f-meridian", rep: 2, standing: "Proven at bulk volume" },
  { campaignId: CAMPAIGN_ID, factionId: "f-rook", rep: 0, standing: "Respected AND feared (alley killings) — cuts both ways" },
  { campaignId: CAMPAIGN_ID, factionId: "f-talos", rep: -2, standing: "Skipped statement; hidden body (undiscovered)" },
  { campaignId: CAMPAIGN_ID, factionId: "f-sable", rep: -2, standing: "Their scout destroyed; they're tracking her bulk shipments" },
  { campaignId: CAMPAIGN_ID, factionId: "f-wreckers", rep: -2, standing: "Wiped a raider crew for a bounty — the Wreckers remember" },
  { campaignId: CAMPAIGN_ID, factionId: "f-free", rep: 1, standing: "Owns her own ship, answers to no patron" },
  { campaignId: CAMPAIGN_ID, factionId: "f-reclaimers", rep: 1, standing: "Kesh owes her; friendly to the salvage crews" },
  { campaignId: CAMPAIGN_ID, factionId: "f-commons", rep: 0, standing: "Unknown to them so far" },
];

export const locations: Location[] = [
  { id: "loc-meridian", universeId: UNIVERSE_ID, name: "Meridian Ring", description: "Crown territory, legitimate commerce.", tags: ["crown", "home", "commerce"] },
  { id: "loc-rook", universeId: UNIVERSE_ID, name: "Rook Station", description: "Lawless black-market hub ~3 days away.", tags: ["blackmarket", "lawless"] },
  { id: "loc-talos", universeId: UNIVERSE_ID, name: "Talos Station", description: "Hostile territory ~4 days through the Shear.", tags: ["hostile"] },
  { id: "loc-shear", universeId: UNIVERSE_ID, name: "The Shear", description: "Deadly debris field between Meridian and Talos.", tags: ["hazard", "unexplained"] },
  { id: "loc-undertow", universeId: UNIVERSE_ID, name: "Undertow outpost", description: "Debt-collector base in contested space.", tags: ["contested"] },
  { id: "loc-nest", universeId: UNIVERSE_ID, name: "The Nest", description: "A raider anchorage hidden deep in the Shear — home to the Wreckers.", tags: ["lawless", "hidden", "shear", "raiders"] },
];

export const npcs: Npc[] = [
  { id: "npc-ilyana", universeId: UNIVERSE_ID, name: "Ilyana", oneBreath: "Hollow Crown debt handler on Meridian; genuine ally, gateway to Crown contractor work.", status: "currently unavailable", factionId: "f-crown", locationId: "loc-meridian" },
  { id: "npc-rell", universeId: UNIVERSE_ID, name: "Rell", oneBreath: "Independent mechanic on Rook; Vess saved her from collectors. Recruit candidate.", status: "recruit candidate", locationId: "loc-rook" },
  { id: "npc-kesh", universeId: UNIVERSE_ID, name: "Kesh", oneBreath: "Wreck-field researcher aligned with the Reclaimers; holds proof a colony ship's 'accident' was sabotage.", factionId: "f-reclaimers" },
  { id: "npc-ledger", universeId: UNIVERSE_ID, name: "The Ledger", oneBreath: "Rook's symbol-marked courier fixer, no real name.", factionId: "f-ledger", locationId: "loc-rook" },
  { id: "npc-broker", universeId: UNIVERSE_ID, name: "Meridian broker", oneBreath: "Gave Vess her first standing contract; pragmatic.", factionId: "f-meridian", locationId: "loc-meridian" },
  { id: "npc-parts", universeId: UNIVERSE_ID, name: "Rook parts trader", oneBreath: "Second standing contract; legitimate components.", locationId: "loc-rook" },
  { id: "npc-undertow", universeId: UNIVERSE_ID, name: "Undertow contact", oneBreath: "Bounty desk at Rook for the Undertow; respects Vess's clean record.", factionId: "f-undertow", locationId: "loc-rook" },
  { id: "npc-torres", universeId: UNIVERSE_ID, name: "Torres", oneBreath: "Denna's old crewmate, alive; unmet.", status: "unmet" },
  { id: "npc-sable", universeId: UNIVERSE_ID, name: "Sable Chain", oneBreath: "Rival syndicate, faceless so far.", factionId: "f-sable" },
];

export const clocks: Clock[] = [
  {
    id: "clk-sable",
    campaignId: CAMPAIGN_ID,
    name: "Sable Chain escalation",
    current: 3,
    max: 6,
    triggerText: "Each bulk run completed, each Chain asset destroyed, each tenday of inaction against them",
    milestones: [
      { at: 2, effect: "shadow all runs", done: true },
      { at: 3, effect: "ambush survived — gunship + fighter destroyed, Lark took real damage", done: true },
      { at: 4, effect: "hit a contact (Ledger or broker)", done: false },
      { at: 5, effect: "bounty on Vess", done: false },
      { at: 6, effect: "full interdiction of her routes", done: false },
    ],
    status: "active",
  },
  {
    id: "clk-talos",
    campaignId: CAMPAIGN_ID,
    name: "Talos reckoning",
    current: 0,
    max: 4,
    triggerText: "Any visit to Talos; any Crown/Talos news scene; +1 per 3 tendays",
    milestones: [
      { at: 2, effect: "body found, warrant issued", done: false },
      { at: 3, effect: "bounty hunters sent", done: false },
      { at: 4, effect: "warrant reaches Meridian/Rook authorities", done: false },
    ],
    status: "active",
  },
  {
    id: "clk-josen",
    campaignId: CAMPAIGN_ID,
    name: "Josen's patience",
    current: 0,
    max: 4,
    triggerText: "Each paying job where he isn't paid; each time endangered recklessly.",
    milestones: [
      { at: 2, effect: "loyalty -1", done: false },
      { at: 3, effect: "demands back pay ×2", done: false },
      { at: 4, effect: "walks or sells crew info", done: false },
    ],
    status: "active",
  },
];

export const threads: Thread[] = [
  { id: "th-escort", campaignId: CAMPAIGN_ID, title: "Escort job complete", body: "Convoy delivered safe, no combat despite Sable Chain surveillance. ¢417 total paid.", status: "resolved", entityRefs: ["f-sable"] },
  { id: "th-broker-run", campaignId: CAMPAIGN_ID, title: "Broker's standard cargo run", body: "¢230, cargo still aboard, paid on delivery — need to reach Rook Station.", status: "active", entityRefs: ["npc-broker", "npc-ledger", "loc-rook"] },
  { id: "th-undertow-log", campaignId: CAMPAIGN_ID, title: "Undertow route-log payout", body: "Pending verification at Rook.", status: "active", entityRefs: ["f-undertow", "npc-undertow", "loc-rook"] },
  { id: "th-recruit", campaignId: CAMPAIGN_ID, title: "Recruit goal: high Perception", body: "Rell (Rook mechanic) warming — wants to see consistency before joining.", status: "active", entityRefs: ["npc-rell"] },
];

export const contracts: Contract[] = [
  { id: "ct-broker", campaignId: CAMPAIGN_ID, name: "Meridian broker", payoutRange: "¢200-300, bulk-capable", status: "standing" },
  { id: "ct-parts", campaignId: CAMPAIGN_ID, name: "Rook parts trader", payoutRange: "¢200-250, bulk-capable", status: "standing" },
  { id: "ct-escort", campaignId: CAMPAIGN_ID, name: "Convoy escorts", payoutRange: "¢300-450", status: "standing" },
];

/** Assemble the live CampaignState used by the engine tests. */
export function buildCampaignState(): CampaignState {
  return {
    universe,
    campaign,
    characters: [vess, denna, josen],
    ship: lark,
    factions,
    factionRep,
    locations,
    npcs,
    clocks,
    threads,
    contracts,
  };
}
