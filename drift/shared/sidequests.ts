import type { CampaignState } from "./schemas";
import type { NpcRelations } from "./scene";
import type { Fact } from "./facts";
import type { PackSidequest, PackSidequestTrigger, PackStoryChapter } from "@/content/pack/types";
import type { StorylineState } from "./storyline";
import type { Job } from "./quests";

/**
 * DRIFT sidequests — authored, PLACED quests (STORY.md §2, HANDOFF_STORY_2.md
 * Task C). A THIN WRAPPER on the existing Job machinery: a sidequest becomes a
 * real, offered Job the moment its trigger holds and it hasn't already been
 * taken — from there it IS a job (accept/abandon chips, cargo, cast
 * materialization, advanceJobs, payout, all untouched). Pure: no DB, no RNG.
 *
 * One-shot is FREE (trap 3) — `refreshBoard` (shared/quests.ts) only ever
 * prunes OFFERED jobs, so a completed/failed `sq-<id>` job persists in the
 * jobs slice forever; that persisted record IS the one-shot guard. An
 * offered-but-expired-or-walked-away-from copy drops out of the array
 * naturally, so it's correctly re-injectable on a later visit — one-shot
 * scopes to taken-and-resolved, never to merely-offered.
 */

function triggerMet(
  trigger: PackSidequestTrigger | undefined,
  act: number,
  state: CampaignState,
  npcRelations: NpcRelations,
  facts: Fact[],
): boolean {
  if (!trigger) return true;
  if (trigger.actAtLeast !== undefined && act < trigger.actAtLeast) return false;
  if (trigger.factionRepAtLeast) {
    const rep =
      state.factionRep.find(
        (r) => r.factionId === trigger.factionRepAtLeast!.factionId && r.campaignId === state.campaign.id,
      )?.rep ?? 0;
    if (rep < trigger.factionRepAtLeast.rep) return false;
  }
  if (trigger.npcTrustAtLeast) {
    const disposition = npcRelations[trigger.npcTrustAtLeast.npcId]?.disposition ?? 0;
    if (disposition < trigger.npcTrustAtLeast.disposition) return false;
  }
  if (trigger.hasFact) {
    const needle = trigger.hasFact.toLowerCase();
    if (!facts.some((f) => f.text.toLowerCase().includes(needle))) return false;
  }
  return true;
}

/** How far the season has progressed — the highest act among chapters that
 *  are active OR complete, 0 when the storyline is dormant (no chapters
 *  opened yet, true for every campaign until 3b ships content). */
export function currentAct(storyline: StorylineState, chapters: PackStoryChapter[]): number {
  let act = 0;
  for (const [id, progress] of Object.entries(storyline.chapters)) {
    if (progress.status !== "active" && progress.status !== "complete") continue;
    const chapter = chapters.find((c) => c.id === id);
    if (chapter && chapter.act > act) act = chapter.act;
  }
  return act;
}

/** Materialize an authored sidequest into a real offered Job. `giverName`/
 *  `giverRole` come from the ALREADY-REAL pack cast NPC (never generated) —
 *  the cast entry carries their real npc id, so `materializeJobCast`'s
 *  existing-id check adopts them as-is on accept (no duplicate record). */
export function sidequestJob(sq: PackSidequest, giverName: string, giverRole: string | undefined, tenday: number): Job {
  return {
    id: `sq-${sq.id}`,
    title: sq.title,
    blurb: sq.blurb,
    giver: sq.giverNpcId,
    factionId: sq.factionId,
    playstyle: "authored",
    archetype: "authored",
    tier: sq.tier,
    complication: sq.complication,
    ...(sq.cargo ? { cargo: sq.cargo } : {}),
    postedLocationId: sq.postedLocationId,
    objectives: sq.objectives.map((o) => ({ ...o, done: false })),
    cast: [{ role: "giver" as const, npcId: sq.giverNpcId, name: giverName, roleLabel: giverRole ?? "contact" }],
    reward: {
      tier: sq.tier,
      ...(sq.reward.repFactionId && sq.reward.repDelta !== undefined
        ? { repFactionId: sq.reward.repFactionId, repDelta: sq.reward.repDelta }
        : {}),
    },
    status: "offered",
    createdTenday: tenday,
    expiresTenday: tenday + 3,
  };
}

/**
 * Add any pack sidequests that qualify to the board — placed HERE, trigger
 * holding, and not already present under their `sq-<id>` job id in ANY status
 * (trap 3, the one-shot guard). Pure; `content` is an explicit param (not the
 * live singleton) so this is testable against a stub without touching the
 * live pack (mirrors shared/storyline.ts's `evaluateTriggers(content, ...)`).
 */
export function injectSidequests(
  content: { sidequests: PackSidequest[]; storyline: { chapters: PackStoryChapter[] } },
  jobs: Job[],
  state: CampaignState,
  storyline: StorylineState,
  npcRelations: NpcRelations,
  facts: Fact[],
  tenday: number,
): Job[] {
  const here = state.campaign.currentLocationId;
  const act = currentAct(storyline, content.storyline.chapters);
  const existingIds = new Set(jobs.map((j) => j.id));
  const additions: Job[] = [];
  for (const sq of content.sidequests) {
    if (sq.postedLocationId !== here) continue;
    const jobId = `sq-${sq.id}`;
    if (existingIds.has(jobId)) continue;
    if (!triggerMet(sq.trigger, act, state, npcRelations, facts)) continue;
    const giver = state.npcs.find((n) => n.id === sq.giverNpcId);
    additions.push(sidequestJob(sq, giver?.name ?? sq.giverNpcId, giver?.role, tenday));
  }
  return additions.length ? [...jobs, ...additions] : jobs;
}
