/**
 * Player-facing onboarding text: the world primer and the faction briefs shown
 * during character creation, plus the current season spine. Spoiler-light — this
 * is what a newcomer to the DRIFT lanes would actually be told.
 */

export const worldIntro = `THE DRIFT

A hard, lawless stretch of settled space strung between three stations — Meridian Ring, where the Hollow Crown keeps order and clean money; Rook, where the black market breathes; and Talos, frontier country past the debris field called the Shear. A ship is freedom and debt in equal measure. Three powers move in the lanes: the Hollow Crown, who own the debt; the Sable Chain, the rival syndicate rising against them; and the Undertow, who profit off the chaos in between. Right now the Crown and the Chain are going to war over the routes — and nobody is coming to save you.`;

export const seasonOneSpine = `SEASON ONE — FAULT LINE

The Crown's grip on the Meridian–Rook lanes is slipping, and the Sable Chain is pushing into their routes in the open. Everyone is choosing a side — or carving out their own.`;

export interface FactionBrief {
  factionId: string;
  name: string;
  tagline: string;
  brief: string;
  playstyle: string;
}

/** Factions a player can begin embedded in. */
export const factionBriefs: FactionBrief[] = [
  {
    factionId: "f-crown",
    name: "The Hollow Crown",
    tagline: "The house that owns the debt.",
    brief:
      "The established power on the Meridian lanes — a loan syndicate turned patron, with legitimate fronts and long memories. They reward loyalty with real work: courier runs, escort contracts, intel jobs. But the Crown's grip is slipping, and a slipping empire gets nervous. Starting here means resources and reach, and the pressure of holding a line that's already cracking.",
    playstyle: "Establishment power, steady work, defending turf under threat.",
  },
  {
    factionId: "f-sable",
    name: "The Sable Chain",
    tagline: "The rising knife.",
    brief:
      "A rival syndicate done keeping to the margins, pushing hard into Crown lanes. Aggressive, hungry, and organized — they're the reason the balance is cracking. Starting here means momentum and risk: you're the insurgent, the one everyone's suddenly watching. Room to rise fast, and a target on your back.",
    playstyle: "Insurgent, aggressive expansion, high-risk high-reward.",
  },
  {
    factionId: "f-undertow",
    name: "The Undertow",
    tagline: "Debts collected, one way or another.",
    brief:
      "A debt-collection outfit that works the grim edges — bounties, enforcement, leverage. Morally hard, but they respect a clean operator and pay for results. They smell opportunity in the chaos. Starting here means muscle, information, and a reputation that opens doors and closes throats. Where you draw your lines is your business.",
    playstyle: "Enforcement, bounties, leverage and information.",
  },
  {
    factionId: "f-meridian",
    name: "Meridian Commerce",
    tagline: "Legitimate business in an illegitimate age.",
    brief:
      "The brokers, depots, and trade houses of the Meridian Ring — the legal economy the syndicates prey on. Starting here means capital, cargo, and clean standing, but you're soft where it counts. The lanes are getting dangerous, and honest money needs someone willing to get its hands dirty to protect it.",
    playstyle: "Commerce, logistics, building wealth while staying legitimate.",
  },
  {
    factionId: "f-wreckers",
    name: "The Wreckers",
    tagline: "What drifts, we take.",
    brief:
      "Raiders who nest deep in the Shear — the debris field no lawful crew dares cross — and hunt the bulk lanes from it. No patron, no ledger, no law: what you have, you took, and you keep it only as long as you can hold it. Starting here means a fast, violent life with no safety net and no masters. The catch — every other faction wants you dead, and your own crew would sell you for a full tank.",
    playstyle: "Raiding, ambush, plunder — lawless survival, no allegiance.",
  },
  {
    factionId: "f-free",
    name: "Free Drift",
    tagline: "No flag, no leash.",
    brief:
      "The independents — crews who refuse every syndicate and patron but keep each other alive: shared frequencies, safe berths, a no-questions code. They're the lanes' open circuit, carrying work and word between powers that won't be seen dealing directly. Starting here means a contact on every side and an obligation to none — you take the jobs no one else can touch. The catch: everyone wants to own you, and the moment you pick a side for good, you stop being useful to the rest.",
    playstyle: "Freelance across all sides — contacts everywhere, allegiance nowhere.",
  },
  {
    factionId: "f-reclaimers",
    name: "The Reclaimers",
    tagline: "The dead ships still have things to say.",
    brief:
      "Salvagers and tech-scavengers who pull hardware — and buried truths — out of dead ships. They already suspect the Shear's wrecks aren't all accidents. Starting here means strange gear, hard knowledge, and a nose for what the powers would rather stay sunk. The catch: what you dig up makes an enemy of whoever buried it.",
    playstyle: "Salvage, tech, investigation, uncovering secrets.",
  },
  {
    factionId: "f-commons",
    name: "The Commons",
    tagline: "The debt ends with us.",
    brief:
      "A hunted movement against debt and syndicate rule — no ranks and no ledger, just dock crews and spacers who look out for each other and quietly sabotage the powerful. Starting here means trust where the syndicates have none and a cause worth the risk. The catch: the Commons has no muscle to spare and no safe berth, and the moment you're known, you're the next one to disappear.",
    playstyle: "Grassroots resistance, protection, quiet sabotage of the powerful.",
  },
];
