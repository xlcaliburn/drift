"use client";

import { useState } from "react";
import type { CampaignState } from "@/shared/schemas";
import { dispositionLabel, type NpcRelation, type NpcRelations, type SceneCard } from "@/shared/scene";
import { generateQuirk } from "@/shared/npcFlavor";

/** Backend fields another surface may add to NPCs/relations before the shared
 *  types catch up — read defensively so the dossier works with or without them. */
type MaybeRole = { role?: string };
type MaybeNameKnown = { nameKnown?: boolean };

/** Title-case a free-text role ("dock foreman" → "Dock Foreman"). */
const titleCase = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());

/** True when an "NPC" is really a faction leaking into the cast — its name equals,
 *  or is contained by, a faction name. Keeps the People roster to actual people. */
function isFactionShapedNpc(npcName: string, factions: CampaignState["factions"]): boolean {
  const n = npcName.trim().toLowerCase();
  if (!n) return false;
  return factions.some((f) => {
    const fn = f.name.trim().toLowerCase();
    return fn === n || fn.includes(n);
  });
}

/** How to label a person: their role stands in for the name until it's known. */
function personDisplay(npc: CampaignState["npcs"][number], rel: NpcRelation | undefined) {
  const role = (npc as MaybeRole).role;
  const nameHidden = (rel as MaybeNameKnown | undefined)?.nameKnown === false && !!role;
  return { name: nameHidden ? titleCase(role!) : npc.name, role, nameHidden };
}

/** The cast the player has met — a clickable roster on the left, the selected
 *  person's dossier on the right (who they are, your standing, whereabouts, the
 *  last thing you knew). Shell-free so it drops into the details modal's People
 *  tab; it fills the parent's remaining height. */
export function PeopleView({
  state,
  npcRelations,
  sceneCard,
}: {
  state: CampaignState;
  npcRelations: NpcRelations;
  sceneCard: SceneCard | null;
}) {
  const present = new Set(sceneCard?.presentNpcIds ?? []);
  const here = state.campaign.currentLocationId;
  const locName = (id?: string) => state.locations.find((l) => l.id === id)?.name;
  const where = (npc: CampaignState["npcs"][number]) =>
    present.has(npc.id)
      ? { label: "In the scene now", tone: "text-accent" }
      : npc.locationId && npc.locationId === here
        ? { label: "Nearby — same station", tone: "text-neutral-400" }
        : { label: locName(npc.locationId) ? `Last seen: ${locName(npc.locationId)}` : "Elsewhere", tone: "text-neutral-500" };

  // The cast worth showing: anyone the player has a standing with, is with right
  // now, or who shares the current location. Ranked present → known → the rest.
  const people = state.npcs
    .map((npc) => ({ npc, rel: npcRelations[npc.id], w: where(npc) }))
    .filter(({ npc }) => !isFactionShapedNpc(npc.name, state.factions))
    .filter(({ npc, rel }) => rel || present.has(npc.id) || npc.locationId === here)
    .sort((a, b) => {
      const rank = (x: typeof a) => (present.has(x.npc.id) ? 2 : x.rel ? 1 : 0);
      return rank(b) - rank(a) || Math.abs(b.rel?.disposition ?? 0) - Math.abs(a.rel?.disposition ?? 0);
    });

  const [selId, setSelId] = useState<string | null>(people[0]?.npc.id ?? null);
  const sel = people.find((p) => p.npc.id === selId) ?? people[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: the roster. */}
      <div className="scrollbar-thin w-2/5 shrink-0 overflow-y-auto border-r border-edge">
        <div className="sticky top-0 border-b border-edge bg-panel px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">People ({people.length})</span>
        </div>
        {people.length === 0 ? (
          <p className="p-3 text-neutral-500">You haven&apos;t met anyone worth tracking yet.</p>
        ) : (
          <div className="p-1.5">
            {people.map(({ npc, rel, w }) => (
              <button
                key={npc.id}
                onClick={() => setSelId(npc.id)}
                className={
                  "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition " +
                  (npc.id === sel?.npc.id ? "bg-accent/15 text-neutral-100" : "text-neutral-300 hover:bg-white/5")
                }
              >
                <span className="truncate">
                  {personDisplay(npc, rel).name}
                  <span className={"block text-[10px] " + w.tone}>{w.label}</span>
                </span>
                <span
                  className={
                    "shrink-0 text-[11px] " +
                    (!rel ? "text-neutral-600" : rel.disposition > 0 ? "text-good" : rel.disposition < 0 ? "text-bad" : "text-neutral-500")
                  }
                >
                  {rel ? dispositionLabel(rel.disposition) : "—"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: the selected person's dossier. */}
      <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
        <div>
          {(() => {
            const disp = sel ? personDisplay(sel.npc, sel.rel) : null;
            return (
              <>
                <h3 className="text-lg font-semibold text-neutral-100">{disp?.name ?? "—"}</h3>
                {sel?.rel?.relationship && (
                  <p className="text-[12px] text-accent/80">{sel.rel.relationship}</p>
                )}
                {/* Role line — muted; doubles as the "Name unknown" note once the
                    role stands in for a name we don't have yet. */}
                {disp?.nameHidden ? (
                  <p className="text-[12px] text-neutral-500">Name unknown</p>
                ) : disp?.role ? (
                  <p className="text-[12px] text-neutral-500">{titleCase(disp.role)}</p>
                ) : null}
              </>
            );
          })()}
        </div>

        {sel && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Standing</div>
                {sel.rel ? <DispositionScale value={sel.rel.disposition} /> : <p className="mt-1 text-neutral-500">No read yet — you haven&apos;t dealt with them enough to know where you stand.</p>}
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Whereabouts</div>
                <p className={"mt-1 " + sel.w.tone}>{sel.w.label}</p>
              </div>

              {/* PLAYER KNOWLEDGE only — never the NPC's global canon (oneBreath) or
                  hidden backstory hook. What THIS character has learned lives in the
                  per-player relation note (how they were introduced, what they've since
                  found out); it grows as they interact. */}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">What you know</div>
                {sel.rel?.lastNote ? (
                  <p className="mt-1 leading-snug text-neutral-300">
                    {sel.rel.lastNote}
                    {sel.rel.lastSceneSeq ? <span className="text-neutral-600"> · scene {sel.rel.lastSceneSeq}</span> : null}
                  </p>
                ) : (
                  <p className="mt-1 text-neutral-500">You&apos;ve only just crossed paths — you know little about them yet.</p>
                )}
              </div>

              {/* History: how the relationship has actually gone, oldest→newest. The
                  newest beat is the headline above ("What you know"), so this shows
                  the prior ones — the arc that led to now. */}
              {sel.rel?.log && sel.rel.log.length > 1 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-500">History</div>
                  <ul className="mt-1 space-y-1">
                    {sel.rel.log.slice(0, -1).map((e, i) => (
                      <li key={i} className="leading-snug text-neutral-400">
                        <span className="text-neutral-300">{e.note}</span>
                        {e.scene ? <span className="text-neutral-600"> · scene {e.scene}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Their manner is a read you can only take in person — shown once you've
                  actually dealt with them (a passing mention doesn't reveal it). */}
              {sel.rel?.lastNote && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-500">Manner</div>
                  <p className="mt-1 leading-snug text-neutral-400">{sel.npc.quirk ?? generateQuirk(sel.npc.id)}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  );
}

/** A −3..+3 standing gauge with the current step highlighted. */
function DispositionScale({ value }: { value: number }) {
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <div className="mt-1.5">
      <div className="flex gap-0.5">
        {steps.map((s) => (
          <div
            key={s}
            title={dispositionLabel(s)}
            className={
              "h-1.5 flex-1 rounded-sm " +
              (s === value
                ? value > 0 ? "bg-good" : value < 0 ? "bg-bad" : "bg-neutral-400"
                : "bg-white/10")
            }
          />
        ))}
      </div>
      <div className={"mt-1 text-[13px] " + (value > 0 ? "text-good" : value < 0 ? "text-bad" : "text-neutral-400")}>
        {dispositionLabel(value)} <span className="text-neutral-600">({value >= 0 ? "+" : ""}{value})</span>
      </div>
    </div>
  );
}
