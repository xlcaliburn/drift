"use client";

import type { CampaignState } from "@/shared/schemas";
import type { Fact } from "@/shared/facts";
import type { StorylineState } from "@/shared/storyline";
import { pack } from "@/content/pack";
import { SheetSection, TraitRow, sigLine, bgLabel, cap } from "./ui";

/**
 * "Season" — the main-questline progress (STORY.md, HANDOFF_STORY_1.md Task D).
 * Cross-references pack.storyline.chapters (bundled client-side, same pattern as
 * MapTab/RemakeEditor) against the SERVER-owned progress pointers — never
 * decides progression itself, only displays what the engine already tracked.
 * Hidden entirely while nothing has opened yet (true for every campaign this
 * slice: the live pack ships zero chapters).
 */
export function StorySeason({ state, storyline }: { state: CampaignState; storyline?: StorylineState }) {
  const chapterIds = storyline ? Object.keys(storyline.chapters) : [];
  if (!chapterIds.length) return null;

  const activeId = chapterIds.find((id) => storyline!.chapters[id].status === "active");
  const active = activeId ? pack.storyline.chapters.find((c) => c.id === activeId) : undefined;
  const activeProgress = activeId ? storyline!.chapters[activeId] : undefined;
  const completedTitles = chapterIds
    .filter((id) => storyline!.chapters[id].status === "complete")
    .map((id) => pack.storyline.chapters.find((c) => c.id === id)?.title ?? id);

  return (
    <SheetSection label="Season">
      {active && activeProgress && (
        <div className="space-y-1.5">
          <div className="text-neutral-200">
            Act {active.act} — <span className="font-semibold">{active.title}</span>
          </div>
          <div className="space-y-0.5">
            {active.objectives.map((o) => (
              <div key={o.id} className="flex items-start gap-1.5 text-[12px]">
                <span className={activeProgress.objectivesDone.includes(o.id) ? "text-good" : "text-neutral-600"}>
                  {activeProgress.objectivesDone.includes(o.id) ? "✓" : "○"}
                </span>
                <span
                  className={
                    activeProgress.objectivesDone.includes(o.id)
                      ? "text-neutral-500 line-through decoration-neutral-700"
                      : "text-neutral-300"
                  }
                >
                  {o.summary}
                </span>
              </div>
            ))}
          </div>
          {active.choicePoint && (
            <p className="text-[12px] text-neutral-500">
              {activeProgress.choiceOptionId
                ? `Chose: ${active.choicePoint.options.find((o) => o.id === activeProgress.choiceOptionId)?.label ?? activeProgress.choiceOptionId}`
                : "A choice awaits."}
            </p>
          )}
        </div>
      )}
      {completedTitles.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {completedTitles.map((title, i) => (
            <div key={i} className="text-[12px] text-neutral-500 line-through decoration-neutral-700">
              {title}
            </div>
          ))}
        </div>
      )}
    </SheetSection>
  );
}

/** Story tab — traits, signature, moral line, voice, backstory. */
export function StoryDetail({ character: c }: { character: CampaignState["characters"][number] }) {
  return (
    <>
      {(c.background || c.bias || c.alignment || c.ambition) && (
          <SheetSection label="Traits">
            <div className="space-y-0.5">
              <TraitRow
                k="Background"
                v={bgLabel(c.background)}
                tip="Who you were before drifting. Chosen at creation, it set your starting gear and trained skills and seeded your backstory."
              />
              <TraitRow
                k="Focus"
                v={c.bias ? cap(c.bias) : undefined}
                tip="Your specialization lean. At creation it decided which skills you began trained in — your early edge."
              />
              <TraitRow
                k="Code"
                v={c.alignment ? cap(c.alignment) : undefined}
                tip="Your moral lean. It shaped the line you won't cross, which the narrator is reminded of every turn and holds you to."
              />
              <TraitRow
                k="Ambition"
                v={c.ambition ? cap(c.ambition) : undefined}
                tip="What you're ultimately chasing. It seeded your backstory and the personal stakes the story can pull on."
              />
            </div>
          </SheetSection>
        )}
        {c.uniqueSkill && (
          <SheetSection label="Signature">
            <p className="text-neutral-200">
              <span className="font-semibold">{c.uniqueSkill.name}</span>
              <span className="text-accent/80"> · {sigLine(c.uniqueSkill)}</span>
            </p>
            {c.uniqueSkill.description && <p className="mt-0.5 text-neutral-400">{c.uniqueSkill.description}</p>}
          </SheetSection>
        )}
        {c.appearance && (
          <SheetSection label="Appearance">
            <p className="leading-relaxed text-neutral-300">{c.appearance}</p>
          </SheetSection>
        )}
        {c.moralCode && (
          <SheetSection label="The line won't cross">
            <p className="text-neutral-200">{c.moralCode}</p>
          </SheetSection>
        )}
        {c.voiceNotes && (
          <SheetSection label="Voice">
            <p className="italic text-neutral-400">{c.voiceNotes}</p>
          </SheetSection>
        )}
        {c.backstory && (
          <SheetSection label="Backstory">
            <p className="whitespace-pre-wrap leading-relaxed text-neutral-300">{c.backstory}</p>
          </SheetSection>
        )}
    </>
  );
}

/** The live thread log inside the Story tab — open quests (updated as scenes
 *  change) and a struck-through record of what's been resolved, so the Story tab
 *  visibly evolves as the campaign moves. */
export function StoryThreads({ state }: { state: CampaignState }) {
  const active = state.threads.filter((t) => t.status === "active");
  const resolved = state.threads.filter((t) => t.status === "resolved");
  return (
    <>
      <SheetSection label="Open threads">
        {active.length === 0 ? (
          <p className="text-neutral-500">Nothing hanging over you right now.</p>
        ) : (
          <div className="space-y-1.5">
            {active.map((t) => (
              <div key={t.id}>
                <div className="text-neutral-200">{t.title}</div>
                {t.body && <p className="text-[12px] leading-snug text-neutral-500">{t.body}</p>}
              </div>
            ))}
          </div>
        )}
      </SheetSection>
      {resolved.length > 0 && (
        <SheetSection label="Resolved">
          <div className="space-y-1">
            {resolved.map((t) => (
              <div key={t.id} className="text-[12px] text-neutral-500 line-through decoration-neutral-700">
                {t.title}
              </div>
            ))}
          </div>
        </SheetSection>
      )}
    </>
  );
}

/** "The game remembers" — the durable facts ledger (CONTINUITY.md v2), player-
 *  visible. Players are the best inconsistency detectors (three appeals found the
 *  Ren tangle before any tooling); this surfaces the memory the narrator is held
 *  to and gives a one-tap way to flag one that's wrong. Pinned (load-bearing —
 *  deal terms, debts, kinship) facts show first with a 📌. Read-only: flagging
 *  posts to the existing feedback queue, never a direct write. */
export function FactsMemory({ facts, onFlag }: { facts: Fact[]; onFlag?: (text: string) => void }) {
  if (!facts.length) return null;
  const ordered = [...facts].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  return (
    <SheetSection label="The game remembers">
      <div className="space-y-1.5">
        {ordered.map((f, i) => (
          <div key={i} className="flex items-start justify-between gap-2">
            <p className="text-neutral-300">
              {f.pinned && <span title="Load-bearing — won't be forgotten">📌 </span>}
              {f.text}
              {f.tenday != null && <span className="text-neutral-600"> (tenday {f.tenday})</span>}
            </p>
            {onFlag && (
              <button
                onClick={() => onFlag(f.text)}
                className="shrink-0 text-[11px] text-neutral-600 hover:text-bad"
                title="Flag this as wrong"
              >
                flag
              </button>
            )}
          </div>
        ))}
      </div>
    </SheetSection>
  );
}
