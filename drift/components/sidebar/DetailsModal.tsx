"use client";

import { useState } from "react";
import type { CampaignState } from "@/shared/schemas";
import type { NpcRelations, SceneCard } from "@/shared/scene";
import type { PlayerLedger } from "@/shared/ledger";
import { SheetSection } from "./ui";
import { PeopleView } from "./PeopleTab";
import { RolodexTab } from "./RolodexTab";
import { FactionsDetail } from "./FactionsTab";
import { ShipTab } from "./ShipTab";
import { EquipmentDetail, ItemsDetail } from "./GearTabs";
import { StoryDetail, StoryThreads } from "./StoryTab";
import { AimEditor } from "./AimEditor";
import { RemakeEditor } from "./RemakeEditor";

export type DetailsTab = "equipment" | "items" | "ship" | "relationships" | "contacts" | "factions" | "story";

/** Popup — extended info kept out of the always-on rail, split into tabs:
 *  Equipment (weapons/armor detail), Items (consumables + tools), Ship,
 *  Relationships (the people you know), and Story (who they are + the live thread
 *  log). Fixed size so the frame never jumps as you switch tabs; the content area
 *  scrolls on its own. */
export function DetailsModal({
  state,
  character,
  npcRelations,
  sceneCard,
  playerLedger = {},
  initialTab = "equipment",
  onRefresh,
  onClose,
}: {
  state: CampaignState;
  character: CampaignState["characters"][number];
  npcRelations: NpcRelations;
  sceneCard: SceneCard | null;
  /** The relationship ledger (MULTIPLAYER.md §2) — feeds the Contacts/Rolodex tab. */
  playerLedger?: PlayerLedger;
  initialTab?: DetailsTab;
  onRefresh?: () => void;
  onClose: () => void;
}) {
  const c = character;
  const [tab, setTab] = useState<DetailsTab>(initialTab);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={onClose}>
      <div
        className="flex h-[80dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-panel text-[13px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="text-lg font-semibold text-neutral-100">{c.name}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-accent" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mt-3 flex border-b border-edge text-xs">
          {(
            [
              ["equipment", "Equipment"],
              ["items", "Items"],
              ["ship", "Ship"],
              ["relationships", "People"],
              ["contacts", "Rolodex"],
              ["factions", "Factions"],
              ["story", "Story"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                "flex-1 py-2 uppercase tracking-wide " +
                (tab === id ? "border-b-2 border-accent text-accent" : "text-neutral-500")
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Relationships gets the full frame (its own two-column scroll); the rest
            share a padded, scrolling column. */}
        {tab === "relationships" ? (
          <PeopleView state={state} npcRelations={npcRelations} sceneCard={sceneCard} />
        ) : (
          <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
            {tab === "equipment" && <EquipmentDetail character={c} />}
            {tab === "contacts" && <RolodexTab ledger={playerLedger} />}
            {tab === "items" && <ItemsDetail character={c} />}
            {tab === "ship" && (
              <SheetSection label="Ship">
                <ShipTab state={state} />
              </SheetSection>
            )}
            {tab === "factions" && <FactionsDetail state={state} character={c} />}
            {tab === "story" && (
              <>
                <AimEditor campaignId={state.campaign.id} initial={state.campaign.directive ?? ""} onSaved={onRefresh} />
                <RemakeEditor state={state} character={c} onSaved={onRefresh} />
                <StoryDetail character={c} />
                <StoryThreads state={state} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
