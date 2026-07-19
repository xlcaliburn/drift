import type { PrologueStage } from "./schemas";
import type { ContentPack } from "@/content/pack/types";

/**
 * DRIFT prologue — the stage machine (STORY.md §3, HANDOFF_STORY_4.md). Pure,
 * model-free: the engine decides when a stage advances, from real signals
 * only (a completed turn, a fight resolved alive at the RIGHT scale). The
 * narrator is fed the current stage's directive (llm/promptSections/
 * prologue.ts) and dramatizes it; it never advances a stage itself.
 *
 * NOT a `pack.storyline` chapter — see HANDOFF_STORY_4.md decision 1. The
 * stage lives directly on `Campaign.prologueStage`; `undefined` means a
 * legacy campaign, handled entirely by shared/tutorial.ts's redefinition,
 * never by this module.
 */

export interface PrologueSignals {
  /** This turn resolved successfully (reached the done payload). Gates the
   *  two turn-count-only transitions (intro→groundFight,
   *  graduation→complete) — no combat requirement on either. */
  turnCompleted: boolean;
  /** A fight resolved THIS turn with the PC alive (won or escaped). */
  combatResolvedAlive: boolean;
  /** The scale of the fight that just resolved, if any — captured BEFORE
   *  the fight clears (a resolved CombatState is nulled by resolution). */
  resolvedScale?: "personal" | "ship";
}

export interface PrologueAdvance {
  stage: PrologueStage;
  /** 🎓 display lines for the transcript — empty when nothing advanced. */
  lines: string[];
  /** True ONLY on the graduation→complete transition — the caller removes
   *  the temporary ally from state this same turn. */
  allyDeparts: boolean;
}

/**
 * Advance one prologue stage from this turn's real signals. Pure — returns
 * the (possibly unchanged) next stage; never mutates. `complete` is
 * terminal: no signal ever moves it further.
 */
export function advancePrologue(stage: PrologueStage, signals: PrologueSignals): PrologueAdvance {
  switch (stage) {
    case "intro":
      if (signals.turnCompleted) {
        return { stage: "groundFight", lines: ["🎓 Time to see how you handle yourself — a fight's coming."], allyDeparts: false };
      }
      break;
    case "groundFight":
      if (signals.combatResolvedAlive && signals.resolvedScale === "personal") {
        return { stage: "shipFight", lines: ["🎓 Solid work on the ground. Now let's see you fly."], allyDeparts: false };
      }
      break;
    case "shipFight":
      if (signals.combatResolvedAlive && signals.resolvedScale === "ship") {
        return { stage: "graduation", lines: ["🎓 You've got the basics. One last thing before you're on your own."], allyDeparts: false };
      }
      break;
    case "graduation":
      if (signals.turnCompleted) {
        return { stage: "complete", lines: ["🎓 Training's over — the Drift is yours now."], allyDeparts: true };
      }
      break;
    case "complete":
      break; // terminal — no signal advances it further
  }
  return { stage, lines: [], allyDeparts: false };
}

/**
 * The current stage's directive, `{patron}`/`{ally}` filled from the pack.
 * Returns null when there's nothing to say: no faction (no ally to name),
 * an unauthored faction (shouldn't happen — validatePack enforces every
 * faction has one), or the stage is already `complete`.
 */
export function prologueDirective(pack: ContentPack, factionId: string | undefined, stage: PrologueStage): string | null {
  if (stage === "complete" || !factionId) return null;
  const ally = pack.prologue.allies[factionId];
  if (!ally) return null;
  const patron = pack.creation.patrons[factionId] ?? pack.creation.defaultPatron;
  const template = pack.prologue.stages[stage];
  return template.replace(/\{ally\}/g, ally.name).replace(/\{patron\}/g, patron.name);
}
