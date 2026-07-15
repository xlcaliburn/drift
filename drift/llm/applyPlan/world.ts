import { SCENE_TURN_CAP } from "@/shared/scene";
import { knownEntityNames, isPlausibleNpcName } from "@/shared/npcExtract";
import type { PlanHandler } from "./types";

/**
 * World-state bookkeeping: NPC registration, the scene card, world events, quest
 * threads, clock advances, and the scene-close boundary. These persist the turn's
 * fiction into durable state (continuity + the summary tier).
 */

/** Persist named NPCs the narrator introduced (recognized on return), mark them
 *  present, and apply relationship updates. Two gates keep the cast clean: a
 *  non-person guard, and the name must actually appear in THIS turn's prose. */
export const npcs: PlanHandler = (plan, { runtime, emit, toolCalls }) => {
  if (!plan.npcs?.length) return;
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
};

/** Scene-card proposal (situation/place/dangers overwrite, beats append) + a
 *  faction-standing world event. */
export const continuity: PlanHandler = (plan, { runtime, toolCalls }) => {
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
};

/** QUEST TRACKING: open a thread when the player takes on an objective, resolve it
 *  when done (light dedup on OPEN so a re-narrated job doesn't double up), plus any
 *  clock advances the narrator called. */
export const quests: PlanHandler = (plan, { runtime, toolCalls }) => {
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
};

/** Scene close — the model's sceneEnd, or an auto-close backstop once the scene
 *  runs past the turn cap (DeepSeek under-fires sceneEnd; without a boundary the
 *  summary tier never activates). */
export const sceneEnd: PlanHandler = (plan, { runtime, toolCalls }) => {
  if (plan.sceneEnd && !plan.combatStart) {
    toolCalls.push("end_scene");
    runtime.execute("end_scene", plan.sceneEnd as Record<string, unknown>);
  } else if (
    !plan.combatStart &&
    runtime.sceneCard.turnCount >= SCENE_TURN_CAP &&
    runtime.sceneEndReport === null
  ) {
    toolCalls.push("end_scene(auto)");
    runtime.execute("end_scene", { title: "The scene moves on" });
  }
};
