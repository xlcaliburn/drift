"use client";

import type { CampaignState } from "@/shared/schemas";
import { SheetSection } from "./ui";

/** Factions tab — only the powers the player has actually crossed paths with:
 *  their own (parent/founded) faction, anyone they hold a reputation with, and any
 *  faction named in an active/resolved thread. Shows the standing as a signed,
 *  colour-coded number so allegiances read at a glance. */
export function FactionsDetail({
  state,
  character,
}: {
  state: CampaignState;
  character: CampaignState["characters"][number];
}) {
  const repById = new Map(state.factionRep.map((r) => [r.factionId, r]));

  // Derive the "seen" set from three signals.
  const seen = new Set<string>();
  // 1. The PC's own allegiance(s) — the faction they started in / founded.
  if (character.parentFactionId) seen.add(character.parentFactionId);
  if (character.ownFactionId) seen.add(character.ownFactionId);
  // 2. Any faction the player carries a standing with (own faction seeds a
  //    starting `standing`; play moves `rep` off its neutral default).
  for (const r of state.factionRep) {
    if (r.standing !== undefined || r.rep !== 0) seen.add(r.factionId);
  }
  // 3. Any faction referenced by the player's threads.
  const factionIds = new Set(state.factions.map((f) => f.id));
  for (const t of state.threads) {
    for (const ref of t.entityRefs) if (factionIds.has(ref)) seen.add(ref);
  }

  const factions = state.factions.filter((f) => seen.has(f.id));

  return (
    <SheetSection label="Factions you've encountered">
      {factions.length === 0 ? (
        <p className="text-neutral-500">You haven&apos;t crossed paths with any factions yet.</p>
      ) : (
        <div className="space-y-2">
          {factions.map((f) => {
            const r = repById.get(f.id);
            const rep = r?.rep ?? f.defaultRep ?? 0;
            const tone = rep > 0 ? "text-good" : rep < 0 ? "text-bad" : "text-neutral-500";
            return (
              <div key={f.id} className="rounded border border-edge/60 bg-ink/40 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-neutral-100">{f.name}</span>
                  <span className={"shrink-0 tabular-nums text-[12px] " + tone}>
                    {rep >= 0 ? `+${rep}` : rep}
                    {r?.standing ? <span className="text-neutral-500"> · {r.standing}</span> : null}
                  </span>
                </div>
                {f.description && (
                  <p className="mt-0.5 text-[12px] leading-snug text-neutral-400">{f.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SheetSection>
  );
}
