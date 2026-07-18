import type { CampaignState, Npc } from "./schemas";
import type { NpcRelations } from "./scene";
import type { Fact } from "./facts";
import type { PackStoryline, PackStoryChapter, PackStoryBeat } from "@/content/pack/types";
import { objectiveMet, type TurnSignals, type Objective } from "./quests";

/**
 * DRIFT storyline — the authored main-questline engine (STORY.md,
 * HANDOFF_STORY_1.md Task C). Pure, model-free, same shape as shared/quests.ts:
 * the ENGINE owns triggering, advancing, and beat delivery; the narrator only
 * dramatizes what this module tells it is active.
 *
 * The runtime slice stores PROGRESS POINTERS ONLY — chapter/beat/choice ids,
 * counters — never copies of pack content (trap 1). Chapter content (title,
 * objectives, beats, reward) is read LIVE from the pack every call, which is
 * exactly what makes the story hot-editable: an owner edit to
 * content/pack/drift/storyline.ts takes effect on every campaign's very next
 * turn, no migration, no backfill (trap 3 — retrofit is automatic because
 * triggers are STATE PREDICATES re-evaluated every turn, never event-edges).
 *
 * Trap 5 (ids are forever, everything else degrades): every lookup here is BY
 * ID, never by array position — an author inserting an objective/beat/chapter
 * mid-list must never shift what's already marked done/delivered. A chapter id
 * no longer in the pack is simply skipped (dropped with a log line), never
 * thrown on.
 */

export interface ChapterProgress {
  status: "active" | "complete";
  /** Objective ids completed so far, matched by id (trap 5) — never a count or
   *  an array index. */
  objectivesDone: string[];
  /** Beat ids already delivered (or fallback-delivered) to the player. */
  deliveredBeatIds: string[];
  /** The choicePoint option id picked, once chosen. */
  choiceOptionId?: string;
  openedAtTenday: number;
  /** Last tenday a nudge beat was re-surfaced (patient pacing — STORY.md). */
  lastNudgeTenday?: number;
}

export interface StorylineState {
  chapters: Record<string, ChapterProgress>;
}

export function freshStorylineState(): StorylineState {
  return { chapters: {} };
}

/** How long an active chapter can sit with no undelivered beats and no fresh
 *  objective progress before the world nudges the player back to it (same
 *  cadence class as BACKSTORY_PRESSURE_TENDAYS — patient, never a hard gate). */
export const STORY_NUDGE_TENDAYS = 3;

/** An NPC whose status marks them out of play — same predicate as
 *  llm/retrieval.ts's npcIsGone, duplicated here rather than imported so this
 *  module stays free of any llm/ dependency (shared is upstream of llm, never
 *  the reverse). */
function npcIsGone(status?: string): boolean {
  return !!status && /\b(dead|gone|killed|removed|inactive|departed|left)\b/i.test(status);
}

// ── Triggers ────────────────────────────────────────────────────────────────

function triggerMet(
  trigger: PackStoryChapter["trigger"],
  storyline: StorylineState,
  state: CampaignState,
  npcRelations: NpcRelations,
  facts: Fact[],
): boolean {
  if (trigger.requiresChapterId && storyline.chapters[trigger.requiresChapterId]?.status !== "complete") {
    return false;
  }
  if (trigger.tendaysAtLeast !== undefined && (state.campaign.tendaysElapsed ?? 0) < trigger.tendaysAtLeast) {
    return false;
  }
  if (trigger.atLocationId && state.campaign.currentLocationId !== trigger.atLocationId) {
    return false;
  }
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

export interface TriggerResult {
  storyline: StorylineState;
  openedChapterId?: string;
  lines: string[];
}

/**
 * Open at most ONE new chapter this call (patient pacing — STORY.md), and
 * only when no chapter is currently active (the shared spine is linear; a
 * branch is a flavor/fact difference, never two chapters live at once).
 * Retrofit-safe: a campaign already past a chapter's predicates the moment it
 * ships opens it on the very next evaluation — no special-casing needed.
 */
export function evaluateTriggers(
  content: PackStoryline,
  storyline: StorylineState,
  state: CampaignState,
  npcRelations: NpcRelations,
  facts: Fact[],
): TriggerResult {
  const lines: string[] = [];
  // Trap 5: an ACTIVE chapter dropped from the pack (a content edit) must
  // never wedge the slate — drop the orphaned progress so the next chapter
  // can open fresh. A COMPLETE chapter's record is left alone even if the
  // pack later drops it: ids are forever, and a future requiresChapterId
  // still needs it to resolve "complete".
  let chapters = storyline.chapters;
  for (const [id, progress] of Object.entries(chapters)) {
    if (progress.status === "active" && !content.chapters.some((c) => c.id === id)) {
      const rest = { ...chapters };
      delete rest[id];
      chapters = rest;
      lines.push(`📖 Chapter "${id}" was removed from the pack — dropped.`);
    }
  }

  const alreadyActive = Object.values(chapters).some((c) => c.status === "active");
  if (alreadyActive) return { storyline: { chapters }, lines };

  for (const chapter of content.chapters) {
    if (chapters[chapter.id]) continue; // already opened or complete
    if (!triggerMet(chapter.trigger, { chapters }, state, npcRelations, facts)) continue;
    const next: StorylineState = {
      chapters: {
        ...chapters,
        [chapter.id]: {
          status: "active",
          objectivesDone: [],
          deliveredBeatIds: [],
          openedAtTenday: state.campaign.tendaysElapsed ?? 0,
        },
      },
    };
    return { storyline: next, openedChapterId: chapter.id, lines: [...lines, `📖 New chapter: ${chapter.title}`] };
  }
  return { storyline: { chapters }, lines };
}

// ── Advancing objectives + chapter completion ────────────────────────────────

export interface StorylineProgress {
  storyline: StorylineState;
  lines: string[];
  completed: { chapter: PackStoryChapter }[];
}

/** A PackStoryObjective has every Objective field except `done` — objectiveMet
 *  never reads `done`, so a synthetic `false` satisfies the type without
 *  duplicating the completion-rule switch. */
function asObjective(o: PackStoryChapter["objectives"][number]): Objective {
  return { ...o, done: false };
}

/**
 * Advance every ACTIVE chapter by at most one objective where this turn's
 * signals satisfy its next undone objective (matched BY ID — trap 5, so an
 * author inserting an objective mid-list never shifts what's already done).
 * A chapter completes once every objective is done AND its choicePoint (if
 * any) has been picked; completions are returned for the caller to pay
 * (credits + rep) through the existing payout paths.
 */
export function advanceStoryline(content: PackStoryline, storyline: StorylineState, signals: TurnSignals): StorylineProgress {
  const lines: string[] = [];
  const completed: { chapter: PackStoryChapter }[] = [];
  const chapters = { ...storyline.chapters };

  for (const chapter of content.chapters) {
    const progress = chapters[chapter.id];
    if (!progress || progress.status !== "active") continue;

    const done = new Set(progress.objectivesDone);
    const nextObjective = chapter.objectives.find((o) => !done.has(o.id));
    let objectivesDone = progress.objectivesDone;
    if (nextObjective && objectiveMet(asObjective(nextObjective), signals)) {
      done.add(nextObjective.id);
      objectivesDone = [...done];
      const following = chapter.objectives.find((o) => !done.has(o.id));
      lines.push(`📖 ${chapter.title}: ${nextObjective.summary} ✓${following ? ` — next: ${following.summary}` : ""}`);
    }

    const allObjectivesDone = chapter.objectives.every((o) => done.has(o.id));
    const choiceSatisfied = !chapter.choicePoint || !!progress.choiceOptionId;
    if (allObjectivesDone && choiceSatisfied) {
      chapters[chapter.id] = { ...progress, status: "complete", objectivesDone };
      lines.push(`📖 Chapter complete — ${chapter.title}`);
      completed.push({ chapter });
    } else if (objectivesDone !== progress.objectivesDone) {
      chapters[chapter.id] = { ...progress, objectivesDone };
    }
  }

  return { storyline: { chapters }, lines, completed };
}

// ── Beat delivery ─────────────────────────────────────────────────────────────

export interface NextBeat {
  chapterId: string;
  beat: PackStoryBeat;
  /** The directive text to feed the narrator THIS turn — `beat.directive`
   *  normally, or `beat.fallbackDirective` when `aboutNpcId` is dead/gone
   *  (STORY.md's mortal-NPC rule) — or a short reminder when re-surfaced as a
   *  nudge after prolonged silence. */
  directive: string;
  isNudge?: boolean;
}

/**
 * The ONE beat to feed this turn for the active chapter, or null when there's
 * no active chapter or nothing left to say. Honors the mortal-NPC rule
 * (aboutNpcId dead/gone → fallbackDirective, still eligible for delivery) and
 * the patient-pacing nudge (STORY_NUDGE_TENDAYS of silence with no
 * undelivered beats re-surfaces a short reminder derived from the current
 * objective). Read-only — call markBeatDelivered after the turn actually
 * lands (trap 4: a failed turn must never burn a beat).
 */
export function nextBeat(content: PackStoryline, storyline: StorylineState, npcs: Npc[], currentTenday: number): NextBeat | null {
  const activeId = Object.keys(storyline.chapters).find((id) => storyline.chapters[id].status === "active");
  if (!activeId) return null;
  const chapter = content.chapters.find((c) => c.id === activeId);
  if (!chapter) return null; // chapter id no longer in the pack — dropped gracefully (trap 5)
  const progress = storyline.chapters[activeId];

  const delivered = new Set(progress.deliveredBeatIds);
  const undelivered = chapter.beats.find((b) => !delivered.has(b.id));
  if (undelivered) {
    const npc = undelivered.aboutNpcId ? npcs.find((n) => n.id === undelivered.aboutNpcId) : undefined;
    const dead = !!undelivered.aboutNpcId && (!npc || npcIsGone(npc.status));
    const directive = dead && undelivered.fallbackDirective ? undelivered.fallbackDirective : undelivered.directive;
    return { chapterId: activeId, beat: undelivered, directive };
  }

  // No undelivered beats left — patient-pacing nudge, at most once per
  // STORY_NUDGE_TENDAYS of silence on this chapter.
  const since = currentTenday - (progress.lastNudgeTenday ?? progress.openedAtTenday);
  if (since < STORY_NUDGE_TENDAYS) return null;
  const done = new Set(progress.objectivesDone);
  const objective = chapter.objectives.find((o) => !done.has(o.id));
  if (!objective) return null; // every objective done, just waiting on a choice/completion
  return {
    chapterId: activeId,
    beat: { id: `nudge-${objective.id}`, directive: objective.summary },
    directive: `A quiet reminder of unfinished business: ${objective.summary}`,
    isNudge: true,
  };
}

/** Commit a beat as delivered — called AFTER the turn actually lands (trap 4).
 *  A nudge (synthetic beat id, not in the pack) only advances `lastNudgeTenday`;
 *  a real pack beat is added to `deliveredBeatIds`. Idempotent. */
export function markBeatDelivered(storyline: StorylineState, delivered: NextBeat, tenday: number): StorylineState {
  const progress = storyline.chapters[delivered.chapterId];
  if (!progress) return storyline;
  if (delivered.isNudge) {
    return { chapters: { ...storyline.chapters, [delivered.chapterId]: { ...progress, lastNudgeTenday: tenday } } };
  }
  if (progress.deliveredBeatIds.includes(delivered.beat.id)) return storyline;
  return {
    chapters: {
      ...storyline.chapters,
      [delivered.chapterId]: { ...progress, deliveredBeatIds: [...progress.deliveredBeatIds, delivered.beat.id] },
    },
  };
}

// ── Choice recording ──────────────────────────────────────────────────────────

export interface ChoiceResult {
  storyline: StorylineState;
  /** The fact string to append to the ledger, or undefined if the chapter/
   *  option/choicePoint didn't resolve (unknown id — degrades gracefully). */
  fact?: string;
}

/** Record a chapter's choicePoint pick: sets `choiceOptionId` and returns the
 *  fact to append to the ledger. Idempotent — re-picking the same option is a
 *  no-op; picking a different option overwrites (last pick wins). */
export function recordChoice(content: PackStoryline, storyline: StorylineState, chapterId: string, optionId: string): ChoiceResult {
  const chapter = content.chapters.find((c) => c.id === chapterId);
  const progress = storyline.chapters[chapterId];
  const option = chapter?.choicePoint?.options.find((o) => o.id === optionId);
  if (!chapter || !progress || !option) return { storyline };
  return {
    storyline: { chapters: { ...storyline.chapters, [chapterId]: { ...progress, choiceOptionId: optionId } } },
    fact: option.fact,
  };
}
