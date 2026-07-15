import type { CampaignState, Character } from "@/shared/schemas";
import type { TurnPlan } from "@/shared/turnPlan";
import type { CombatState } from "@/shared/combat";
import type { SpawnSpec, ShipClass } from "@/engine/combatEngine";
import type { TurnRuntime } from "./engineBridge";
import { SCENE_TURN_CAP } from "@/shared/scene";
import { playerThreatTier, clampTier } from "@/shared/netWorth";
import { payoutCeiling, clampPayoutTier, type PayoutTier } from "@/shared/payoutRamp";
import { knownEntityNames, isPlausibleNpcName } from "@/shared/npcExtract";

/**
 * Apply the plan's mechanical INTENTS through the engine (jsonTurn regions I + J).
 * Every field the model can emit that changes state — payout/offers, item use,
 * shop buy/sell, dock repair, patron rest, body-mod, NPC registration + relations,
 * gear items, scene card, world events, quest threads, clock advances, scene end,
 * and combatStart — is applied here, in a fixed order. Pure engine calls: the
 * TurnRuntime is the only mutator, so this is fully testable without a model call.
 *
 * Ordering invariants (do not reshuffle without reading REFACTOR.md Plan 2):
 *  1. Money reads `ctx.lastRoll` (a negotiation this turn shades the band), so this
 *     runs AFTER the pre/mid-turn rolls that set it.
 *  2. `combatStart` runs LAST and only when `ctx.combat` is still null — a gun-skill
 *     reroute earlier this turn already started the fight and wins.
 *  3. `combatStart` reads `ctx.preState` (the PRE-turn state) for the net-worth
 *     ceiling, and `plan.narration` for the narrated-count backstop.
 *  4. The caller reconciles dock debt (syncDockDebt) AFTER this, so scene-end wages
 *     and payouts here are all included.
 */
export interface ApplyCtx {
  runtime: TurnRuntime;
  /** The PRE-turn state (input.state) — used for the combat net-worth ceiling. */
  preState: CampaignState;
  pc: Character | undefined;
  emit: (lines: string[]) => void;
  toolCalls: string[];
  /** Last resolved action check this turn (set by the pre/mid-turn roll). */
  lastRoll: { skill: string; outcome?: string } | null;
  /** Combat spawned this turn — combatStart sets it; a reroute may have already. */
  combat: CombatState | null;
}

/** Default enemy ship class when the model gives only a tier for a ship fight. */
const TIER_TO_CLASS: Record<"T1" | "T2" | "T3", string> = { T1: "scout", T2: "fighter", T3: "gunship" };

const FOE_NOUNS =
  "wrecker|guard|enforcer|goon|thug|mook|raider|soldier|merc|mercenary|gunman|gunhand|pirate|hostile|" +
  "attacker|assailant|cutter|heavy|heavies|bruiser|bandit|trooper|sentry|marauder|tough|brute|hitman|fighter|foe";
const FOE_NUM: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, couple: 2, pair: 2, few: 3, several: 4, handful: 4,
};
const FOE_COUNT_RE = new RegExp(
  `\\b(\\d+|two|three|four|five|couple|pair|few|several|handful)\\s+(?:\\w+\\s+){0,2}?(?:${FOE_NOUNS})s?\\b`,
  "gi",
);

/** How many foes the narration says are attacking ("two wreckers", "a couple of
 *  thugs", "3 guards"). The engine uses this to force the spawn to MATCH the fiction
 *  when the model under-fills combatStart (narrates two, spawns one). Capped at 5,
 *  0 when nothing is stated. */
function narratedFoeCount(narration: string): number {
  let max = 0;
  let m: RegExpExecArray | null;
  FOE_COUNT_RE.lastIndex = 0;
  while ((m = FOE_COUNT_RE.exec(narration)) !== null) {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : FOE_NUM[m[1].toLowerCase()] ?? 0;
    if (n > max) max = n;
  }
  return Math.min(max, 5);
}

export function applyPlan(plan: TurnPlan, ctx: ApplyCtx): void {
  const { runtime, pc, emit, toolCalls, lastRoll, preState } = ctx;

  // ── Apply the plan's mechanical intents through the engine. ────────────────
  // A successful negotiation THIS turn shades money to the upper half of the
  // band (a failed one to the lower) — shared by both payouts and offers.
  const negotiationMood: "high" | "low" | undefined =
    lastRoll?.skill === "negotiation"
      ? lastRoll.outcome === "success"
        ? "high"
        : "low"
      : undefined;
  // Progression ramp: a green, tendays-0 rookie shouldn't be handed professional
  // (T2) or major-score (T3) money just because the narrator called the job "big".
  // Clamp the model's tier DOWN to what the campaign's advancement has earned.
  const rewardCeiling = payoutCeiling(preState);
  if (plan.payout && pc) {
    toolCalls.push("award_payout");
    const tier = clampPayoutTier(plan.payout.tier as PayoutTier, rewardCeiling);
    const res = runtime.execute("award_payout", {
      tier,
      reason: plan.payout.reason,
      mood: negotiationMood,
    }) as { amount?: number; tier?: string; error?: string };
    if (res.amount) emit([`💰 Payment: +¢${res.amount} (${tier})`]);
  }
  // OFFERS: bids/quotes the model presented (a job's pay, a rival buyer's counter).
  // The model names a TIER; the engine rolls the bounded figure and shows it as a
  // system line — the real number the player sees, never a re-call to the model.
  if (plan.offers?.length) {
    const offerLines: string[] = [];
    for (const offer of plan.offers.slice(0, 3)) {
      const amount = runtime.quoteOffer(clampPayoutTier(offer.tier as PayoutTier, rewardCeiling), negotiationMood);
      if (amount != null) offerLines.push(`💰 ${offer.from?.trim() || "Offer"}: ~¢${amount}`);
    }
    if (offerLines.length) {
      toolCalls.push("quote_offer");
      emit(offerLines);
    }
  }
  if (plan.useItem && pc) {
    toolCalls.push("use_item");
    const res = runtime.useItem(plan.useItem.itemId, pc.id) as { line?: string; error?: string };
    if (res.line) emit([res.line]);
    // Failed use (e.g. the model thinks they hold an item they don't) must be
    // VISIBLE — otherwise the narration claims a heal that never happened.
    else if (res.error) emit([`⚠ Can't use item: ${res.error}`]);
  }
  // Shop transactions (ITEMS.md slice E) — the engine owns the whole exchange:
  // shelf check, rep-adjusted price, credits, pack space. Failures are visible
  // for the same reason as useItem: a narrated deal that didn't happen must not
  // pass silently.
  if (plan.purchase && pc) {
    toolCalls.push("buy_item");
    const res = runtime.buyItem(plan.purchase.itemId, plan.purchase.qty ?? 1);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ No sale: ${res.error}`]);
  }
  if (plan.sell && pc) {
    toolCalls.push("sell_item");
    const res = runtime.sellItem(plan.sell.name);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ No sale: ${res.error}`]);
  }
  // Dock repair (ECONOMY E-3) — model-initiated ("patch me up at the dock").
  if (plan.repair && pc) {
    toolCalls.push("repair_ship");
    const res = runtime.repairShip(plan.repair.hp ?? undefined);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
  // Patron safety net (STARTER.md) — model-initiated ("rest up with your patron").
  if (plan.patronRest && pc) {
    toolCalls.push("rest_patron");
    const res = runtime.restWithPatron();
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
  // Rook body-modification (Chrome's studio) — reshape appearance + story for ¢500.
  if (plan.bodyMod && pc) {
    toolCalls.push("body_mod");
    const res = runtime.bodyMod({
      appearance: plan.bodyMod.appearance ?? undefined,
      story: plan.bodyMod.story ?? undefined,
    });
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
  // Persist any named NPCs the narrator introduced so the world remembers them
  // (continuity — recognized when the player returns), mark them present in the
  // scene, and apply relationship updates (disposition nudge / last-note / tie).
  if (plan.npcs?.length) {
    // A cheap narrator dumps junk into npcs — sentence fragments ("End", "You're"),
    // the ship's name, even the CHOICE VERBS ("Scavenge", "Search", "Tend"). Two
    // gates keep the cast clean: (1) a stopword / non-person-entity guard, and
    // (2) the name must actually appear in THIS turn's prose — a real figure is
    // named in the story; a choice verb or hallucinated label is not.
    const nonPersons = knownEntityNames([
      ...(runtime.state.ship ? [runtime.state.ship.name] : []),
      ...runtime.state.locations.map((l) => l.name),
      ...runtime.state.factions.map((f) => f.name),
    ]);
    const narrationText = plan.narration ?? "";
    for (const npc of plan.npcs.slice(0, 4)) {
      const nm = npc.name?.trim();
      if (!nm || !isPlausibleNpcName(nm, nonPersons)) continue;
      const bare = nm.replace(/['’]s$/i, "");
      if (!narrationText.includes(nm) && !narrationText.includes(bare)) continue;
      toolCalls.push("register_npc");
      const { id } = runtime.registerNpc(npc.name, npc.oneBreath ?? undefined);
      runtime.markPresent(id);
      const rel = runtime.updateNpcRelation(id, {
        disposition: npc.disposition ?? undefined,
        note: npc.note ?? undefined,
        relationship: npc.relationship ?? undefined,
      });
      if (rel.line) emit([rel.line]); // D-4: standing changes are visible, like ticks
    }
  }
  // Narrative item pickups/losses → real gear entries (persist in state/context).
  if (plan.items?.length) {
    for (const it of plan.items.slice(0, 4)) {
      toolCalls.push("gear_change");
      const line = runtime.applyGearChange(it.name, it.action ?? "gain", it.note ?? undefined);
      if (line) emit([line]);
    }
  }
  // Scene-card proposal: situation/place/dangers overwrite, beats append.
  if (plan.scene) {
    runtime.updateScene(
      plan.scene.situation ?? undefined,
      plan.scene.beats ?? undefined,
      plan.scene.place ?? undefined,
      plan.scene.dangers ?? undefined,
    );
  }
  if (plan.worldEvent) {
    toolCalls.push("log_world_event");
    runtime.execute("log_world_event", {
      headline: plan.worldEvent.headline,
      detail: plan.worldEvent.detail,
      factionIds: plan.worldEvent.factionIds,
    });
  }
  // QUEST TRACKING: open a thread when the player takes on an objective, resolve
  // it when done (the fence-job-that-never-ended bug — a job lived only in prose
  // and never closed). Light dedup on OPEN so a re-narrated job doesn't spawn a
  // second copy of the same thread.
  if (plan.threads?.length) {
    for (const t of plan.threads.slice(0, 3)) {
      if (t.op === "open") {
        const title = t.title?.trim();
        if (!title) continue;
        const norm = title.toLowerCase();
        const dupe = runtime.state.threads.some(
          (x) => x.status !== "resolved" && (x.title.toLowerCase().includes(norm) || norm.includes(x.title.toLowerCase())),
        );
        if (dupe) continue;
        toolCalls.push("open_thread");
        runtime.execute("update_thread", { op: "create", title, body: t.body?.trim() ?? "" });
      } else if (t.op === "resolve" && t.id?.trim()) {
        toolCalls.push("resolve_thread");
        runtime.execute("update_thread", { op: "resolve", threadId: t.id.trim() });
      }
    }
  }
  for (const adv of plan.clockAdvances) {
    toolCalls.push("advance_clock");
    runtime.execute("advance_clock", adv as unknown as Record<string, unknown>);
  }
  if (plan.sceneEnd && !plan.combatStart) {
    toolCalls.push("end_scene");
    runtime.execute("end_scene", plan.sceneEnd as Record<string, unknown>);
  } else if (
    !plan.combatStart &&
    runtime.sceneCard.turnCount >= SCENE_TURN_CAP &&
    runtime.sceneEndReport === null
  ) {
    // Auto-close backstop (CONTINUITY D-1): DeepSeek under-fires sceneEnd; without
    // a boundary the summary tier never activates. Force one after the cap.
    toolCalls.push("end_scene(auto)");
    runtime.execute("end_scene", { title: "The scene moves on" });
  }

  // ── Combat begins: the engine spawns enemies and takes over next turn.
  //    (Skipped if a gun-skill reroute already started the fight this turn.) ──
  if (plan.combatStart && pc && !ctx.combat) {
    toolCalls.push("combat_start");
    const cs = plan.combatStart;
    const surprise = cs.surprise ?? "none";
    // Ship-scale stays single-group (one enemy vessel/wolfpack); personal scale can
    // field several distinct foes/groups (a boss + his heavies) via cs.enemies.
    let started;
    if (cs.scale === "ship" && preState.ship) {
      started = runtime.startShipCombat(
        [
          {
            shipClass: (cs.shipClass ?? TIER_TO_CLASS[cs.tier]) as ShipClass,
            count: cs.count ?? undefined,
            name: cs.name ?? undefined,
            tier: cs.tier,
          },
        ],
        surprise,
      );
    } else {
      // enemies[] when the model listed distinct foes; else the legacy single group.
      // Cap the TOTAL spawned at 5 (deterministic: clamp each group 1-4, then trim
      // group counts in order until the running total hits 5, dropping any overflow)
      // so a fight can't balloon regardless of what the model asks for.
      // Net-worth ceiling: clamp each GENERAL group's tier to what the player's
      // wealth/gear unlocks (a rookie faces T1, not T2). A `major` boss may exceed
      // the band as a flagged set-piece, so it's left alone.
      const ceiling = playerThreatTier(preState);
      const rawGroups: SpawnSpec[] =
        cs.enemies?.length
          ? cs.enemies.map((g) => ({
              tier: g.major ? g.tier : clampTier(g.tier, ceiling),
              count: g.count ?? undefined,
              name: g.name ?? undefined,
              major: g.major ?? undefined, // named boss → engine gives 1.8× HP
            }))
          : [{ tier: clampTier(cs.tier, ceiling), count: cs.count ?? undefined, name: cs.name ?? undefined }];
      const MAX_TOTAL = 5;
      const specs: SpawnSpec[] = [];
      let total = 0;
      for (const g of rawGroups) {
        if (total >= MAX_TOTAL) break;
        const want = Math.max(1, Math.min(4, g.count ?? 1));
        const take = Math.min(want, MAX_TOTAL - total);
        specs.push({ tier: g.tier, count: take, name: g.name, major: g.major });
        total += take;
      }
      // Count backstop: the model narrated N foes but under-filled the spawn ("two
      // wreckers, one spawned"). Top up to match the narrated count (cap 5).
      let need = Math.min(narratedFoeCount(plan.narration), MAX_TOTAL) - total;
      for (const s of specs) {
        if (need <= 0) break;
        const room = 4 - (s.count ?? 1);
        const add = Math.min(room, need);
        s.count = (s.count ?? 1) + add;
        need -= add;
      }
      if (need > 0 && specs.length) specs.push({ tier: specs[0].tier, count: need, name: specs[0].name });
      started = runtime.startCombat(specs, surprise);
    }
    ctx.combat = started.combat.active ? started.combat : null; // a surprise volley could end it instantly
    if (started.lines.length) emit(started.lines);
  }
}
