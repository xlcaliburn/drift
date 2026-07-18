"use client";

import { useState } from "react";
import type { CampaignState } from "@/shared/schemas";
import type { CombatState } from "@/shared/combat";
import type { NpcRelations, SceneCard } from "@/shared/scene";
import type { ChoiceOption } from "@/shared/turnPlan";
import type { Job } from "@/shared/quests";
import type { PlayerLedger } from "@/shared/ledger";
import type { Fact } from "@/shared/facts";
import type { StorylineState } from "@/shared/storyline";
import { StatusTab } from "./sidebar/StatusTab";
import { TraitsTab } from "./sidebar/TraitsTab";
import { MapTab } from "./sidebar/MapTab";
import { ClocksTab } from "./sidebar/ClocksTab";
import { DetailsModal, type DetailsTab } from "./sidebar/DetailsModal";

/**
 * The right-rail character sheet. This file is only the SHELL — the tab strip,
 * the desktop rail / mobile drawer chrome, and the details-modal mount. Every
 * tab lives in its own module under components/sidebar/ (shared primitives in
 * sidebar/ui.tsx) so parallel work on different tabs never collides here.
 */

type Tab = "status" | "traits" | "map" | "clocks";

export default function Sidebar({
  state,
  combat = null,
  npcRelations = {},
  sceneCard = null,
  jobs = [],
  playerLedger = {},
  facts = [],
  storyline,
  onFlagFact,
  onJobAction,
  onRefresh,
  mobileOpen = false,
  onClose,
}: {
  state: CampaignState;
  combat?: CombatState | null;
  /** Player↔NPC standing overlay — feeds the Contacts section. */
  npcRelations?: NpcRelations;
  /** Current scene's working memory — feeds the Scene box. */
  sceneCard?: SceneCard | null;
  /** Active jobs (QUESTS.md) — feeds the Status tab's "On the job" block.
   *  Offers are diegetic (surfaced by the narrator), not a browsable board. */
  jobs?: Job[];
  /** The relationship ledger (MULTIPLAYER.md §2) — feeds the Rolodex tab. */
  playerLedger?: PlayerLedger;
  /** The durable facts ledger (CONTINUITY.md v2) — feeds "The game remembers"
   *  in the Story tab. */
  facts?: Fact[];
  /** The main-questline progress (STORY.md, HANDOFF_STORY_1.md Task C) — feeds
   *  the Story tab's "Season" block. Undefined while the live pack ships zero
   *  chapters, same as an empty state — the block stays hidden either way. */
  storyline?: StorylineState;
  /** Flag a remembered fact as wrong — opens the feedback modal prefilled. */
  onFlagFact?: (text: string) => void;
  /** Accept/abandon a job: fires a turn carrying the chip. Undefined while busy. */
  onJobAction?: (choice: ChoiceOption) => void;
  /** Re-pull fresh server state; fired when the details modal opens so it never
   *  shows stale data. */
  onRefresh?: () => void;
  /** Mobile slide-over drawer control (desktop rail ignores these). */
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("status");
  // Which details-modal tab is open (null = modal closed).
  const [detailsTab, setDetailsTab] = useState<DetailsTab | null>(null);
  const pc = state.characters.find((c) => c.kind === "pc");
  // Opening the modal always refetches so the sheet reflects the latest state.
  const openDetails = (t: DetailsTab) => {
    onRefresh?.();
    setDetailsTab(t);
  };

  const body = (
    <>
      <div className="flex border-b border-edge text-xs">
        {(["status", "traits", "map", "clocks"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "flex-1 py-2.5 uppercase tracking-wide " +
              (tab === t ? "border-b-2 border-accent text-accent" : "text-neutral-500")
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-3 text-[13px]">
        {tab === "status" && (
          <StatusTab
            state={state}
            combat={combat}
            npcRelations={npcRelations}
            sceneCard={sceneCard}
            jobs={jobs}
            onJobAction={onJobAction}
            onDetails={() => openDetails("equipment")}
            onRefresh={onRefresh}
          />
        )}
        {tab === "traits" && <TraitsTab state={state} />}
        {tab === "map" && <MapTab state={state} sceneCard={sceneCard} />}
        {tab === "clocks" && <ClocksTab state={state} />}
      </div>

      {detailsTab && pc && (
        <DetailsModal
          state={state}
          character={pc}
          npcRelations={npcRelations}
          sceneCard={sceneCard}
          playerLedger={playerLedger}
          facts={facts}
          storyline={storyline}
          onFlagFact={onFlagFact}
          initialTab={detailsTab}
          onRefresh={onRefresh}
          onClose={() => setDetailsTab(null)}
        />
      )}
    </>
  );

  return (
    <>
      {/* Desktop: fixed right rail. */}
      <aside className="hidden w-80 shrink-0 flex-col border-l border-edge bg-panel/40 md:flex">
        {body}
      </aside>

      {/* Mobile: slide-over drawer, opened by the header ☰ button. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={onClose}>
          <div className="absolute inset-0 bg-ink/70" />
          <aside
            className="absolute right-0 top-0 flex h-full w-80 max-w-[85%] flex-col border-l border-edge bg-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Character</span>
              <button
                onClick={onClose}
                className="px-2 py-1 text-neutral-400 transition hover:text-accent"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
