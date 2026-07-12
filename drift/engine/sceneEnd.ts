import type { CampaignState } from "@/shared/schemas";
import type { EngineEvent } from "./events";
import { awardTick } from "./progression";
import { advanceClock, timeTrigger } from "./clocks";
import { applySceneCosts } from "./economy";

export interface SceneEndInput {
  /** Was this a paying job (triggers crew wages)? */
  paying?: boolean;
  /** Number of dockings this scene (each -¢15). */
  dockings?: number;
  /** Location the party arrived at this scene, if any. */
  arrivedAtLocationId?: string;
  /** Tick-eligible rolls captured during the scene. Deduped per character+skill. */
  tickedRolls?: { characterId: string; skill: string }[];
  /** Explicit clock advances the narrator requested via advance_clock. */
  clockAdvances?: { clockId: string; amount?: number; reason?: string }[];
  /** Missiles fired this scene (reduces ship ammo now; re-buy costs later). */
  missilesFired?: number;
  /** Did a combat conclude? Resets shield capacitor + burst drive. */
  combatEnded?: boolean;
  /** Tendays that elapsed this scene (for time-based systems/clocks). */
  tendaysDelta?: number;
}

export interface SceneEndReport {
  state: CampaignState;
  events: EngineEvent[];
  checklist: {
    ticksAwarded: string[];
    costsApplied: string[];
    clocksAdvanced: string[];
    arrivalBeatOwed: boolean;
    summaryNeeded: boolean;
  };
}

/** Run the end-of-scene DM checklist as an ordered, deterministic pipeline. */
export function runSceneEnd(
  state: CampaignState,
  input: SceneEndInput,
): SceneEndReport {
  const events: EngineEvent[] = [];
  const ticksAwarded: string[] = [];
  const costsApplied: string[] = [];
  const clocksAdvanced: string[] = [];

  let characters = state.characters.map((c) => ({ ...c }));
  let ship = state.ship ? { ...state.ship } : undefined;
  let clocks = state.clocks.map((c) => ({ ...c }));
  let campaign = { ...state.campaign };

  // --- Step 2: ticks (deduped per character+skill) ---
  const tickedByChar = new Map<string, Set<string>>();
  for (const roll of input.tickedRolls ?? []) {
    let set = tickedByChar.get(roll.characterId);
    if (!set) {
      set = new Set<string>();
      tickedByChar.set(roll.characterId, set);
    }
    const idx = characters.findIndex((c) => c.id === roll.characterId);
    if (idx === -1) continue;
    const res = awardTick(characters[idx], roll.skill, set);
    characters[idx] = res.character;
    if (res.ticked) {
      ticksAwarded.push(res.event.breakdown);
      events.push(res.event);
    }
  }

  // --- Step 3: costs ---
  const crewWithWages = characters.filter(
    (c) => c.kind === "party" && c.loyalty !== undefined,
  ).length;
  const cost = applySceneCosts({
    paying: input.paying ?? false,
    crewWithWages,
    dockings: input.dockings ?? 0,
  });
  if (cost.creditsDelta !== 0) {
    const pcIdx = characters.findIndex((c) => c.kind === "pc");
    if (pcIdx !== -1) {
      const pc = characters[pcIdx];
      characters[pcIdx] = {
        ...pc,
        credits: (pc.credits ?? 0) + cost.creditsDelta,
      };
    }
    events.push(...cost.events);
    costsApplied.push(...cost.events.map((e) => e.breakdown));
  }

  // Ammo: reduce missiles fired now (re-buy is a separate purchase).
  if (ship && input.missilesFired && input.missilesFired > 0) {
    const pod = ship.weapons.find((w) => w.type === "missile");
    if (pod && pod.ammo !== undefined) {
      const before = pod.ammo;
      const after = Math.max(0, pod.ammo - input.missilesFired);
      ship = {
        ...ship,
        weapons: ship.weapons.map((w) =>
          w.type === "missile" ? { ...w, ammo: after } : w,
        ),
      };
      const line = `Missiles fired: ${before}→${after} (re-buy ¢51 ea)`;
      costsApplied.push(line);
      events.push({ type: "resource", breakdown: line, field: "missiles", delta: after - before });
    }
  }

  // Combat lifecycle: shield + burst drive recharge after a fight.
  if (ship && input.combatEnded) {
    ship = { ...ship, shieldReady: true, burstDriveReady: true };
    events.push({ type: "note", breakdown: "Shield capacitor + burst drive recharged after combat." });
  }

  // --- Step 4: clocks ---
  for (const adv of input.clockAdvances ?? []) {
    const idx = clocks.findIndex((c) => c.id === adv.clockId);
    if (idx === -1) continue;
    const res = advanceClock(clocks[idx], adv.amount ?? 1, adv.reason ?? "");
    clocks[idx] = res.clock;
    clocksAdvanced.push(res.event.breakdown);
    events.push(res.event);
  }

  // --- Step 5: arrival ---
  let arrivalBeatOwed = false;
  if (
    input.arrivedAtLocationId &&
    input.arrivedAtLocationId !== campaign.currentLocationId
  ) {
    campaign = { ...campaign, currentLocationId: input.arrivedAtLocationId };
    arrivalBeatOwed = true;
    events.push({
      type: "note",
      breakdown: "Arrival beat owed: party reached a new location this scene.",
    });
  }

  if (input.tendaysDelta && input.tendaysDelta > 0) {
    campaign = {
      ...campaign,
      tendaysElapsed: campaign.tendaysElapsed + input.tendaysDelta,
    };

    // The Fault Line season clock is time-driven ONLY: +1 per in-world day
    // elapsed, firing any milestone it crosses. Predetermined pressure, identical
    // for every campaign — deliberately not affected by player action.
    const fIdx = clocks.findIndex(
      (c) => c.id === "clk-faultline" && c.status === "active",
    );
    if (fIdx !== -1) {
      const res = timeTrigger(clocks[fIdx], input.tendaysDelta, 1);
      if (res) {
        clocks[fIdx] = res.clock;
        clocksAdvanced.push(res.event.breakdown);
        events.push(res.event);
      }
    }
  }

  const newState: CampaignState = {
    ...state,
    characters,
    ship,
    clocks,
    campaign,
  };

  return {
    state: newState,
    events,
    checklist: {
      ticksAwarded,
      costsApplied,
      clocksAdvanced,
      arrivalBeatOwed,
      summaryNeeded: true,
    },
  };
}

/** Deep snapshot of campaign state for the rewind feature. */
export function snapshot(state: CampaignState): CampaignState {
  return JSON.parse(JSON.stringify(state));
}
