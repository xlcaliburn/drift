import type { CampaignState } from "@/shared/schemas";
import { skillProgress } from "@/engine";
import { backgrounds, ambitions } from "@/content/creation";
import { allItems, itemCount } from "@/shared/items";
import { relationSuffix, relationHistory, RECENT_SCENES_IN_PROMPT, type SceneCard, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { generateQuirk } from "@/shared/npcFlavor";
import { shipIsOwned, shipThreadId } from "@/shared/recap";
import { playerThreatTier, patronHelp } from "@/shared/netWorth";
import { marketStock, repPriceFactor, localRep, repairQuote } from "@/engine/market";
import { inTutorial, TUTORIAL_CHOICE_DIRECTIVE, TUTORIAL_JSON_DIRECTIVE } from "@/shared/tutorial";
import type { Dossier } from "@/shared/multiplayer";
import { retrieveEntities, tokenize } from "./retrieval";

/**
 * Per-turn prompt assembly. The heavy pieces were split out so parallel work
 * doesn't collide here: the JSON system contract lives in `jsonSystem.ts`, entity
 * retrieval in `retrieval.ts`. This file owns `buildContextSlice` — the per-turn
 * user-message context — and re-exports the extracted symbols so existing
 * consumers (jsonTurn + tests) keep importing from the one stable facade.
 */
export { buildJsonSystem } from "./jsonSystem";
export { retrieveEntities };

/** How close an NPC is: in the scene with the player (immediate), on the same
 *  station/area (nearby), or neither (unmarked — recalled from elsewhere). */
function proximityTag(n: { id: string; locationId?: string }, present: Set<string>, currentLoc?: string): string {
  if (present.has(n.id)) return " [immediate]";
  if (n.locationId && currentLoc && n.locationId === currentLoc) return " [nearby]";
  return "";
}

/**
 * Cross-campaign cameo pool (MULTIPLAYER.md): from the OTHER players' dossiers
 * reachable in this universe, pick up to `cap` the narrator may bring in as an
 * NPC. Only living characters qualify. Same-location dossiers are PREFERRED (they
 * can plausibly be here now), then the rest fill remaining slots. Ordering is
 * deterministic — same-location first, then by name — so no Math.random and the
 * same turn always yields the same pool.
 */
export function reachableDossiers(
  dossiers: Dossier[],
  currentLocationId: string | undefined,
  cap = 2,
): Dossier[] {
  const alive = dossiers.filter((d) => d.alive);
  const here = alive
    .filter((d) => currentLocationId && d.locationId === currentLocationId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const elsewhere = alive
    .filter((d) => !(currentLocationId && d.locationId === currentLocationId))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...here, ...elsewhere].slice(0, Math.max(0, cap));
}

/**
 * Render the OTHER PLAYERS' CHARACTERS context block from the selected dossiers.
 * Lean by design (token cost): name, faction, tier, a voice/role line, whether
 * they're here now vs. elsewhere, and 1-2 recent deed headlines.
 */
function otherCharactersBlock(
  dossiers: Dossier[],
  factionName: (id?: string) => string,
  currentLocationId: string | undefined,
): string {
  if (!dossiers.length) return "";
  const lines = dossiers.map((d) => {
    const here = currentLocationId && d.locationId === currentLocationId ? "HERE NOW" : "elsewhere";
    const faction = d.factionId ? factionName(d.factionId) : "unaligned";
    const voice = d.voiceNotes?.trim() || d.role?.trim() || d.reputation?.trim() || "";
    const deeds = d.deeds
      .slice(-2)
      .map((x) => x.headline)
      .filter(Boolean);
    const bits = [
      `  - ${d.name} (${faction}, ${d.capabilityTier}, ${here})`,
      voice ? `: ${voice}` : "",
      deeds.length ? ` — known for: ${deeds.join("; ")}` : "",
    ];
    return bits.join("");
  });
  return (
    `OTHER PLAYERS' CHARACTERS IN THE WORLD (real, canon — from other players' games; play TRUE to this, invent no mechanics; bring in at most ONE, only when natural):\n` +
    lines.join("\n")
  );
}

/**
 * Assemble the per-turn context slice: current location, present NPCs, relevant
 * active threads, party vitals, ship state, and any clock near a milestone.
 * This is the block that keeps token cost flat regardless of campaign length.
 */
export function buildContextSlice(
  state: CampaignState,
  playerText: string,
  focusIds: string[] = [],
  retrieved?: { npcs: CampaignState["npcs"]; threads: CampaignState["threads"] },
  /** JSON-turn variant: tutorial directive phrased for fields, not tools. */
  jsonMode = false,
  /** Scene memory (CONTINUITY.md): card + relations + recent summaries. */
  memory?: { sceneCard?: SceneCard; npcRelations?: NpcRelations; recentScenes?: SceneMemory[] },
  /** Reachable dossiers of OTHER players' characters in this universe (cross-campaign cameos). */
  otherDossiers?: Dossier[],
): string {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const { npcs, threads } = retrieved ?? retrieveEntities(state, playerText, focusIds);

  const pc = state.characters.find((c) => c.kind === "pc");

  const vitals = (c: (typeof state.characters)[number]) =>
    `${c.name}: HP ${c.hp}/${c.maxHp}, AC ${c.ac}${c.credits !== undefined ? `, ¢${c.credits}` : ""}${c.loyalty !== undefined ? `, loyalty ${c.loyalty}/5` : ""}${c.fragile ? " [FRAGILE: death saves -4]" : ""}`;

  const ship = state.ship;
  const shipOwnership = ship ? (shipIsOwned(state) ? "OWNED" : "ON LOAN — not yet theirs") : "";
  // List the ACTUAL armament (name + type, ammo only for missiles) so the narrator
  // can't invent a weapon the hull doesn't carry — e.g. "fire a missile" on a ship
  // with only a kinetic gun. "unarmed" is explicit when there are no weapons.
  const armament = ship
    ? ship.weapons.length
      ? ship.weapons
          .map((w) => `${w.name} (${w.type}${w.type === "missile" ? `, ${w.ammo ?? 0} left` : ""})`)
          .join(", ")
      : "UNARMED — no weapons"
    : "";
  const shipLine = ship
    ? `${ship.name} (${ship.shipClass}) [${shipOwnership}]: HP ${ship.hp}/${ship.maxHp}, AC ${ship.ac}${ship.evasiveAcBonus ? ` (+${ship.evasiveAcBonus} evasive)` : ""}, ${ship.hasShield ? `shield ${ship.shieldReady ? "ready" : "spent"}` : "no shield"}, burst ${ship.burstDriveReady ? "ready" : "used"}. Weapons: ${armament} (this is EXACTLY what it carries — invent nothing more).`
    : "no ship (grounded — begs/borrows passage until they earn a hull)";

  const clocksLine = state.clocks
    .filter((c) => c.status === "active")
    .map((c) => {
      const near = c.milestones.some((m) => !m.done && m.at === c.current + 1);
      return `${c.name}: ${c.current}/${c.max}${near ? " ⚠ next tick hits a milestone" : ""}`;
    })
    .join("; ");

  const repLine = state.factionRep
    .map((r) => `${state.factions.find((f) => f.id === r.factionId)?.name ?? r.factionId} ${r.rep >= 0 ? "+" : ""}${r.rep}`)
    .join(", ");

  // The Fault Line — the season's shared pressure. Surface its current phase every
  // turn so the narrator keeps it in play and reads it through the PC's faction.
  const faultLine = state.clocks.find((c) => c.id === "clk-faultline");
  const pcFactionName = pc?.parentFactionId
    ? state.factions.find((f) => f.id === pc.parentFactionId)?.name ?? "the PC's faction"
    : "the PC's faction";
  let seasonLine = "";
  if (faultLine) {
    const crossed = faultLine.milestones.filter((m) => m.at <= faultLine.current).slice(-1)[0];
    const next = faultLine.milestones.find((m) => m.at > faultLine.current);
    const phase = crossed ? crossed.effect : "the lanes are only beginning to crack — tension, not yet blood";
    const nextStr = next ? ` Coming at day ${next.at}: ${next.effect}.` : " The reckoning is here.";
    seasonLine = `SEASON — THE FAULT LINE (day ${faultLine.current}/${faultLine.max}): ${phase}. Shared pressure on every faction; read it through ${pcFactionName}, the PC's side.${nextStr}`;
  }
  const moralLine = pc?.moralCode ? `PC's line they won't cross: ${pc.moralCode}.` : "";

  // Net-worth threat band (COMBAT.md §1). The engine HARD-CLAMPS every combatStart
  // to this ceiling, so tell the narrator too — otherwise it narrates "elite Crown
  // commandos" that then spawn as T1 mooks (fiction/mechanics mismatch). Keep the
  // foes it describes at or below the ceiling until the player arms up.
  const ceilingTier = playerThreatTier(state);
  const bandDesc: Record<string, string> = {
    T1: "T1 — scrappers, dock toughs, lone gunhands. This player is lightly equipped; do NOT narrate professional squads or elite units as fair fights yet.",
    T2: "T2 — professionals, syndicate enforcers, trained crews. T3 elites still overmatch this player; use them only as clearly-superior threats (flee, not brawl).",
    T3: "T3 — elite operators, warband cores. The player is well-armed enough for top-tier fights.",
  };
  const threatLine = `THREAT BAND (enemy ceiling — the engine clamps fights to this): ${bandDesc[ceilingTier]} A named BOSS may exceed the band as a set-piece; rank-and-file may not.`;

  // The local shelves (ITEMS.md slice E) — engine-generated, so the narrator can
  // only sell what actually exists here, at the engine's prices. No block = no
  // market at this location = nothing is for sale, full stop.
  const locForMarket = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const stock = locForMarket ? marketStock(locForMarket, (state.campaign.tendaysElapsed ?? 0) * 10) : [];
  const marketRep = localRep(locForMarket, state.factions, state.factionRep);
  const marketLine = stock.length
    ? `MARKET HERE (FEATURED stock, engine-priced — never invent prices): ${stock
        .map((s) => `${s.item.id} ¢${Math.round(s.price * repPriceFactor(marketRep))}`)
        .join(" · ")}. This is a SAMPLE — the market also carries any other CATALOG gear up to its grade, so if the player asks for a tier-appropriate item, sell it (use its catalog id). Player buys → emit "purchase":{"itemId","qty"} (a catalog id, e.g. "combatRifle"); sells carried gear → "sell":{"name"} (≈40% of value). The ENGINE prices it, validates credits/tier/pack space, and prints every figure — narrate the counter, not the math, and never promise a price or a deal the engine hasn't confirmed.`
    : `MARKET HERE: none — nothing is for sale at this location.`;

  // Dock repair (ECONOMY E-3) + the debt payoff loop. The engine owns the figure
  // and never refuses for lack of funds — it runs a tab.
  const rq = repairQuote(state);
  const inDebt = (pc?.credits ?? 0) < 0;
  const dockLine = rq
    ? `DOCK REPAIR HERE: the hull is damaged — a full patch runs ¢${rq.cost} (¢12/HP). Player asks to repair → emit "repair":{} (or "repair":{"hp":N} for a partial); the ENGINE charges and prints it, extending credit if they're short. Never state the figure yourself.`
    : "";
  const debtLine = inDebt
    ? `DOCK DEBT: the player owes the dock (balance is negative). Steer them toward a quick T0/T1 payoff job — any payout comes off the debt first. Keep the pressure light but present.`
    : "";

  // The faction PATRON safety net (STARTER.md) — a struggling rookie has a named
  // ally at their home station who patches them up for free (the engine applies it
  // via the "Rest up with <patron>" chip / a "patronRest":true field). This is the
  // anti-dead-end: a player who's broke, out of stims, and knocked around can
  // ALWAYS get back on their feet. It fades once they've found their footing
  // (net worth ≥ ¢600), so lean on it early and let it go later.
  const { patron: campaignPatron, eligible: patronEligible } = patronHelp(state, memory?.sceneCard?.presentNpcIds ?? []);
  const patronHome = campaignPatron
    ? state.locations.find((l) => l.id === campaignPatron.locationId)?.name ?? "their home station"
    : "";
  const patronLine =
    campaignPatron && patronEligible
      ? `YOUR PATRON — ${campaignPatron.name} (${campaignPatron.role ?? "your patron"}) at ${patronHome}: this early, they look out for the player. When the player is hurt, broke, out of stims, or stuck, ${campaignPatron.name} will rest them to full and stake them a little — FREE. Make them a warm, reliable anchor; route the player back to them when things go badly, and hand out small, playstyle-fitting starter jobs (matched to the player's aim: trade runs, salvage/scouting, muscle work, or people/errands) with clear, achievable T0/T1 payouts so nobody stalls out. Emit "patronRest":true when the player rests up with them. This support is EARLY-GAME only.`
      : campaignPatron
        ? `YOUR PATRON — ${campaignPatron.name} at ${patronHome}: the player has outgrown the free hand-ups (they're established now). ${campaignPatron.name} is still a friendly contact and job-giver, but the freebies are done — treat them as a peer/broker, not a safety net.`
        : "";

  // Body-modification studio — a Rook-only service (the NPC Chrome). Lets a player
  // re-customize their look and weave it into their story for a flat fee.
  const bodyModLine =
    state.campaign.currentLocationId === "loc-rook"
      ? `BODY-MOD STUDIO (Rook only): Chrome's back-room studio reshapes a character's face, build, and skin for a flat ¢500, and works the change into their history. If the player COMMITS and describes the new look, emit "bodyMod":{"appearance":"<the new look>","story":"<a sentence folding it into their past>"} — the ENGINE charges and rewrites their appearance + backstory. Never state the price yourself; if they're short, the artist turns them away.`
      : "";

  // Consumables the PC actually holds — so the narrator only offers useItem for
  // items in hand (and knows what's available to spend between fights).
  const held = pc
    ? allItems()
        .filter((i) => i.type === "consumable")
        .map((i) => ({ name: i.name, n: itemCount(pc, i.id) }))
        .filter((x) => x.n > 0)
    : [];
  const consumablesLine = held.length ? `PC consumables: ${held.map((h) => `${h.name} ×${h.n}`).join(", ")}.` : "";

  // Everything the PC carries — weapons with damage, tools/flavor items by name —
  // so recently-acquired gear (a looted facemask, a crowbar) stays usable in the
  // fiction instead of vanishing when its pickup scrolls out of history.
  const gearLine = pc?.gear.length
    ? `PC gear (they carry EXACTLY this): ${pc.gear
        .map((g) => `${g.name}${g.qty && g.qty > 1 ? ` ×${g.qty}` : ""}${g.damage ? ` (${g.damage})` : ""}`)
        .join(", ")}.`
    : "";

  // Identity — the PC's past and their drive. Creation bakes these into gear and
  // backstory but they weren't re-fed at play time, so the narrator couldn't pull
  // on them. Surface background + ambition each turn as material for scenes, NPCs,
  // and personal hooks (the ambition's blurb is the emotional lever).
  const bgLabel = pc?.background ? backgrounds.find((b) => b.id === pc.background)?.label ?? pc.background : "";
  const amb = pc?.ambition ? ambitions.find((a) => a.id === pc.ambition) : undefined;
  const identityBits = [
    bgLabel ? `background: ${bgLabel}` : "",
    amb ? `ambition: ${amb.label} — ${amb.description}` : "",
    pc?.appearance ? `appearance: ${pc.appearance}` : "",
  ].filter(Boolean);
  const identityLine =
    pc && identityBits.length
      ? `PC identity — ${identityBits.join("; ").replace(/\.$/, "")}. Pull on this past and this drive when framing scenes, NPCs, and personal hooks; surface it naturally, don't recite it.`
      : "";

  // The player's OWN stated aim (campaign.directive) — the single strongest signal
  // of what THIS player wants out of play. The narrator bends the world toward it
  // and, crucially, does NOT force an unrelated questline: if they want to build
  // relationships, relationships ARE the game.
  const directiveLine = state.campaign.directive?.trim()
    ? `PLAYER'S OWN AIM (what THIS player wants from the game — weight this heavily): "${state.campaign.directive.trim()}". Bend the world toward it: offer NPCs, scenes, and hooks that serve it, and let it BE the throughline. Do NOT force an unrelated questline on a player who wants something else — if they lean toward people and talk, relationships and social play are the point, not a detour from "the real quest."`
    : "";

  // ── Scene memory blocks (CONTINUITY.md) ──────────────────────────────────
  // PREVIOUSLY: the last few scene summaries — the rolling "story so far" —
  // plus up to 2 OLDER scenes retrieved because their people/places resurfaced.
  const rels = memory?.npcRelations ?? {};
  const allRecent = memory?.recentScenes ?? [];
  const tail = allRecent.slice(-RECENT_SCENES_IN_PROMPT);
  const tailSeqs = new Set(tail.map((s) => s.seq));
  const turnTokens = new Set(tokenize(playerText));
  const surfacedIds = new Set<string>([...npcs.map((n) => n.id), ...focusIds]);
  const recalled = allRecent
    .filter((s) => !tailSeqs.has(s.seq))
    .map((s) => {
      let score = 0;
      if (s.entityRefs.some((r) => surfacedIds.has(r))) score += 50;
      score += tokenize(s.title).filter((w) => turnTokens.has(w)).length * 20;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.s)
    .sort((a, b) => a.seq - b.seq);
  const previously = [...recalled, ...tail];
  const previouslyBlock = previously.length
    ? `PREVIOUSLY (older scenes, oldest first — this HAPPENED; stay consistent with it):\n${previously
        .map((s) => `  ${s.seq}. ${s.title}: ${s.summary}`)
        .join("\n")}`
    : "";

  // SCENE NOW: the current scene's working memory (engine-owned card).
  const card = memory?.sceneCard;
  // Proximity: who is right here vs. merely on the same station (engine-derived).
  const presentSet = new Set(card?.presentNpcIds ?? []);
  const sceneNow = card
    ? [
        `SCENE NOW (scene ${card.seq}, turn ${card.turnCount})`,
        ...(card.place ? [`Where: ${card.place} (the player is HERE now, not necessarily the station above)`] : []),
        ...(card.situation ? [`Situation: ${card.situation}`] : []),
        ...(card.dangers?.length
          ? [`⚠ ACTIVE DANGERS: ${card.dangers.join(" · ")} — keep these in play until dealt with (clear via scene.dangers).`]
          : []),
        ...(card.beats.length ? [`Established this scene: ${card.beats.join(" · ")}`] : []),
      ].join("\n")
    : "";

  // Cross-campaign cameo pool: other players' characters the narrator may bring
  // in as an NPC this scene (same-location preferred). Lean block, capped at 2.
  const cameos = reachableDossiers(otherDossiers ?? [], loc?.id);
  const otherChars = otherCharactersBlock(
    cameos,
    (id) => (id ? state.factions.find((f) => f.id === id)?.name ?? id : "unaligned"),
    loc?.id,
  );

  return [
    // While the player is still on training wheels, lead with the tutorial
    // directive so it outranks the static style rules for this beat.
    ...(inTutorial(state) ? [jsonMode ? TUTORIAL_JSON_DIRECTIVE : TUTORIAL_CHOICE_DIRECTIVE, ``] : []),
    ...(previouslyBlock ? [previouslyBlock, ``] : []),
    ...(directiveLine ? [directiveLine, ``] : []),
    `CURRENT SCENE`,
    `Location: ${loc ? `${loc.name} — ${loc.description}` : "unknown"}`,
    ...(seasonLine ? [seasonLine] : []),
    ...(sceneNow ? [sceneNow] : []),
    ``,
    `PC skills (id: ${pc?.id ?? "pc"}): ${pc ? pc.skills.map(skillProgress).join(" · ") : "—"}`,
    ...(identityLine ? [identityLine] : []),
    ...(gearLine ? [gearLine] : []),
    ...(consumablesLine ? [consumablesLine] : []),
    ...(moralLine ? [moralLine] : []),
    `Party & PC vitals:`,
    ...state.characters.map((c) => `  ${vitals(c)} (id: ${c.id})`),
    // A Downed PC is handled by the Bleeding Out turn (death saves), not this path,
    // so no downed directive is needed here.
    `Ship: ${shipLine}`,
    threatLine,
    marketLine,
    ...(dockLine ? [dockLine] : []),
    ...(debtLine ? [debtLine] : []),
    ...(patronLine ? [patronLine] : []),
    ...(bodyModLine ? [bodyModLine] : []),
    ``,
    npcs.length
      ? `NPCs in play (proximity = how close; standing = their history; "plays:" = their canon personality — play it CONSISTENTLY; "hook:" = a backstory thread you can pull into a quest; "history:" = what has ALREADY passed between you and them — treat it as fact and NEVER act as if it didn't happen):\n${npcs
          .map((n) => {
            const quirk = n.quirk ?? generateQuirk(n.id);
            const hook = presentSet.has(n.id) && n.backstory ? ` [hook: ${n.backstory}]` : "";
            // Feed the full relationship history for any NPC relevant this turn (present
            // OR surfaced by the player's text) so an extensive prior scene with them
            // can't be forgotten — the "Agnes forgot her whole scene with Sera" bug.
            // relationHistory is quiet for a brand-new tie (the suffix's `last:` covers it).
            const hist = relationHistory(rels[n.id]);
            const histLine = hist ? `\n      history: ${hist}` : "";
            return `  - ${n.name} (id: ${n.id})${proximityTag(n, presentSet, loc?.id)}: ${n.oneBreath} (plays: ${quirk})${relationSuffix(rels[n.id])}${hook}${histLine}`;
          })
          .join("\n")}`
      : `NPCs in play: none flagged`,
    ``,
    ...(otherChars ? [otherChars, ``] : []),
    threads.length ? `Relevant threads:\n${threads.map((t) => `  - ${t.title} (id: ${t.id}): ${t.body}`).join("\n")}` : `Relevant threads: none flagged`,
    ``,
    `Clocks: ${clocksLine}`,
    `Faction rep: ${repLine}`,
    ``,
    // JSON turns only reference clock + faction ids (clockAdvances/worldEvent);
    // the tool loop needed the full roster. Keep the slice lean per mode.
    jsonMode
      ? `Ids — clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}.`
      : `Entity ids for tools — characters: ${state.characters.map((c) => c.id).join(", ")}; ship: ${state.ship?.id ?? "none"}; clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}${state.ship && !shipIsOwned(state) ? `; ship-ownership thread (resolve to grant the title): ${shipThreadId(state.campaign.id)}` : ""}.`,
  ].join("\n");
}
