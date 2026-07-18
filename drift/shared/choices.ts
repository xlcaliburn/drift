import type { CampaignState } from "./schemas";
import type { ChoiceOption } from "./turnPlan";
import type { SceneCard, NpcRelations } from "./scene";
import type { Job } from "./quests";
import type { StorylineState } from "./storyline";
import { itemCount, marketChips } from "./items";
import { repairQuote } from "@/engine/market";
import { patronHelp } from "./netWorth";
import { recruitOffer } from "./crew";
import { personalJobAvailable } from "./scene";

/**
 * Re-validate a persisted `lastChoices` list against LIVE state before it's ever
 * shown again — the fix for "the chips on a refresh are outdated". Every ENGINE
 * chip (`pre*`-routed: useItem/repairHull/patronRest/recruitNpc/swap/job/personal-
 * job) is a CONTRACT that only holds while its precondition does; `lastChoices` is
 * a frozen snapshot from whenever the last turn ran, persisted verbatim and served
 * as-is on every page load with zero revalidation. Between then and a refresh,
 * background work (the scene analyst) or simply time (a tenday passing, an item
 * spent some other way) can invalidate a chip's premise — clicking a stale one
 * either errors or silently no-ops, which reads as a broken game.
 *
 * Pure and cheap (no RNG, no mutation) — safe to run on every GET. Narrative
 * choices (verb/check/label only) and live-combat chips (combatAction/downedAction)
 * are left untouched: combat/downed state generates its OWN chip set fresh every
 * round from the live CombatState, never through this path.
 */
export function revalidateChoices(
  choices: ChoiceOption[],
  ctx: {
    state: CampaignState;
    sceneCard: SceneCard | null;
    npcRelations: NpcRelations;
    jobs: Job[];
    /** The main-questline progress (HANDOFF_STORY_1.md) — gates a persisted
     *  storyChoice chip. Optional: callers without it keep the chip (fail-open,
     *  same as before the field existed; recordChoice is first-pick-wins anyway). */
    storyline?: StorylineState;
  },
): ChoiceOption[] {
  const pc = ctx.state.characters.find((c) => c.kind === "pc");
  const presentNpcIds = ctx.sceneCard?.presentNpcIds ?? [];

  return choices.filter((c) => {
    if (c.useItemId) return !!pc && itemCount(pc, c.useItemId) > 0;
    // A market Buy chip holds only while THIS station still shelves the item at a
    // price the player can pay (they may have moved on or spent down since).
    if (c.buyItem) return marketChips(ctx.state).some((m) => m.buyItem === c.buyItem);
    if (c.repairHull) return !!repairQuote(ctx.state);
    if (c.patronRest) return patronHelp(ctx.state, presentNpcIds).eligible;
    if (c.recruitNpc) {
      const offer = recruitOffer(ctx.state, ctx.npcRelations, presentNpcIds);
      return offer?.npcId === c.recruitNpc;
    }
    if (c.acceptPersonalJob) return personalJobAvailable(ctx.npcRelations[c.acceptPersonalJob]);
    if (c.acceptJob) return ctx.jobs.some((j) => j.id === c.acceptJob && j.status === "offered");
    if (c.abandonJob) return ctx.jobs.some((j) => j.id === c.abandonJob && j.status === "active");
    if (c.swapDrop || c.swapDecline) return !!ctx.sceneCard?.pendingPickup;
    // A story choice holds only while its chapter is still ACTIVE and UNPICKED —
    // a stale chip after a refresh race (picked in another tab, chapter since
    // completed) must never re-offer a decided, can't-be-undone choice.
    if (c.storyChoice) {
      if (!ctx.storyline) return true; // no slice provided — fail open (engine still refuses re-picks)
      const progress = ctx.storyline.chapters[c.storyChoice.chapterId];
      return !!progress && progress.status === "active" && !progress.choiceOptionId;
    }
    return true; // narrative / combat / downed / confirmDeath — untouched
  });
}
