import type { CampaignState } from "@/shared/schemas";
import type { EngineEvent } from "./events";
import { timeTrigger } from "./clocks";
import { economy } from "@/content";

/**
 * ENGINE-OWNED in-world time (the tenday clock). Every live campaign sat at
 * tendaysElapsed 0 — even 400-turn ones — because time only moved via the model's
 * sceneEnd.tendaysDelta, a field the prompt never even mentioned. That froze
 * everything time keyed off: market stock never rotated, job offers never expired,
 * and per-tenday crew upkeep (CREW.md) would never charge.
 *
 * Deterministic policy (never model-dependent; rates in content/economy.json):
 *  - TRAVEL between stations → +`travelTendays` (a hop through the black takes days).
 *  - Every `scenesPerTenday`-th scene close WITHOUT a move → +1 (life passes even
 *    for a station-squatter; stateless off the scene counter).
 * The model's sceneEnd.tendaysDelta remains an ADDITIVE story path ("three tendays
 * in transit"), on top of this floor.
 */

/** Tendays that pass when a scene closes. `sceneSeq` is the CLOSED scene's number. */
export function tendaysForSceneClose(opts: { moved: boolean; sceneSeq: number }): number {
  const c = economy.constants as { travelTendays?: number; scenesPerTenday?: number };
  if (opts.moved) return c.travelTendays ?? 1;
  const per = c.scenesPerTenday ?? 4;
  return per > 0 && opts.sceneSeq > 0 && opts.sceneSeq % per === 0 ? 1 : 0;
}

/**
 * Advance the campaign clock by `delta` tendays: bumps `tendaysElapsed` and fires
 * the time-driven Fault Line season clock (identical pressure for every campaign).
 * Shared by the deterministic scene-close path AND the model's sceneEnd delta so
 * the season clock can never be skipped. Pure — returns the new state + events.
 */
export function advanceTendays(
  state: CampaignState,
  delta: number,
): { state: CampaignState; events: EngineEvent[]; lines: string[] } {
  if (!delta || delta <= 0) return { state, events: [], lines: [] };
  const events: EngineEvent[] = [];
  const lines: string[] = [];
  let clocks = state.clocks;
  const tendaysElapsed = (state.campaign.tendaysElapsed ?? 0) + delta;

  const fIdx = clocks.findIndex((c) => c.id === "clk-faultline" && c.status === "active");
  if (fIdx !== -1) {
    const res = timeTrigger(clocks[fIdx], delta, 1);
    if (res) {
      clocks = clocks.map((c, i) => (i === fIdx ? res.clock : c));
      events.push(res.event);
      lines.push(`⏱ ${res.event.breakdown}`);
    }
  }

  events.push({
    type: "note",
    breakdown: `Time passes: +${delta} tenday${delta > 1 ? "s" : ""} (now tenday ${tendaysElapsed}).`,
  });
  lines.push(`🕐 ${delta > 1 ? `${delta} tendays pass` : "A tenday passes"} — tenday ${tendaysElapsed}.`);

  return {
    state: { ...state, campaign: { ...state.campaign, tendaysElapsed }, clocks },
    events,
    lines,
  };
}
