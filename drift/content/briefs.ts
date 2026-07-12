/**
 * Player-facing onboarding text: the world primer and the faction briefs shown
 * during character creation, plus the current season spine. Spoiler-light — this
 * is what a newcomer to the DRIFT lanes would actually be told.
 */

export const worldIntro = `THE DRIFT

A hard, lawless stretch of settled space strung between three stations and the dead lanes that connect them. Ships are freedom and debt in equal measure; a hull and a full tank can make you your own master, or bury you in someone else's ledger.

MERIDIAN RING is the closest thing to order — Crown territory, legitimate commerce, clean docks and cleaner money. ROOK STATION, three days out, is where the black market breathes: fixers, courier syndicates, and bounty desks, a place that respects you and fears you in the same breath. TALOS lies four days through THE SHEAR, a debris field that eats the careless and the unlucky, into hostile country.

Nobody here is coming to save you. Consequences stick. The dice are honest. And right now, the balance of power is cracking.`;

export const seasonOneSpine = `SEASON ONE — FAULT LINE

For years the Hollow Crown has owned the Meridian–Rook lanes: their debt, their routes, their rules. That grip is slipping. The Sable Chain — a rival syndicate that used to keep to the margins — is pushing into Crown lanes in the open, running scouts on the bulk routes and daring anyone to stop them. The Undertow smells opportunity in the chaos. Brokers hedge their bets. Old contacts go quiet.

Everyone in the lanes is choosing a side, or carving out their own. Where you start in this fault line is up to you. Where it ends is up to all of you.`;

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
    factionId: "f-ledger",
    name: "The Ledger Network",
    tagline: "Nothing moves without a record.",
    brief:
      "Rook Station's courier-fixers — symbol-marked, no real names, no drama. They move cargo and secrets between everyone, beholden to none. Starting here means neutrality, connections, and knowing things before others do. The catch: staying useful to all sides while trusted by none.",
    playstyle: "Neutral broker, smuggling, information, connections everywhere.",
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
    factionId: "f-talos",
    name: "Talos Security",
    tagline: "Order, at the edge of the map.",
    brief:
      "Station security four days through the Shear — hard-line, isolated, and suspicious of everyone from the inner lanes. Starting here means authority and a fortress at your back, but you're far from the action and short on friends. Outsiders don't trust Talos, and Talos trusts no one.",
    playstyle: "Authority, frontier law, isolation and hard choices.",
  },
];
