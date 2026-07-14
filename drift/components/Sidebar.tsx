"use client";

import { useState, type ReactNode } from "react";
import type { CampaignState, Skill, UniqueSkill } from "@/shared/schemas";
import { tickMax } from "@/engine/progression";
import { shipIsOwned } from "@/shared/recap";
import { backgrounds } from "@/content/creation";
import type { CombatState } from "@/shared/combat";
import { dispositionLabel, type NpcRelation, type NpcRelations, type SceneCard } from "@/shared/scene";
import { generateQuirk } from "@/shared/npcFlavor";
import { allItems, itemCount, describeEffect, slotsUsed, maxSlotsFor } from "@/shared/items";
import skillsMeta from "@/content/skills.json";

const ATTR_ORDER = ["might", "reflex", "vitality", "intellect", "perception", "presence"] as const;

/** What each attribute governs — surfaced as a tooltip on the attribute chips. */
const ATTR_HINT: Record<(typeof ATTR_ORDER)[number], string> = {
  might: "Raw physical force — melee, hauling, breaking through.",
  reflex: "Speed and coordination — piloting, gunnery, small arms, dodging.",
  vitality: "Toughness and endurance — your HP and resisting harm.",
  intellect: "Reasoning and know-how — mechanics, electronics, navigation.",
  perception: "Awareness — spotting trouble, tracking, sensors.",
  presence: "Force of personality — negotiation, deception, intimidation.",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const bgLabel = (id?: string) => backgrounds.find((b) => b.id === id)?.label ?? (id ? cap(id) : "");

/** A signature's passive bonus to a given attribute (0 if none). This is applied
 *  at roll time (rolls.passiveBonus); the sheet shows the ADJUSTED total so what
 *  you see matches what you roll. */
function sigAttrBonus(pc: CampaignState["characters"][number], attr: string): number {
  const u = pc.uniqueSkill;
  if (u?.kind === "passive" && u.passiveTargetType === "attribute" && u.passiveTarget === attr) {
    return u.passiveAmount ?? 0;
  }
  return 0;
}

/** Compact effect line for a signature (unique) skill. */
function sigLine(sig: UniqueSkill): string {
  return sig.kind === "passive"
    ? `+${sig.passiveAmount} ${sig.passiveTarget}`
    : `nat-20 · ${sig.triggerScenario ?? ""}`;
}

/** Every skill in the game, merged with the character's levels (0 if unlearned),
 *  learned first — so the sheet shows the full range the player can attempt, not
 *  just what they've trained. */
function allSkillRows(owned: Skill[]): Skill[] {
  const bySkill = new Map(owned.map((s) => [s.name, s]));
  return Object.keys(skillsMeta.skills)
    .map((name) => bySkill.get(name) ?? { name, level: 0, ticks: 0 })
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

/** Tooltip text for a skill: what it covers + its governing attribute
 *  (descriptions come from content/skills.json — the same source fed to the AI). */
function skillTooltip(name: string): string {
  const def = skillsMeta.skills[name as keyof typeof skillsMeta.skills] as
    | { attribute?: string; does?: string }
    | undefined;
  const a = (def?.attribute ?? "reflex").replace(/^./, (c) => c.toUpperCase());
  return def?.does ? `${def.does} (governed by ${a})` : `Governed by ${a}.`;
}

type Tab = "status" | "traits" | "map" | "clocks";

export default function Sidebar({
  state,
  combat = null,
  npcRelations = {},
  sceneCard = null,
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
            onDetails={() => openDetails("equipment")}
          />
        )}
        {tab === "traits" && <TraitsTab state={state} />}
        {tab === "map" && <MapTab state={state} />}
        {tab === "clocks" && <ClocksTab state={state} />}
      </div>

      {detailsTab && pc && (
        <DetailsModal
          state={state}
          character={pc}
          npcRelations={npcRelations}
          sceneCard={sceneCard}
          initialTab={detailsTab}
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

function Bar({
  value,
  max,
  tone = "bg-accent",
  height = "h-1.5",
}: {
  value: number;
  max: number;
  tone?: string;
  height?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`${height} w-full rounded bg-ink`}>
      <div className={`h-full rounded ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** camelCase skill ids → readable labels ("smallArms" → "Small Arms", "zeroG" → "Zero-G"). */
function humanizeSkill(name: string): string {
  const special: Record<string, string> = { zeroG: "Zero-G", smallArms: "Small Arms" };
  if (special[name]) return special[name];
  const spaced = name.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 border-t border-edge pt-2">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

function TraitRow({ k, v, tip }: { k: string; v?: string; tip?: string }) {
  if (!v) return null;
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span
        className={
          "shrink-0 text-neutral-500" +
          (tip ? " cursor-help underline decoration-dotted decoration-neutral-700 underline-offset-2" : "")
        }
        title={tip}
      >
        {k}
      </span>
      <span className="text-right text-neutral-200">{v}</span>
    </div>
  );
}

/** Condition label from injuries — the immediate life-and-death state. */
function condition(injuries?: { name: string }[]): { text: string; className: string } | null {
  if (injuries?.some((i) => i.name === "Dead")) return { text: "☠ DECEASED", className: "text-bad" };
  if (injuries?.some((i) => i.name === "Downed")) return { text: "DOWNED", className: "text-bad" };
  return null;
}

/** MAIN tab — the most immediate info: HP/condition, weapons + ammo, inventory,
 *  ship survival state, and where you are / what's live. */
function StatusTab({
  state,
  combat,
  npcRelations,
  sceneCard,
  onDetails,
}: {
  state: CampaignState;
  combat: CombatState | null;
  npcRelations: NpcRelations;
  sceneCard: SceneCard | null;
  onDetails: () => void;
}) {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const active = state.threads.filter((t) => t.status === "active");
  return (
    <div className="space-y-4">
      {combat?.active && (
        <div className="rounded border border-bad/50 bg-bad/5 p-2">
          <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-bad">
            <span>⚔ In combat</span>
            <span className="text-neutral-500">Round {combat.round}</span>
          </div>
          <div className="space-y-1">
            {combat.enemies.map((e) => (
              <div key={e.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-neutral-200">{e.name}</span>
                  <span className="tabular-nums text-[11px] text-neutral-500">
                    {e.hp}/{e.maxHp}
                    {e.shieldReady && <span className="text-accent"> ⛨</span>}
                  </span>
                </div>
                <Bar value={e.hp} max={e.maxHp} tone="bg-bad" height="h-1" />
              </div>
            ))}
          </div>
          {/* Own hull, visible during a ship fight (full ship card is in More details). */}
          {combat.scale === "ship" && state.ship && (
            <div className="mt-2 border-t border-bad/30 pt-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-neutral-200">{state.ship.name} (you)</span>
                <span className="tabular-nums text-[11px] text-neutral-500">
                  {state.ship.hp}/{state.ship.maxHp}
                  {state.ship.shieldReady && <span className="text-accent"> ⛨</span>}
                </span>
              </div>
              <Bar value={state.ship.hp} max={state.ship.maxHp} tone="bg-good" height="h-1" />
            </div>
          )}
        </div>
      )}
      {state.characters.map((c) => {
        const cond = condition(c.injuries);
        const weapons = c.gear.filter((g) => g.damage);
        const inventory = c.gear.filter((g) => !g.damage);
        return (
          <div key={c.id} className="rounded border border-edge p-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-100">{c.name}</span>
              <span className="text-neutral-500">{c.kind === "pc" ? "You" : `loyalty ${c.loyalty}/5`}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="w-14 text-neutral-500">HP {c.hp}/{c.maxHp}</span>
              <Bar value={c.hp} max={c.maxHp} tone={c.hp / c.maxHp < 0.34 ? "bg-bad" : "bg-good"} />
            </div>
            <div className="mt-1 text-neutral-500">
              <span
                className="cursor-help underline decoration-dotted decoration-neutral-700 underline-offset-2"
                title="How hard you are to hit — an attack roll must meet or beat it to land (10 + Reflex + armor)."
              >
                Armor Class
              </span>{" "}
              {c.ac}
              {c.credits !== undefined && ` · ¢${c.credits}`}
              {c.fragile && <span className="text-bad"> · FRAGILE</span>}
              {cond && <span className={`font-semibold ${cond.className}`}> · {cond.text}</span>}
            </div>

            {/* Bleeding Out — the death-save track while Downed (COMBAT.md). Pips
                fill as the engine rolls: three ● stabilise, three ✕ is death. */}
            {c.deathSaves && (c.injuries ?? []).some((i) => i.name === "Downed") && (
              <div className="mt-1 flex items-center gap-3 text-[12px]" title="Death saves — 3 successes stabilise you, 3 failures is death.">
                <span className="text-good">
                  saves {"●".repeat(Math.min(3, c.deathSaves.successes))}
                  <span className="text-neutral-700">{"○".repeat(Math.max(0, 3 - c.deathSaves.successes))}</span>
                </span>
                <span className="text-bad">
                  fails {"✕".repeat(Math.min(3, c.deathSaves.failures))}
                  <span className="text-neutral-700">{"○".repeat(Math.max(0, 3 - c.deathSaves.failures))}</span>
                </span>
              </div>
            )}

            {(weapons.length > 0 || inventory.length > 0 || c.stims > 0) && (
              <SheetSection label={`Equipment · ${slotsUsed(c)}/${maxSlotsFor(c)} slots`}>
                <div className="space-y-0.5">
                  {weapons.map((g, i) => {
                    const dry = g.rounds === 0;
                    return (
                      <div key={`w${i}`} className="flex justify-between gap-2 text-[12px]" title={g.detail}>
                        <span className="text-neutral-200">{g.name}</span>
                        <span className="tabular-nums text-neutral-500">
                          {g.damage}
                          {typeof g.rounds === "number" && (
                            <span className={dry ? "text-bad" : "text-neutral-600"}>
                              {" · "}
                              {dry ? "no ammo" : `${g.rounds} rds`}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  {inventory.map((g, i) => (
                    <div key={`i${i}`} className="flex justify-between gap-2 text-[12px]" title={g.detail}>
                      <span className="text-neutral-200">
                        {g.name}
                        {g.qty && g.qty > 1 ? <span className="text-neutral-500"> ×{g.qty}</span> : null}
                      </span>
                      {g.acBonus ? <span className="tabular-nums text-neutral-600">+{g.acBonus} AC</span> : null}
                    </div>
                  ))}
                  {c.stims > 0 && (
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="text-neutral-200">Stim ×{c.stims}</span>
                      <span className="tabular-nums text-neutral-600">heal 1d6+2</span>
                    </div>
                  )}
                </div>
              </SheetSection>
            )}

            {c.kind === "pc" && (
              <button
                onClick={onDetails}
                className="mt-2 w-full rounded border border-edge py-1 text-[11px] uppercase tracking-wide text-neutral-400 transition hover:border-accent hover:text-accent"
              >
                More details
              </button>
            )}
          </div>
        );
      })}


      <div className="rounded border border-edge p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Here &amp; now</div>
        {/* Whereabouts: the free-text place (a ship, the black) if set — always current
            within the scene, since a move to a new place now opens a new scene — else
            the accurate fixed station. */}
        <div className="text-neutral-200">{sceneCard?.place ?? loc?.name ?? "Unknown"}</div>
        {sceneCard?.place && loc?.name && !sceneCard.place.includes(loc.name) && (
          <div className="text-[11px] text-neutral-600">near {loc.name}</div>
        )}

        {/* The live scene: what's happening, who's here, what's been established. */}
        {sceneCard?.situation && (
          <p className="mt-1 text-[12px] italic leading-snug text-neutral-300">{sceneCard.situation}</p>
        )}
        {sceneCard?.dangers && sceneCard.dangers.length > 0 && (
          <div className="mt-1.5 rounded border border-bad/40 bg-bad/5 px-2 py-1">
            {sceneCard.dangers.map((d, i) => (
              <div key={i} className="text-[12px] font-medium text-bad">
                ⚠ {d}
              </div>
            ))}
          </div>
        )}
        {/* Who's in the scene right now — each folds in what you know of them
            (relationship + standing), so someone you just spoke with shows live
            with your read on them the instant the turn returns. */}
        {(() => {
          const present = sceneCard
            ? sceneCard.presentNpcIds
                .map((id) => state.npcs.find((n) => n.id === id))
                .filter((n): n is CampaignState["npcs"][number] => !!n)
            : [];
          if (present.length === 0) return null;
          const dispTone = (d: number) => (d > 0 ? "text-good" : d < 0 ? "text-bad" : "text-neutral-500");
          return (
            <div className="mt-1.5 space-y-1">
              {present.map((npc) => {
                const rel = npcRelations[npc.id];
                return (
                  <div
                    key={npc.id}
                    className="rounded border border-edge bg-ink/40 px-1.5 py-1"
                    title={npc.role ?? undefined}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] text-neutral-200">
                        {npc.name}
                        <span className="text-[11px] text-accent/70"> · immediate</span>
                      </span>
                      {rel && (
                        <span className={"shrink-0 text-[11px] " + dispTone(rel.disposition)}>
                          {dispositionLabel(rel.disposition)}
                        </span>
                      )}
                    </div>
                    {rel?.relationship && (
                      <div className="text-[11px] text-neutral-500">{rel.relationship}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Also nearby: known contacts on the same station who aren't in the scene
            — a compact awareness line so they're not out of sight, out of mind. */}
        {(() => {
          const presentIds = new Set(sceneCard?.presentNpcIds ?? []);
          const here = state.campaign.currentLocationId;
          const nearby = state.npcs
            .filter((n) => npcRelations[n.id] && n.locationId === here && !presentIds.has(n.id))
            .slice(0, 5);
          if (nearby.length === 0) return null;
          return (
            <div className="mt-1.5 border-t border-edge/60 pt-1.5 text-[11px] text-neutral-500">
              <span className="text-neutral-600">Also nearby:</span>{" "}
              {nearby.map((npc, i) => {
                const rel = npcRelations[npc.id];
                const tone = rel && rel.disposition > 0 ? "text-good" : rel && rel.disposition < 0 ? "text-bad" : "text-neutral-400";
                return (
                  <span key={npc.id}>
                    {i > 0 && ", "}
                    <span className="text-neutral-300">{npc.name}</span>
                    {rel && <span className={tone}> ({dispositionLabel(rel.disposition)})</span>}
                  </span>
                );
              })}
            </div>
          );
        })()}
        {sceneCard && sceneCard.beats.length > 0 && (
          <div className="mt-1.5 border-t border-edge/60 pt-1.5">
            <div className="text-[10px] uppercase tracking-wide text-neutral-600">Established</div>
            {sceneCard.beats.map((b, i) => (
              <div key={i} className="mt-0.5 text-[12px] text-neutral-400">
                • {b}
              </div>
            ))}
          </div>
        )}

        {/* The current objective only — the full thread list lives in More details. */}
        {active.length > 0 && (
          <div className="mt-1.5 border-t border-edge/60 pt-1.5 text-[12px] text-neutral-400">
            <span className="text-neutral-600">Now:</span> {active[0].title}
          </div>
        )}
      </div>

    </div>
  );
}

/** TRAITS tab — attributes, skills, and who the character is. */
function TraitsTab({ state }: { state: CampaignState }) {
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc) return <p className="text-neutral-500">No character.</p>;
  return (
    <div className="rounded border border-edge p-2">
      <div className="font-semibold text-neutral-100">{pc.name}</div>

      <SheetSection label="Attributes">
        <div className="grid grid-cols-6 gap-1">
          {ATTR_ORDER.map((a) => {
            const base = pc.attributes[a] ?? 0;
            const bonus = sigAttrBonus(pc, a);
            const total = base + bonus;
            return (
              <div
                key={a}
                className="cursor-help rounded border border-edge/60 bg-ink/40 px-1 py-1 text-center"
                title={
                  bonus
                    ? `${cap(a)} — ${ATTR_HINT[a]} (base ${fmtMod(base)} ${bonus >= 0 ? "+" : ""}${bonus} signature)`
                    : `${cap(a)} — ${ATTR_HINT[a]}`
                }
              >
                <div className="text-[9px] uppercase text-neutral-600">{a.slice(0, 3)}</div>
                <div className={"text-[13px] font-semibold " + (bonus ? "text-accent" : "text-neutral-100")}>
                  {fmtMod(total)}
                </div>
              </div>
            );
          })}
        </div>
      </SheetSection>

      <SheetSection label="Skills — improve max once per skill per scene">
        <div className="space-y-2">
          {allSkillRows(pc.skills).map((s) => {
            const learned = s.level > 0 || s.ticks > 0;
            return (
              <div key={s.name} className={learned ? "" : "opacity-45"}>
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="cursor-help text-[13px] text-neutral-200 underline decoration-dotted decoration-neutral-600 underline-offset-2"
                    title={skillTooltip(s.name)}
                  >
                    {humanizeSkill(s.name)}
                  </span>
                  <span className="shrink-0 tabular-nums text-[11px] text-neutral-500">
                    Level&nbsp;{s.level}
                    {learned && <span className="text-neutral-600"> · {s.ticks}/{tickMax(s.level)}</span>}
                  </span>
                </div>
                {learned && (
                  <div className="mt-1">
                    <Bar value={s.ticks} max={tickMax(s.level)} height="h-1" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetSection>

      {pc.uniqueSkill && (
        <SheetSection label="Signature">
          <p className="text-[13px] text-neutral-200">
            <span className="font-semibold">{pc.uniqueSkill.name}</span>
            <span className="text-accent/80"> · {sigLine(pc.uniqueSkill)}</span>
          </p>
        </SheetSection>
      )}
    </div>
  );
}

type DetailsTab = "equipment" | "items" | "ship" | "relationships" | "factions" | "story";

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

/** Popup — extended info kept out of the always-on rail, split into tabs:
 *  Equipment (weapons/armor detail), Items (consumables + tools), Ship,
 *  Relationships (the people you know), and Story (who they are + the live thread
 *  log). Fixed size so the frame never jumps as you switch tabs; the content area
 *  scrolls on its own. */
function DetailsModal({
  state,
  character,
  npcRelations,
  sceneCard,
  initialTab = "equipment",
  onClose,
}: {
  state: CampaignState;
  character: CampaignState["characters"][number];
  npcRelations: NpcRelations;
  sceneCard: SceneCard | null;
  initialTab?: DetailsTab;
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
            {tab === "items" && <ItemsDetail character={c} />}
            {tab === "ship" && (
              <SheetSection label="Ship">
                <ShipTab state={state} />
              </SheetSection>
            )}
            {tab === "factions" && <FactionsDetail state={state} character={c} />}
            {tab === "story" && (
              <>
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

/** The live thread log inside the Story tab — open quests (updated as scenes
 *  change) and a struck-through record of what's been resolved, so the Story tab
 *  visibly evolves as the campaign moves. */
function StoryThreads({ state }: { state: CampaignState }) {
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

/** Factions tab — only the powers the player has actually crossed paths with:
 *  their own (parent/founded) faction, anyone they hold a reputation with, and any
 *  faction named in an active/resolved thread. Shows the standing as a signed,
 *  colour-coded number so allegiances read at a glance. */
function FactionsDetail({
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

/** The cast the player has met — a clickable roster on the left, the selected
 *  person's dossier on the right (who they are, your standing, whereabouts, the
 *  last thing you knew). Shell-free so it drops into the details modal's People
 *  tab; it fills the parent's remaining height. */
function PeopleView({
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

/** Story tab — traits, signature, moral line, voice, backstory. */
function StoryDetail({ character: c }: { character: CampaignState["characters"][number] }) {
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

/** Equipment tab — weapons and armor, with the numbers that matter. */
function EquipmentDetail({ character: c }: { character: CampaignState["characters"][number] }) {
  const weapons = c.gear.filter((g) => g.damage);
  const armor = c.gear.filter((g) => !g.damage && g.acBonus);
  return (
    <>
      <SheetSection label="Weapons">
        {weapons.length === 0 && <p className="text-neutral-500">Unarmed.</p>}
        <div className="space-y-2">
          {weapons.map((g, i) => (
            <div key={i} className="rounded border border-edge/60 bg-ink/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-100">{g.name}</span>
                <span className="tabular-nums text-neutral-400">{g.damage} dmg</span>
              </div>
              <div className="mt-0.5 text-[12px] text-neutral-500">
                {typeof g.rounds === "number"
                  ? g.rounds === 0
                    ? "Out of ammo"
                    : `${g.rounds} rounds left`
                  : "No ammo tracking"}
                {g.detail ? ` · ${g.detail}` : ""}
              </div>
            </div>
          ))}
        </div>
      </SheetSection>
      <SheetSection label="Armor">
        {armor.length === 0 && <p className="text-neutral-500">No armor — AC is reflexes alone.</p>}
        <div className="space-y-2">
          {armor.map((g, i) => (
            <div key={i} className="rounded border border-edge/60 bg-ink/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-100">{g.name}</span>
                <span className="tabular-nums text-good">+{g.acBonus} AC</span>
              </div>
              {g.detail && <div className="mt-0.5 text-[12px] text-neutral-500">{g.detail}</div>}
            </div>
          ))}
        </div>
      </SheetSection>
    </>
  );
}

/** Items tab — consumables (with counts + what they do) and carried tools. */
function ItemsDetail({ character: c }: { character: CampaignState["characters"][number] }) {
  // Catalog consumables the character holds (incl. the legacy stims counter).
  const consumables = allItems()
    .filter((it) => it.type === "consumable")
    .map((it) => ({ it, n: itemCount(c, it.id) }))
    .filter((x) => x.n > 0);
  // Everything else they carry: tools/flavor gear (no damage, no AC, no catalog).
  const tools = c.gear.filter((g) => !g.damage && !g.acBonus && !g.itemId);
  return (
    <>
      <SheetSection label="Consumables">
        {consumables.length === 0 && <p className="text-neutral-500">None — docks and looting restock these.</p>}
        <div className="space-y-2">
          {consumables.map(({ it, n }) => (
            <div key={it.id} className="rounded border border-edge/60 bg-ink/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-100">
                  {it.name} <span className="text-neutral-500">×{n}</span>
                </span>
                <span className="text-[11px] uppercase tracking-wide text-neutral-600">
                  {it.combat ? "usable in combat" : "out of combat"}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-neutral-400">{describeEffect(it)}</div>
            </div>
          ))}
        </div>
      </SheetSection>
      <SheetSection label="Tools & possessions">
        {tools.length === 0 && <p className="text-neutral-500">Nothing beyond the essentials.</p>}
        <div className="space-y-2">
          {tools.map((g, i) => (
            <div key={i} className="rounded border border-edge/60 bg-ink/40 p-2">
              <span className="font-semibold text-neutral-100">
                {g.name}
                {g.qty && g.qty > 1 ? <span className="text-neutral-500"> ×{g.qty}</span> : null}
              </span>
              {g.detail && <div className="mt-0.5 text-[12px] text-neutral-500">{g.detail}</div>}
            </div>
          ))}
        </div>
      </SheetSection>
    </>
  );
}

function ShipTab({ state }: { state: CampaignState }) {
  const s = state.ship;
  if (!s) return <p className="text-neutral-500">No ship — grounded until you earn a hull of your own.</p>;
  const missiles = s.weapons.find((w) => w.type === "missile")?.ammo ?? 0;
  const owned = shipIsOwned(state);
  return (
    <div className="space-y-3">
      <div className="rounded border border-edge p-2">
        <div className="flex justify-between">
          <span className="font-semibold text-neutral-100">{s.name}</span>
          <span className="text-neutral-500">{s.shipClass}</span>
        </div>
        <div
          className={
            "mt-1 inline-block rounded px-1.5 py-0.5 text-xs " +
            (owned ? "bg-good/20 text-good" : "bg-edge text-neutral-400")
          }
        >
          {owned ? "Owned" : "On loan — not yet yours"}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="w-16 text-neutral-500">HP {s.hp}/{s.maxHp}</span>
          <Bar value={s.hp} max={s.maxHp} tone={s.hp / s.maxHp < 0.34 ? "bg-bad" : "bg-good"} />
        </div>
        <div className="mt-2 space-y-1 text-neutral-400">
          <div>Armor Class {s.ac} (+{s.evasiveAcBonus} evasive) · Damage Reduction {s.damageReduction}</div>
          <div>Shield: {s.shieldReady ? "ready" : "spent"} · Burst: {s.burstDriveReady ? "ready" : "used"}</div>
          <div>Missiles: {missiles}</div>
        </div>
        <div className="mt-2 border-t border-edge pt-2 text-neutral-500">
          {s.weapons.map((w) => (
            <div key={w.name}>
              {w.name} — {w.type} {w.damage}
              {w.count ? ` ×${w.count}` : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClocksTab({ state }: { state: CampaignState }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 uppercase tracking-wide text-neutral-500">Clocks</h3>
        <div className="space-y-2">
          {state.clocks.map((c) => (
            <div key={c.id} className="rounded border border-edge p-2">
              <div className="flex justify-between">
                <span className="text-neutral-200">{c.name}</span>
                <span className="text-neutral-500">{c.current}/{c.max}</span>
              </div>
              <div className="mt-1">
                <Bar value={c.current} max={c.max} tone="bg-bad" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 uppercase tracking-wide text-neutral-500">Faction rep</h3>
        <div className="space-y-1">
          {(() => {
            // Only surface factions the player has actually encountered: their own
            // faction (which carries a starting `standing`) and any faction whose
            // rep has moved off its neutral default through play.
            const encountered = state.factionRep.filter((r) => r.standing !== undefined || r.rep !== 0);
            if (encountered.length === 0) {
              return <p className="text-neutral-600">No factions encountered yet.</p>;
            }
            return encountered.map((r) => {
              const f = state.factions.find((x) => x.id === r.factionId);
              return (
                <div key={r.factionId} className="flex justify-between text-neutral-400">
                  <span className="truncate">{f?.name ?? r.factionId}</span>
                  <span className={r.rep >= 0 ? "text-good" : "text-bad"}>
                    {r.rep >= 0 ? `+${r.rep}` : r.rep}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Star map ────────────────────────────────────────────────────────────────
// A hand-authored stellar layout for the shared world's canonical locations,
// rendered dynamically from live state: the player's current location pulses,
// lanes connect neighbouring stations, and any location id NOT in the curated
// layout falls back to an evenly-spaced ring so the map never breaks if the
// world's canon grows.
const MAP_W = 260;
const MAP_H = 340;

const MAP_LAYOUT: Record<string, { x: number; y: number; color: string }> = {
  "loc-meridian": { x: 66, y: 52, color: "#e8a33d" }, // ordered core
  "loc-rook": { x: 198, y: 74, color: "#c99a5b" }, // black-market hub
  "loc-undertow": { x: 138, y: 142, color: "#8b93a6" }, // contested space
  "loc-shear": { x: 92, y: 224, color: "#d9584a" }, // the hazard field
  "loc-nest": { x: 200, y: 248, color: "#d9584a" }, // hidden in the Shear
  "loc-talos": { x: 84, y: 306, color: "#6f7b93" }, // frontier, beyond the Shear
};

const MAP_LANES: [string, string][] = [
  ["loc-meridian", "loc-rook"],
  ["loc-meridian", "loc-undertow"],
  ["loc-rook", "loc-undertow"],
  ["loc-meridian", "loc-shear"],
  ["loc-undertow", "loc-shear"],
  ["loc-shear", "loc-talos"],
  ["loc-shear", "loc-nest"],
];

// Deterministic decorative starfield (no RNG — stable across renders).
const MAP_STARS = [
  { x: 30, y: 30, r: 0.8 }, { x: 220, y: 40, r: 1 }, { x: 160, y: 26, r: 0.7 },
  { x: 240, y: 130, r: 0.9 }, { x: 18, y: 150, r: 0.7 }, { x: 236, y: 210, r: 0.8 },
  { x: 40, y: 250, r: 1 }, { x: 150, y: 300, r: 0.7 }, { x: 230, y: 320, r: 0.9 },
  { x: 60, y: 180, r: 0.6 }, { x: 120, y: 90, r: 0.6 }, { x: 200, y: 170, r: 0.7 },
];

function MapTab({ state }: { state: CampaignState }) {
  const currentId = state.campaign.currentLocationId;

  // Resolve a position for every location in state: curated layout first, then a
  // deterministic fallback ring for anything the layout table doesn't know.
  const positions = new Map<string, { x: number; y: number; color: string }>();
  const unknowns: typeof state.locations = [];
  state.locations.forEach((l) => {
    if (MAP_LAYOUT[l.id]) positions.set(l.id, MAP_LAYOUT[l.id]);
    else unknowns.push(l);
  });
  unknowns.forEach((l, i) => {
    const angle = (i / Math.max(1, unknowns.length)) * Math.PI * 2 - Math.PI / 2;
    positions.set(l.id, {
      x: MAP_W / 2 + Math.cos(angle) * 72,
      y: MAP_H / 2 + Math.sin(angle) * 72,
      color: "#8b93a6",
    });
  });

  const current = state.locations.find((l) => l.id === currentId);

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Known space</div>
      <div className="rounded-lg border border-edge bg-ink/60 p-1">
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full" role="img" aria-label="Star map of known space">
          {MAP_STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#2a3342" opacity={0.7} />
          ))}

          {/* Travel lanes between neighbouring locations. */}
          {MAP_LANES.map(([a, b]) => {
            const pa = positions.get(a);
            const pb = positions.get(b);
            if (!pa || !pb) return null;
            const active = a === currentId || b === currentId;
            return (
              <line
                key={`${a}-${b}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={active ? "#e8a33d" : "#2b3444"}
                strokeWidth={active ? 1.4 : 1}
                strokeDasharray="2 4"
                opacity={active ? 0.85 : 0.55}
              />
            );
          })}

          {/* Location nodes; the current one is enlarged with a pulsing ring. */}
          {state.locations.map((l) => {
            const p = positions.get(l.id);
            if (!p) return null;
            const isCurrent = l.id === currentId;
            return (
              <g key={l.id}>
                {isCurrent && (
                  <circle cx={p.x} cy={p.y} r={11} fill="none" stroke="#e8a33d" strokeWidth={1.5} opacity={0.6} className="animate-pulse" />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isCurrent ? 6 : 4}
                  fill={p.color}
                  stroke={isCurrent ? "#e8a33d" : "#0b0e14"}
                  strokeWidth={isCurrent ? 2 : 1}
                />
                <text
                  x={p.x}
                  y={p.y + 15}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isCurrent ? "#e8a33d" : "#9aa3b2"}
                  fontWeight={isCurrent ? 600 : 400}
                >
                  {l.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {current && (
        <div className="rounded border border-edge p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: MAP_LAYOUT[current.id]?.color ?? "#8b93a6" }} />
            <span className="font-semibold text-neutral-100">{current.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-accent">· you are here</span>
          </div>
          {current.description && (
            <p className="mt-1 text-[12px] leading-snug text-neutral-400">{current.description}</p>
          )}
          {current.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {current.tags.map((t) => (
                <span key={t} className="rounded bg-edge px-1.5 py-0.5 text-[10px] capitalize text-neutral-400">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
