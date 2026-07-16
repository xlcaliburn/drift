"use client";

import type { PlayerLedger } from "@/shared/ledger";
import type { RelationStance } from "@/shared/multiplayer";
import { SheetSection } from "./ui";

/** The relationship LEDGER as a player-facing Rolodex (MULTIPLAYER.md §2) — the
 *  other players' characters this character has actually crossed paths with. Only
 *  firsthand contacts (people you've MET) are stored, so this is your real book of
 *  allies and enemies; people you've merely heard of by reputation aren't here. */

const STANCE_TONE: Record<RelationStance, string> = {
  ally: "text-good",
  owed: "text-good",
  rival: "text-amber-400",
  owes: "text-amber-400",
  enemy: "text-bad",
  neutral: "text-neutral-400",
};

const STANCE_LABEL: Record<RelationStance, string> = {
  ally: "Ally",
  rival: "Rival",
  enemy: "Enemy",
  neutral: "Acquaintance",
  owed: "Owes you",
  owes: "You owe them",
};

export function RolodexTab({ ledger }: { ledger: PlayerLedger }) {
  const contacts = Object.values(ledger)
    .filter((e) => e.knowledge === "firsthand")
    // Strongest ties first (ally/enemy over neutral), then by name.
    .sort((a, b) => Math.abs(b.warmth) - Math.abs(a.warmth) || a.subjectName.localeCompare(b.subjectName));

  return (
    <SheetSection label={`Rolodex — operators you've met (${contacts.length})`}>
      <p className="mb-2 text-[12px] leading-snug text-neutral-500">
        Other players&apos; characters your path has actually crossed in the shared world. People you&apos;ve only
        heard of by reputation aren&apos;t here — this is who you <span className="text-neutral-300">know</span>.
      </p>
      {contacts.length === 0 ? (
        <p className="text-neutral-500">
          You haven&apos;t crossed paths with another operator yet. When the story brings one into your scene, they
          land here.
        </p>
      ) : (
        <div className="space-y-2">
          {contacts.map((e) => (
            <div key={e.subjectId} className="rounded border border-edge/60 bg-ink/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-100">{e.subjectName}</span>
                <span className={"shrink-0 text-[12px] " + (STANCE_TONE[e.stance] ?? "text-neutral-400")}>
                  {STANCE_LABEL[e.stance] ?? e.stance}
                  {e.warmth ? ` (${e.warmth > 0 ? "+" : ""}${e.warmth})` : ""}
                </span>
              </div>
              {e.notes && <p className="mt-0.5 text-[12px] leading-snug text-neutral-400">{e.notes}</p>}
              {e.knownDeedIds.length > 0 && (
                <p className="mt-0.5 text-[11px] text-neutral-600">
                  You know of {e.knownDeedIds.length} of their deed{e.knownDeedIds.length > 1 ? "s" : ""}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </SheetSection>
  );
}
