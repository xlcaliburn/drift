import type { ContentPack } from "./types";

/**
 * THE DRIFT — content pack v0. This is the CURRENT live world, ported verbatim
 * from its previously scattered homes (scripts/seedData.ts, quests'
 * FACTION_ALIGNMENT, routes' NAMED_LANES, MapTab's MAP_LAYOUT, creation's
 * FACTION_HOME, CreateWizard's colors) so the seam exists with zero behavior
 * change. A world reboot = author a new file with this shape and swap the
 * export in index.ts.
 */
export const driftPack: ContentPack = {
  universe: {
    id: "uni-drift",
    name: "DRIFT",
    primer:
      "Space opera, brutal lethality, no plot armor. THE DRIFT is a hard, lawless stretch of settled space strung between three stations. Known locations: Meridian Ring (Crown territory — legitimate commerce, clean docks, the closest thing to order); Rook Station (~3 days out — the lawless black-market hub of fixers, couriers, and bounty desks); Talos Station (~4 days through the Shear — an isolated, hard-line frontier post in hostile country); The Shear (a deadly debris field between them that eats the careless); the Undertow outpost (a debt-collector base in contested space); the Nest (a Wreckers raider anchorage hidden in the Shear); Halcyon (a neutral independent freeport — a safe harbor for unaligned crews); Coldharbor (the Sable Chain's fortified staging station, pushing openly onto the Crown lanes); Cinderhaul (a grimy ore-refining colony where the Commons organizes the dock crews); the Wake (a colony-ship graveyard at the Shear's edge — Reclaimer salvage country). Factions: the Hollow Crown — the establishment power, a loan syndicate and the trade houses it backs, owner of the debt — and the rising Sable Chain feud openly over the Meridian–Rook lanes; the Undertow works the grim edges (debt-collectors, bounties, enforcement); and the unaligned currents run between them — Free Drift (independent crews and courier-fixers, no patron, contacts on every side), the Wreckers (pure raiders out of the Shear), and the Reclaimers (salvage-tech crews who suspect the Shear wrecks were sabotage). The balance of power is cracking: for years the Crown owned these lanes; now the Sable Chain is pushing into them in the open, and everyone is choosing a side or carving out their own. Tone: consequences stick, dice are honest, the world moves on its own.",
    styleRules:
      "Run at the END of every scene: update state; award ticks ONLY on DC13+ stakes rolls (max 1/skill/scene); apply crew wages on paying jobs and dock fees on docking; advance any clock whose trigger fired; give an arrival beat whenever the party reaches somewhere new. Show every roll as a full breakdown. Never spawn enemies below the party's weight class (default threat is T2). Introduce new threat tiers gradually. Enemy crits are max-damage-only; player crits reroll. People aren't cargo.",
    settingLine:
      "a gritty, lawless space-opera TTRPG set among three stations (Meridian Ring, Rook, Talos) and the dead lanes between them. Consequences stick; nobody is coming to save anyone.",
  },

  factions: [
    {
      id: "f-crown",
      name: "Hollow Crown",
      description:
        "The establishment power on the Meridian lanes — a loan syndicate turned patron AND the legitimate trade houses it backs. Owns the debt and the clean money; contractor tiers (courier/escort/intel). Its grip is slipping.",
      defaultRep: 0,
      alignment: "official",
      homeLocationId: "loc-meridian",
      color: "#e8a33d",
    },
    {
      id: "f-sable",
      name: "Sable Chain",
      description:
        "Rising rival syndicate pushing openly into Crown lanes — aggressive, hungry, the reason the balance is cracking.",
      defaultRep: 0,
      alignment: "underworld",
      homeLocationId: "loc-sable", // Coldharbor — the Chain plants recruits at its own staging docks
      color: "#d9584a",
    },
    {
      id: "f-undertow",
      name: "The Undertow",
      description: "Debt-collection outfit, morally grim — bounties, enforcement, leverage.",
      defaultRep: 0,
      alignment: "official", // grim, but sanctioned: debt, bounties, enforcement
      homeLocationId: "loc-undertow",
      color: "#8b93a6",
    },
    {
      id: "f-free",
      name: "Free Drift",
      description:
        "The independents — crews and courier-fixers who refuse every syndicate but keep each other alive: shared frequencies, safe berths, a no-questions code. Contacts on every side, allegiance to none.",
      defaultRep: 0,
      alignment: "neutral",
      homeLocationId: "loc-freeport", // Halcyon — the independents' neutral haven
      color: "#b98fd0",
    },
    {
      id: "f-wreckers",
      name: "The Wreckers",
      description:
        "Lawless raiders nesting in the Shear; prey on the bulk lanes. No patron, no law — plunder and fear.",
      defaultRep: 0,
      alignment: "underworld",
      homeLocationId: "loc-nest",
      color: "#d9584a",
    },
    {
      id: "f-reclaimers",
      name: "The Reclaimers",
      description:
        "Salvage-tech collective pulling hardware and buried truths from derelicts; suspect the Shear wrecks aren't all accidents.",
      defaultRep: 0,
      alignment: "neutral",
      homeLocationId: "loc-rook",
      color: "#7fa6c9",
    },
  ],

  // `tier` is the LOCATIONS.md danger band (T1 secure / T2 rough / T3 deadly).
  // Rook is a STARTING station so it's pinned T1 even though its blackmarket/
  // lawless tags would derive T2. Lanes are the hand-tuned named routes (MapTab
  // draws them); the tier/tag formula in shared/routes covers every other pair.
  locations: [
    // ── Safe hubs (T1) — where new players start and lie low ──
    {
      id: "loc-meridian",
      name: "Meridian Ring",
      description: "Crown territory — legitimate commerce, clean docks, the closest thing to order in the lanes.",
      tags: ["crown", "commerce", "order"],
      tier: "T1",
      mapPos: { x: 66, y: 52, color: "#e8a33d" },
      lanes: [
        { to: "loc-rook", tendays: 3, risk: "low", note: "established trade lane between the two safe hubs" },
        { to: "loc-undertow", tendays: 2, risk: "medium" },
        { to: "loc-shear", tendays: 2, risk: "high", note: "the hazard field itself" },
      ],
    },
    {
      id: "loc-rook",
      name: "Rook Station",
      description:
        "Lawless black-market hub ~3 days out — fixers, courier syndicates, bounty desks. Rough edges, but a newcomer's landing spot.",
      tags: ["blackmarket", "lawless"],
      tier: "T1",
      mapPos: { x: 198, y: 74, color: "#c99a5b" },
      lanes: [{ to: "loc-undertow", tendays: 2, risk: "medium" }],
    },
    {
      id: "loc-freeport",
      name: "Halcyon",
      description:
        "A neutral independent freeport — no patron owns it; crews of every stripe dock, trade, and lie low under a no-questions code. A safe harbor for the unaligned.",
      tags: ["free", "neutral", "haven", "commerce"],
      tier: "T1",
      mapPos: { x: 150, y: 22, color: "#5fa06a" },
      lanes: [],
    },
    // ── Rough territory (T2) — contested, criminal, working-class ──
    {
      id: "loc-undertow",
      name: "Undertow outpost",
      description: "Debt-collector base in contested space.",
      tags: ["contested"],
      tier: "T2",
      mapPos: { x: 138, y: 142, color: "#8b93a6" },
      lanes: [{ to: "loc-shear", tendays: 2, risk: "high" }],
    },
    {
      id: "loc-sable",
      name: "Coldharbor",
      description:
        "The Sable Chain's fortified staging station on the Meridian–Rook lane — sleek, aggressive, the syndicate's open push into Crown territory.",
      tags: ["sable", "syndicate", "contested"],
      tier: "T2",
      mapPos: { x: 132, y: 58, color: "#a34a6b" },
      lanes: [],
    },
    {
      id: "loc-cinder",
      name: "Cinderhaul",
      description:
        "A grimy ore-refining colony of scaffolds and slag — cheap fuel, hard people, and simmering dock-crew unrest against the syndicates.",
      tags: ["industrial", "contested", "frontier"],
      tier: "T2",
      mapPos: { x: 40, y: 130, color: "#9a6b3d" },
      lanes: [],
    },
    // ── Deadly frontier (T3) — punch above your weight for the big scores ──
    {
      id: "loc-talos",
      name: "Talos Station",
      description: "Isolated frontier post ~4 days through the Shear — hard-line security, hostile to outsiders.",
      tags: ["frontier", "hostile"],
      tier: "T3",
      mapPos: { x: 84, y: 306, color: "#6f7b93" },
      lanes: [],
    },
    {
      id: "loc-shear",
      name: "The Shear",
      description: "Deadly debris field between Meridian and Talos; eats the careless and the unlucky.",
      tags: ["hazard", "unexplained"],
      tier: "T3",
      mapPos: { x: 92, y: 224, color: "#d9584a" },
      lanes: [
        { to: "loc-talos", tendays: 2, risk: "high", note: "meridian→shear→talos ≈ 4, matching the primer" },
        { to: "loc-nest", tendays: 1, risk: "high", note: "a short hop, but into a raider den" },
      ],
    },
    {
      id: "loc-nest",
      name: "The Nest",
      description:
        "A raider anchorage hidden deep in the Shear — lashed-together hulls and stolen fuel, home to the Wreckers.",
      tags: ["lawless", "hidden", "shear", "raiders"],
      tier: "T3",
      mapPos: { x: 200, y: 248, color: "#d9584a" },
      lanes: [],
    },
    {
      id: "loc-wake",
      name: "The Wake",
      description:
        "A drifting graveyard of colony-ship hulls at the Shear's edge, where Reclaimer salvage crews pick through the dead — and the buried truths of the sabotage they suspect.",
      tags: ["salvage", "reclaimers", "shear", "hazard"],
      tier: "T3",
      mapPos: { x: 154, y: 202, color: "#b06a5a" },
      lanes: [],
    },
  ],

  /** Standing world figures the narrator can reach for — faction anchors, not tied
   *  to any one player's story. New campaigns start knowing of them as canon.
   *  NOTE: never seed a faction as an NPC (validatePack enforces it) — the live
   *  "Sable Chain the person" bug. Give a faction a human face instead. */
  cast: [
    { id: "npc-ilyana", name: "Ilyana", oneBreath: "Hollow Crown debt handler on Meridian — pragmatic, watches debtors fail for a living; a gateway to Crown contractor work for those who prove reliable.", factionId: "f-crown", locationId: "loc-meridian" },
    { id: "npc-broker", name: "Meridian broker", oneBreath: "A pragmatic Crown-backed trade-house broker on Meridian who offers standing bulk contracts; increasingly wary as Sable Chain pressure creeps onto the lanes.", factionId: "f-crown", locationId: "loc-meridian" },
    { id: "npc-ledger", name: "The Ledger", oneBreath: "Rook's symbol-marked courier-fixer, no real name — a Free Drift operator who moves cargo and secrets for anyone, trusted by all sides and beholden to none.", factionId: "f-free", locationId: "loc-rook" },
    { id: "npc-undertow", name: "Undertow contact", oneBreath: "The Undertow's bounty desk at Rook — respects a clean operator and pays for results.", factionId: "f-undertow", locationId: "loc-rook" },
    { id: "npc-kesh", name: "Kesh", oneBreath: "Wreck-field researcher aligned with the Reclaimers; holds proof a colony ship's 'accident' was decades-old sabotage, and is undecided what to do with it.", factionId: "f-reclaimers" },
    { id: "npc-chrome", name: "Chrome", oneBreath: "Rook's back-room body artist — reshapes a face, a build, a whole silhouette for anyone with the credits and a reason to become someone new. Discreet, unbothered, expensive.", role: "body-modification artist", locationId: "loc-rook" },
    { id: "npc-quist", name: "Harbormaster Quist", oneBreath: "Halcyon's harbormaster — keeps the freeport neutral by force of reputation; knows every hull, every debt, and every crew that passes through, and trades berths for favors.", factionId: "f-free", locationId: "loc-freeport", role: "harbormaster" },
    { id: "npc-brekk", name: "Quartermaster Brekk", oneBreath: "Coldharbor's quartermaster — runs the Sable Chain's staging docks with cold efficiency; always short on reliable hands for runs onto the Crown lanes. Pays fast, asks twice as much next time.", factionId: "f-sable", locationId: "loc-sable", role: "Sable quartermaster" },
    { id: "npc-osk", name: "Foreman Osk", oneBreath: "Cinderhaul's dock foreman — twenty years of slag and short pay; keeps the ore moving and quietly shields his crews from the syndicate collectors when he can.", locationId: "loc-cinder", role: "dock foreman" },
    { id: "npc-ismay", name: "Warden Ismay", oneBreath: "The Wake's warden — a Reclaimer who logs every hull in the graveyard and decides who salvages where; superstitious about the wrecks, and rightly so.", factionId: "f-reclaimers", locationId: "loc-wake", role: "graveyard warden" },
  ],

  jobFlavor: {
    cargo: ["a sealed medcrate", "contraband stims", "a data core", "reactor parts", "salvaged plating", "a locked strongbox", "a refrigerated pod"],
    targets: ["a Wrecker enforcer", "a jumped bail-runner", "a Chain informant", "a nervous fixer", "a rogue quartermaster", "a debt-skipping broker"],
    complications: ["a rival crew wants it too", "it's hotter than advertised", "the buyer's spooked", "someone already tipped off the wrong people", "the meet's on contested ground"],
  },

  services: {
    bodyMod: "loc-rook", // Chrome's parlor — the respec/appearance service gate
  },
};
