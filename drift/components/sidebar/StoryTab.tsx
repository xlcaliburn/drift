"use client";

import type { CampaignState } from "@/shared/schemas";
import { SheetSection, TraitRow, sigLine, bgLabel, cap } from "./ui";

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
