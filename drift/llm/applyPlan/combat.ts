import type { SpawnSpec, ShipClass } from "@/engine/combatEngine";
import { playerThreatTier, clampTier } from "@/shared/netWorth";
import { matchCastCasualty } from "@/shared/npcFate";
import type { CombatTier } from "@/shared/combat";
import type { CampaignState } from "@/shared/schemas";
import { TIER_TO_CLASS } from "../openFight";
import type { PlanHandler } from "./types";

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

/**
 * Which tier a combat group should actually spawn at (CHECKS.md §2 — combat-tier
 * stamp): a group named after a KNOWN cast NPC with an already-pinned tier uses
 * THAT tier — stored canon beats both the model's pick and the net-worth clamp,
 * the same exemption `major` already gets (an established person is who they
 * are; the clamp exists for generic spawns). Otherwise, the existing model-tier
 * + clamp behavior is unchanged.
 */
function resolveGroupTier(
  name: string | null | undefined,
  modelTier: CombatTier,
  major: boolean | null | undefined,
  ceiling: CombatTier,
  preState: CampaignState,
): CombatTier {
  const cast = name ? matchCastCasualty(name, preState) : undefined;
  if (cast?.tier) return cast.tier;
  return major ? modelTier : clampTier(modelTier, ceiling);
}

/**
 * Combat begins: the engine spawns enemies and takes over next turn. Skipped when
 * a gun-skill reroute already started a fight this turn (ctx.combat set). Reads the
 * PRE-turn state for the net-worth ceiling and the narration for the count backstop.
 */
export const combatStart: PlanHandler = (plan, ctx) => {
  const { runtime, pc, emit, toolCalls, preState } = ctx;
  if (!plan.combatStart || !pc || ctx.combat) return;
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
            tier: resolveGroupTier(g.name, g.tier, g.major, ceiling, preState),
            count: g.count ?? undefined,
            name: g.name ?? undefined,
            major: g.major ?? undefined, // named boss → engine gives 1.8× HP
          }))
        : [{ tier: resolveGroupTier(cs.name, cs.tier, undefined, ceiling, preState), count: cs.count ?? undefined, name: cs.name ?? undefined }];
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
    // TIER STAMP: pin whichever tier a named cast member actually spawned/fought
    // at — set-once (runtime.setNpcTier no-ops if already pinned), so a canon
    // match from resolveGroupTier above just re-confirms itself here, and an
    // un-tiered match gets locked in from here on.
    for (const s of specs) {
      if (!s.name) continue;
      const cast = matchCastCasualty(s.name, preState);
      if (cast) runtime.setNpcTier(cast.id, s.tier);
    }
  }
  ctx.combat = started.combat.active ? started.combat : null; // a surprise volley could end it instantly
  if (started.lines.length) emit(started.lines);
};
