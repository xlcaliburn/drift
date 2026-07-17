import { playerThreatTier, patronHelp } from "@/shared/netWorth";
import { marketStock, repPriceFactor, localRep, repairQuote } from "@/engine/market";
import { pack } from "@/content/pack";
import type { Section } from "./types";

/**
 * The economy cluster — the sections that gate what the narrator may offer at a
 * location: enemy threat band, market stock, dock repair + debt, the faction
 * patron safety net, and the Rook body-mod studio. This is where most new
 * mechanics land, so keeping them together (and separate from the sheet/world
 * sections) minimizes cross-feature edit collisions.
 */

/** Net-worth threat band (COMBAT.md §1). The engine HARD-CLAMPS every combatStart
 *  to this ceiling, so tell the narrator too — otherwise it narrates "elite Crown
 *  commandos" that then spawn as T1 mooks. */
export const threat: Section = ({ state }) => {
  const ceilingTier = playerThreatTier(state);
  const bandDesc: Record<string, string> = {
    T1: "T1 — scrappers, dock toughs, lone gunhands. This player is lightly equipped; do NOT narrate professional squads or elite units as fair fights yet.",
    T2: "T2 — professionals, syndicate enforcers, trained crews. T3 elites still overmatch this player; use them only as clearly-superior threats (flee, not brawl).",
    T3: "T3 — elite operators, warband cores. The player is well-armed enough for top-tier fights.",
  };
  return [
    `THREAT BAND (enemy ceiling — the engine clamps fights to this): ${bandDesc[ceilingTier]} A named BOSS may exceed the band as a set-piece; rank-and-file may not.`,
  ];
};

/** The local shelves (ITEMS.md slice E) — engine-generated, so the narrator can
 *  only sell what actually exists here, at the engine's prices. */
export const market: Section = ({ state }) => {
  const locForMarket = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const stock = locForMarket ? marketStock(locForMarket, (state.campaign.tendaysElapsed ?? 0) * 10) : [];
  const marketRep = localRep(locForMarket, state.factions, state.factionRep);
  return [
    stock.length
      ? `MARKET HERE (FEATURED stock, engine-priced — never invent prices): ${stock
          .map((s) => `${s.item.id} ¢${Math.round(s.price * repPriceFactor(marketRep))}`)
          .join(" · ")}. This is a SAMPLE — the market also carries any other CATALOG gear up to its grade, so if the player asks for a tier-appropriate item, sell it (use its catalog id). Player buys → emit "purchase":{"itemId","qty"} (a catalog id, e.g. "combatRifle"); sells carried gear → "sell":{"name"} (≈40% of value). The ENGINE prices it, validates credits/tier/pack space, and prints every figure — narrate the counter, not the math, and never promise a price or a deal the engine hasn't confirmed.`
      : `MARKET HERE: none — nothing is for sale at this location.`,
  ];
};

/** Dock repair (ECONOMY E-3) + the debt payoff loop. The engine owns the figure
 *  and never refuses for lack of funds — it runs a tab. */
export const dock: Section = ({ state, pc }) => {
  const rq = repairQuote(state);
  const inDebt = (pc?.credits ?? 0) < 0;
  const lines: string[] = [];
  if (rq) {
    lines.push(
      `DOCK REPAIR HERE: the hull is damaged — a full patch runs ¢${rq.cost} (¢12/HP). Player asks to repair → emit "repair":{} (or "repair":{"hp":N} for a partial); the ENGINE charges and prints it, extending credit if they're short. Never state the figure yourself.`,
    );
  }
  if (inDebt) {
    lines.push(
      `DOCK DEBT: the player owes the dock (balance is negative). Steer them toward a quick T0/T1 payoff job — any payout comes off the debt first. Keep the pressure light but present.`,
    );
  }
  return lines;
};

/** The faction PATRON safety net (STARTER.md) — a struggling rookie has a named
 *  ally at their home station who patches them up for free. The anti-dead-end;
 *  fades once they've found their footing (net worth ≥ ¢600). Framing is keyed on
 *  `underCap` (still early-game), NOT `eligible` — eligible also requires the
 *  patron to be PRESENT and the player to actually need help, which is exactly
 *  when the model should be routing the player TO them, not when it should
 *  conclude the relationship has "graduated". */
export const patron: Section = ({ state, memory }) => {
  const { patron: campaignPatron, present, underCap } = patronHelp(
    state,
    memory?.sceneCard?.presentNpcIds ?? [],
  );
  if (!campaignPatron) return [];
  const patronHome = state.locations.find((l) => l.id === campaignPatron.locationId)?.name ?? "their home station";
  if (!underCap) {
    return [
      `YOUR PATRON — ${campaignPatron.name} at ${patronHome}: the player has outgrown the free hand-ups (they're established now). ${campaignPatron.name} is still a friendly contact and job-giver, but the freebies are done — treat them as a peer/broker, not a safety net.`,
    ];
  }
  return [
    present
      ? `YOUR PATRON — ${campaignPatron.name} (${campaignPatron.role ?? "your patron"}) is HERE WITH THE PLAYER right now. This early, they look out for the player: if the player is hurt, out of stims, or broke, ${campaignPatron.name} will rest them to full and stake them a little — FREE. Emit "patronRest":true when the player actually rests up with them THIS turn. Also hand out small, playstyle-fitting starter jobs (matched to the player's aim: trade runs, salvage/scouting, muscle work, or people/errands) with clear, achievable T0/T1 payouts so nobody stalls out.`
      : `YOUR PATRON — ${campaignPatron.name} (${campaignPatron.role ?? "your patron"}), based at ${patronHome}, is a warm early-game anchor — but is NOT in the current scene. Do NOT narrate them appearing, do NOT offer their free help, and do NOT emit "patronRest" unless the player actually travels to ${patronHome} (or the story genuinely brings ${campaignPatron.name} to the player). Reference them only when it fits — e.g. routing a badly hurt/broke/stuck player back to ${patronHome}, or a passing mention in conversation — never as a random aside or a chip-like offer out of nowhere. This support is EARLY-GAME only.`,
  ];
};

/** Body-modification studio — a one-station service (pack.services.bodyMod; the
 *  NPC Chrome). Lets a player re-customize their look and weave it into their
 *  story for a flat fee. */
export const bodyMod: Section = ({ state }) =>
  state.campaign.currentLocationId === pack.services.bodyMod
    ? [
        `BODY-MOD STUDIO (Rook only): Chrome's back-room studio reshapes a character's face, build, and skin for a flat ¢500, and works the change into their history. If the player COMMITS and describes the new look, emit "bodyMod":{"appearance":"<the new look>","story":"<a sentence folding it into their past>"} — the ENGINE charges and rewrites their appearance + backstory. Never state the price yourself; if they're short, the artist turns them away.`,
      ]
    : [];
