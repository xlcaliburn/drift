/**
 * Per-faction OPENING SCENARIOS + STARTING POINTS, keyed by the faction a new
 * character starts in. Two jobs:
 *
 *  1. STATIC FALLBACK (`hook`, `threadTitle`, `threadBody`, `firstMoves`) — a
 *     ready-made opening used verbatim when there is no narrator API key or the
 *     creation-time generation fails. It NEVER costs a call and is what the free
 *     opening recap (shared/recap.ts) reads on load.
 *
 *  2. GENERATION SEED (`seed`) — hardcoded raw material fed into the one creation
 *     -time LLM pass (llm/creationFinalize.ts) so it can write a customized
 *     opening `situation` (context) and starting quest thread for THIS character,
 *     grounded in real canon instead of freestyling. The generated result is
 *     stored on the campaign (situation) and the starting thread — both already
 *     persist — so play still opens for free on every later load.
 *
 * All anchors reference canon that already exists in scripts/seedData.ts (Ilyana,
 * Kesh, the Meridian broker, the home location). `firstMoves` stay hardcoded per
 * faction (the clickable buttons) — each is doable on foot with no ship, since
 * mobility is earned in play.
 */

export interface FactionOpening {
  factionId: string;
  /** The concrete opening situation, one or two sentences — the static-fallback
   *  context appended to the campaign situation headline. */
  hook: string;
  /** The static-fallback starting thread — a concrete goal, not "earn your place". */
  threadTitle: string;
  threadBody: string;
  /** 2-4 specific, clickable opening actions — distinct approaches, not one path. */
  firstMoves: string[];
  /** The starting mobility arrangement. A faction LOANER hull the recruit flies but
   *  does NOT own yet — earned by proving themselves (see the ship-ownership thread
   *  in newCampaign). Omitted for factions that give no ship (Commons/Wreckers/Free):
   *  they beg/borrow passage until they earn a hull of their own. Stats are seeded
   *  uniformly (a weak starter hull) in newCampaign; only the flavor lives here. */
  loaner?: LoanerDef;
  /** Raw material for the creation-time story-generation call (see module doc). */
  seed: OpeningSeed;
}

export interface LoanerDef {
  /** In-world ship name (e.g. "The Wren"). */
  name: string;
  shipClass: "scout" | "fighter" | "hauler" | "gunship" | "corvette";
  /** Flavor name for its single weak hardpoint. */
  weaponName: string;
  /** Ship notes — includes the "loaner, not yet yours" framing the narrator reads. */
  notes: string;
}

export interface OpeningSeed {
  /** Where the recruit physically starts (matches FACTION_HOME in newCampaign).
   *  The generated opening MUST be set here so it agrees with the location the
   *  free recap shows. */
  startLocation: string;
  /** What the faction wants from a brand-new recruit. */
  recruitGoal: string;
  /** Canon NPCs / places the generated opening should build on (grounding). */
  anchors: string;
  /** The live local conflict the first quest can hang on. */
  tension: string;
  /** Candidate first jobs the generated questline can draw from and personalize. */
  leads: string[];
}

/**
 * The shape the creation-time LLM pass returns for a personalized opening. Kept
 * here (content, non-server) so both the generator (llm/creationFinalize.ts) and
 * the campaign builder (lib/newCampaign.ts) can share the type without importing
 * a server-only module.
 */
export interface GeneratedOpening {
  /** Personalized present-tense context — the scene the character stands in now.
   *  No faction prefix / season suffix; newCampaign wraps those around it. */
  situation: string;
  /** Personalized starting-quest title (a concrete goal). */
  questTitle: string;
  /** 2-3 sentences framing the first job and the choice it poses. */
  questBody: string;
}

export const factionOpenings: FactionOpening[] = [
  {
    factionId: "f-crown",
    hook: "Ilyana, a Crown debt handler on Meridian, has a stack of jobs no one senior wants — the lanes are turning dangerous and the Crown is short-handed. This is your chance to prove you're worth a real contract.",
    threadTitle: "Prove yourself to the Hollow Crown",
    threadBody:
      "Ilyana runs Crown debt and contracts out of Meridian Ring. Take a job, close it clean, and she starts trusting you with the work that matters — and decide, before long, whether the Crown's cause is yours or you're building toward your own.",
    firstMoves: [
      "Ask Ilyana for a starter contract",
      "Collect on a debtor who's gone quiet",
      "Ask around the docks what the Sable Chain is doing",
    ],
    loaner: {
      name: "The Wren",
      shipClass: "scout",
      weaponName: "Nose kinetic",
      notes:
        "Hollow Crown loaner — a Wren-class courier. You fly it on the Crown's leave, not your own; the title stays theirs until you've earned it. Cross them and it's gone.",
    },
    seed: {
      startLocation: "Meridian Ring — Crown territory, clean docks, the closest thing to order in the lanes",
      recruitGoal:
        "Prove reliable enough to be trusted with real Crown contracts as the syndicate's grip on the lanes slips.",
      anchors:
        "Ilyana (Crown debt handler on Meridian Ring); the Crown's contractor tiers — courier, escort, intel work.",
      tension:
        "The Crown is short-handed and nervous — Sable Chain scouts are probing the Meridian–Rook lanes and debtors are quietly going dark.",
      leads: [
        "A debtor a few levels down has stopped paying and stopped answering",
        "A courier run no senior contractor will touch since the lane got dangerous",
        "Word that a Crown client is quietly talking to the Sable Chain",
      ],
    },
  },
  {
    factionId: "f-sable",
    hook: "The Sable Chain is pushing openly into Crown lanes and needs bodies who'll take risks. Your handler on Rook wants to see nerve before they'll trust you with anything real.",
    threadTitle: "Make your name in the Sable Chain",
    threadBody:
      "The Chain is the rising knife — hungry, aggressive, and watched by everyone. Pull off something that hurts the Crown or fattens the Chain and you rise fast; flinch, and you're expendable. Decide how far you'll ride with them before it's your own name on the door.",
    firstMoves: [
      "Find your Sable handler on Rook for orders",
      "Poach a shipment off a Crown lane",
      "Shake down a broker paying Crown protection",
    ],
    loaner: {
      name: "The Cutlass",
      shipClass: "fighter",
      weaponName: "Fixed autocannon",
      notes:
        "Sable Chain loaner — keys handed over, not signed over. Prove your worth and it becomes yours; flinch or cross the Chain and they take it back with interest.",
    },
    seed: {
      startLocation: "Rook Station — the lawless black-market hub of fixers, couriers, and bounty desks",
      recruitGoal:
        "Show enough nerve and results to earn a real place in the rising Chain instead of being spent as expendable muscle.",
      anchors:
        "Your Sable Chain handler on Rook Station; the contested Meridian–Rook bulk lanes the Chain is muscling into.",
      tension:
        "The Chain is pushing openly into Crown territory and everyone is suddenly watching — momentum is everything and hesitation gets you cut loose.",
      leads: [
        "A Crown shipment crossing a lane the Chain wants to own",
        "A Meridian broker still paying Crown protection who could be flipped",
        "A rival inside the Chain who resents an unproven newcomer",
      ],
    },
  },
  {
    factionId: "f-undertow",
    hook: "The Undertow's bounty desk has a board full of debts owed in credits or blood. Bring one in clean and they'll start feeding you the work — and the leverage — that matters.",
    threadTitle: "Earn the Undertow's respect",
    threadBody:
      "The Undertow pays for results and respects a clean operator. Close a bounty or a collection without making a mess and the real jobs — and the information behind them — start flowing your way. Where you draw your lines is your business.",
    firstMoves: [
      "Take a bounty off the desk",
      "Track a debtor who skipped the outpost",
      "Lean on a mark for what they owe",
    ],
    loaner: {
      name: "The Collector",
      shipClass: "scout",
      weaponName: "Nose kinetic",
      notes:
        "Undertow repo hull — pulled off someone who couldn't pay. It's yours to run once the desk trusts you to keep it, and its work, clean.",
    },
    seed: {
      startLocation: "the Undertow outpost — a debt-collector base out in contested space",
      recruitGoal:
        "Close a bounty or collection cleanly enough that the Undertow starts trusting you with leverage and information.",
      anchors:
        "The Undertow bounty desk and outpost; the contact at Rook who respects a clean operator and pays for results.",
      tension:
        "The chaos in the lanes has the board overflowing — debts owed in credits or blood — and the Undertow smells opportunity in it.",
      leads: [
        "A debtor who skipped the outpost owing a dangerous amount",
        "A bounty on someone tangled up in the Crown–Sable feud",
        "A collection where the mark has protection that has to be peeled away first",
      ],
    },
  },
  {
    factionId: "f-meridian",
    hook: "A Meridian broker has cargo that needs moving and lanes getting too dangerous to trust to anyone soft. Land a first contract and build a reputation from there.",
    threadTitle: "Build your standing in Meridian commerce",
    threadBody:
      "Meridian runs on clean cargo and cleaner margins — but the lanes are turning violent and honest money needs someone who'll get its hands dirty to protect it. Move goods, keep them safe, and turn a first contract into a name people trust.",
    firstMoves: [
      "Take a cargo contract from the broker",
      "Haggle a better cut on the run",
      "Ask what's making the brokers nervous",
    ],
    loaner: {
      name: "The Tally",
      shipClass: "scout",
      weaponName: "Defensive turret",
      notes:
        "Meridian consignment hull — a light courier skiff on the trade house's books. Fly their cargo and keep it safe, and the title comes off their ledger and onto yours.",
    },
    seed: {
      startLocation: "Meridian Ring — the legitimate trade houses, depots, and clean docks of the Crown-held ring",
      recruitGoal:
        "Land and protect a first cargo contract, turning clean standing into a reputation people trust.",
      anchors:
        "The Meridian trade-house broker (offers standing bulk contracts); the depots and bulk lanes of the Meridian Ring.",
      tension:
        "Honest cargo is getting hit as the lanes turn violent, and the brokers need someone willing to get their hands dirty to protect it.",
      leads: [
        "A cargo run the broker can't trust to anyone soft",
        "A shipment already lost that someone needs quietly recovered",
        "A depot being leaned on for protection money",
      ],
    },
  },
  {
    factionId: "f-wreckers",
    hook: "In the Nest you eat what you take, and the crew won't feed a mouth that hasn't earned it. Go find something worth plundering before they decide you're dead weight.",
    threadTitle: "Take your share in the Nest",
    threadBody:
      "No patron, no ledger, no safety net — what you have, you took, and you keep it only as long as you can hold it. Land a haul or prove your teeth on a raid and the crew stops eyeing you sideways. Every other faction wants you dead; there's no other way to stand here.",
    firstMoves: [
      "Scout the lanes for a soft target",
      "Join a raid crew heading out",
      "Win over a Wrecker who'll vouch for you",
    ],
    seed: {
      startLocation: "the Nest — a lashed-together raider anchorage hidden deep in the Shear",
      recruitGoal:
        "Land a haul or prove your teeth on a raid so the Nest stops treating you as dead weight.",
      anchors:
        "The Nest (raider anchorage hidden in the Shear); the raid crews and whoever runs them.",
      tension:
        "You eat what you take, every other faction wants the Wreckers dead, and an unproven mouth doesn't get fed for long.",
      leads: [
        "A soft target spotted on the bulk lanes",
        "A raid crew short a hand and willing to risk taking you along",
        "A senior Wrecker who could vouch for you — for a price",
      ],
    },
  },
  {
    factionId: "f-free",
    hook: "Free Drift lives on the jobs no one else will touch and a contact on every side. A fixer on Rook has work that needs someone with no flag to fly.",
    threadTitle: "Make yourself useful across the lanes",
    threadBody:
      "You answer to no syndicate — that's the point. Take the jobs that need a neutral hand, keep your word to every side, and become the crew everyone calls and no one owns. The moment you pick a side for good, you stop being useful to the rest.",
    firstMoves: [
      "Take a no-questions courier job",
      "Work a Rook contact for leads",
      "Broker between two sides who won't meet",
    ],
    seed: {
      startLocation: "Rook Station — the lawless black-market hub where every side's business quietly passes through",
      recruitGoal:
        "Prove you can take the jobs no one else will and keep your word to every side without being owned by any.",
      anchors:
        "A fixer on Rook Station (the Ledger network moves cargo and secrets for anyone); contacts scattered across every faction.",
      tension:
        "With the lanes splitting into sides, everyone wants a neutral courier — and everyone wants to own one.",
      leads: [
        "A no-questions delivery between two sides that won't be seen dealing directly",
        "A job the Crown and Sable both refuse to touch",
        "A contact calling in an old favor at the worst time",
      ],
    },
  },
  {
    factionId: "f-reclaimers",
    hook: "The Reclaimers are convinced the Shear's wrecks aren't all accidents — and Kesh may be holding proof. Bring back salvage, or a buried truth, and you're one of them.",
    threadTitle: "Prove your worth to the Reclaimers",
    threadBody:
      "Salvagers who pull hardware — and secrets — out of dead ships. Haul back something valuable, or dig up something the powers would rather stay sunk, and you earn a place among them. Whatever you surface makes an enemy of whoever buried it.",
    firstMoves: [
      "Find a salvage crew to ride out with",
      "Ask Kesh what they're really looking for",
      "Fence a piece of salvage on Rook",
    ],
    loaner: {
      name: "The Magpie",
      shipClass: "scout",
      weaponName: "Cutting laser",
      notes:
        "Reclaimer salvage skiff — patched together from three dead ships. The crew lets you fly it until you've proven you'll bring the good finds back to them, not sell them out the side.",
    },
    seed: {
      startLocation: "Rook Station — the black-market hub where salvage crews berth, fence finds, and take on hands",
      recruitGoal:
        "Bring back valuable salvage — or a buried truth — to earn a place among the Reclaimers.",
      anchors:
        "Kesh (holds proof a colony ship's 'accident' was decades-old sabotage, undecided what to do with it); salvage crews working out of Rook; the wrecks in the Shear.",
      tension:
        "The Reclaimers suspect the Shear's wrecks aren't accidents, and whatever gets surfaced makes an enemy of whoever buried it.",
      leads: [
        "A salvage crew heading to a fresh wreck and short a hand",
        "Kesh's proof, and the dangerous question of what to do with it",
        "A piece of strange salvage that needs fencing or identifying",
      ],
    },
  },
  {
    factionId: "f-commons",
    hook: "The Commons protects the dock crews the syndicates bleed dry — quietly, because being known gets you disappeared. A foreman on Meridian is being squeezed by a collector right now. Help, and the crews start trusting you.",
    threadTitle: "Win the dock crews' trust",
    threadBody:
      "The Commons is a hunted movement against debt and syndicate rule — no ranks, no ledger, just people who look out for each other. Protect a crew, undercut a collector, and you earn a place. Get loud about it, and you become the next one to vanish.",
    firstMoves: [
      "Help the foreman being squeezed by a collector",
      "Quietly warn a crew about a coming crackdown",
      "Undercut a syndicate's grip on the docks",
    ],
    seed: {
      startLocation: "Meridian Ring — among the dock crews and cargo levels the syndicates bleed dry",
      recruitGoal:
        "Protect a dock crew or undercut a collector quietly enough to earn the crews' trust without becoming a target.",
      anchors:
        "The dock crews of Meridian Ring; a foreman being squeezed right now; the syndicate collectors who bleed them.",
      tension:
        "The Commons is hunted — no muscle to spare, no safe berth — and being known as one of them gets you disappeared.",
      leads: [
        "A foreman being squeezed by a syndicate collector today",
        "Word of a coming crackdown a crew doesn't know about yet",
        "A chokehold a syndicate has on the docks that could be quietly loosened",
      ],
    },
  },
];

/** Look up a faction's opening + starting points, if authored. */
export function openingFor(factionId: string | undefined): FactionOpening | undefined {
  if (!factionId) return undefined;
  return factionOpenings.find((o) => o.factionId === factionId);
}
