import type { CampaignState } from "./schemas";

/**
 * Tutorial ("training wheels") gating. A brand-new player is eased in: for their
 * first few quests the narrator frames each beat as a single yes/no decision and
 * the engine clamps every offer_choices to exactly two options, so onboarding is
 * never a branching menu. Once they've resolved enough quests, full branching
 * resumes and a one-time "the training wheels are off" beat marks the shift.
 *
 * The window is tracked purely from existing data — the count of resolved story
 * threads — so there is NO schema change and no persisted "tutorial done" flag.
 * Because that count only ever rises, the crossing point is inherently one-time.
 */

/** Resolved quests it takes to leave the tutorial. */
export const TUTORIAL_QUEST_TARGET = 3;

/** Choices allowed per beat while in the tutorial (kept small for onboarding). */
export const TUTORIAL_CHOICE_COUNT = 3;

/** Resolved "quests" = story threads the narrator has marked resolved. */
export function resolvedQuestCount(state: CampaignState): number {
  return state.threads.filter((t) => t.status === "resolved").length;
}

/**
 * In the tutorial while fewer than TUTORIAL_QUEST_TARGET quests are resolved
 * — UNLESS this campaign runs the authored prologue (HANDOFF_STORY_4.md
 * decision 3), in which case its `prologueStage` is the sole source of truth:
 * "in tutorial" until the stage reaches `complete`. `prologueStage` is
 * undefined on every campaign created before this slice, so this preserves
 * EXACT existing behavior for every live campaign — zero backfill.
 */
export function inTutorial(state: CampaignState): boolean {
  const stage = state.campaign?.prologueStage;
  if (stage !== undefined) return stage !== "complete";
  return resolvedQuestCount(state) < TUTORIAL_QUEST_TARGET;
}

/**
 * True on exactly the turn the tutorial ends. For a legacy (non-staged)
 * campaign: the resolved-quest count first reaches the target (monotonic, so
 * `before < target <= after` holds on one turn only — a one-time signal with
 * no stored flag). For a staged campaign (HANDOFF_STORY_4.md): the prologue
 * stage's graduation→complete transition, which is decided by
 * `shared/prologue.ts`'s `advancePrologue` — this function only detects it
 * here so every existing consumer (death.ts's tutorial-safe death saves, the
 * TUTORIAL directives, the choice clamp) keeps working unedited. In practice
 * this always reads false for a staged campaign at THIS call site: nothing
 * mutates `prologueStage` between a turn's `before`/`after` engine-bridge
 * snapshots, since route.ts applies the stage transition afterward and
 * prints the prologue's own 🎓 lines instead of `TUTORIAL_GRADUATION_BEAT` —
 * which is exactly the point: a staged campaign never fires the OLD beat.
 * `before` is the pre-turn state, `after` the state after this turn's tool
 * calls have been applied.
 */
export function graduatedTutorialThisTurn(before: CampaignState, after: CampaignState): boolean {
  const stageBefore = before.campaign?.prologueStage;
  if (stageBefore !== undefined) {
    return stageBefore !== "complete" && after.campaign?.prologueStage === "complete";
  }
  return (
    resolvedQuestCount(before) < TUTORIAL_QUEST_TARGET &&
    resolvedQuestCount(after) >= TUTORIAL_QUEST_TARGET
  );
}

/**
 * Per-turn narrator directive injected while in the tutorial: keep the beat a
 * single legible decision and make offer_choices a binary yes/no. The engine
 * clamps to two regardless (see engineBridge.offerChoices), so this just keeps
 * the prose and the two options coherent.
 */
export const TUTORIAL_CHOICE_DIRECTIVE =
  `TUTORIAL — the player is still learning the ropes (their first ${TUTORIAL_QUEST_TARGET} quests). ` +
  `Frame this beat around ONE clear decision. When you call offer_choices, give EXACTLY ` +
  `${TUTORIAL_CHOICE_COUNT} options and make them a yes/no or go/no-go on a single course of ` +
  `action (e.g. "Take the job" / "Walk away") — no negotiation, no branching menus, no more ` +
  `than ${TUTORIAL_CHOICE_COUNT}. The engine will clamp to ${TUTORIAL_CHOICE_COUNT} regardless.`;

/** JSON-turn variant of the tutorial directive (no tool vocabulary). */
export const TUTORIAL_JSON_DIRECTIVE =
  `TUTORIAL — first ${TUTORIAL_QUEST_TARGET} quests: frame this beat around ONE clear decision. ` +
  `"choices" must contain EXACTLY ${TUTORIAL_CHOICE_COUNT} options, a yes/no or go/no-go on a ` +
  `single course of action. The engine clamps to ${TUTORIAL_CHOICE_COUNT} regardless.`;

/**
 * One-time transition beat shown when the tutorial ends. Styled like the other
 * system transition lines in the transcript (em-dashes, lowercase, middot).
 * Shared by the turn route (persisted to the transcript) and PlayClient (shown
 * live) so a live turn and a later refresh render the identical line.
 */
export const TUTORIAL_GRADUATION_BEAT =
  "— the training wheels are off · the galaxy stops holding your hand, and your choices open up —";
