"use client";

import { useState, type ReactNode } from "react";
import type { CampaignState, Skill, UniqueSkill } from "@/shared/schemas";
import { tickMax } from "@/engine/progression";
import { shipIsOwned } from "@/shared/recap";
import { backgrounds } from "@/content/creation";
import type { CombatState } from "@/shared/combat";
import { dispositionLabel, type NpcRelations, type SceneCard } from "@/shared/scene";
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
  mobileOpen = false,
  onClose,
}: {
  state: CampaignState;
  combat?: CombatState | null;
  /** Player↔NPC standing overlay — feeds the Contacts section. */
  npcRelations?: NpcRelations;
  /** Current scene's working memory — feeds the Scene box. */
  sceneCard?: SceneCard | null;
  /** Mobile slide-over drawer control (desktop rail ignores these). */
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("status");
  const [showDetails, setShowDetails] = useState(false);
  const pc = state.characters.find((c) => c.kind === "pc");

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
            onDetails={() => setShowDetails(true)}
          />
        )}
        {tab === "traits" && <TraitsTab state={state} />}
        {tab === "map" && <MapTab state={state} />}
        {tab === "clocks" && <ClocksTab state={state} />}
      </div>

      {showDetails && pc && <DetailsModal character={pc} onClose={() => setShowDetails(false)} />}
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
  // Contacts: every NPC the player has a standing with, strongest ties first.
  const contacts = Object.entries(npcRelations)
    .flatMap(([id, rel]) => {
      const npc = state.npcs.find((n) => n.id === id);
      return npc ? [{ rel, npc }] : [];
    })
    .sort((a, b) => Math.abs(b.rel.disposition) - Math.abs(a.rel.disposition))
    .slice(0, 8);
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

            {(weapons.length > 0 || inventory.length > 0 || c.stims > 0) && (
              <SheetSection label="Equipment">
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

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">Ship</div>
        <ShipTab state={state} />
      </div>

      <div className="rounded border border-edge p-2">
        <div className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-wide text-neutral-500">
          <span>Here &amp; now</span>
          {sceneCard && <span className="normal-case text-neutral-600">scene {sceneCard.seq}</span>}
        </div>
        {/* Whereabouts: the scene's free-text place (a ship, the black) when the
            narrator set one, else the fixed station; the station shows as context. */}
        <div className="text-neutral-200">{sceneCard?.place ?? loc?.name ?? "Unknown"}</div>
        {sceneCard?.place && loc?.name && !sceneCard.place.includes(loc.name) && (
          <div className="text-[11px] text-neutral-600">near {loc.name}</div>
        )}

        {/* The live scene: what's happening, who's here, what's been established. */}
        {sceneCard?.situation && (
          <p className="mt-1 text-[12px] italic leading-snug text-neutral-300">{sceneCard.situation}</p>
        )}
        {sceneCard && sceneCard.presentNpcIds.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {sceneCard.presentNpcIds.map((id) => {
              const npc = state.npcs.find((n) => n.id === id);
              return npc ? (
                <span
                  key={id}
                  className="rounded border border-edge bg-ink/40 px-1.5 py-0.5 text-[11px] text-neutral-300"
                  title={npc.oneBreath}
                >
                  {npc.name}
                </span>
              ) : null;
            })}
          </div>
        )}
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

        {active.length > 0 && (
          <div className="mt-1.5 border-t border-edge/60 pt-1.5">
            <div className="text-[10px] uppercase tracking-wide text-neutral-600">Open threads</div>
            {active.slice(0, 4).map((t) => (
              <div key={t.id} className="mt-0.5 text-[12px] text-neutral-400">
                • {t.title}
              </div>
            ))}
          </div>
        )}
      </div>

      {contacts.length > 0 && (
        <div className="rounded border border-edge p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Contacts</div>
          <div className="space-y-1">
            {contacts.map(({ npc, rel }) => (
              <div key={npc.id} className="flex items-baseline justify-between gap-2" title={rel.lastNote ? `Last: ${rel.lastNote}` : npc.oneBreath}>
                <span className="truncate text-[13px] text-neutral-200">
                  {npc.name}
                  {rel.relationship && <span className="text-neutral-500"> · {rel.relationship}</span>}
                </span>
                <span
                  className={
                    "shrink-0 text-[11px] " +
                    (rel.disposition > 0 ? "text-good" : rel.disposition < 0 ? "text-bad" : "text-neutral-500")
                  }
                >
                  {dispositionLabel(rel.disposition)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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

      <SheetSection label="Skills — all you can attempt">
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

/** Popup — story & extended info, kept out of the always-on rail. */
function DetailsModal({
  character,
  onClose,
}: {
  character: CampaignState["characters"][number];
  onClose: () => void;
}) {
  const c = character;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={onClose}>
      <div
        className="scrollbar-thin max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-panel p-5 text-[13px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-100">{c.name}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-accent" aria-label="Close">
            ✕
          </button>
        </div>
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
      </div>
    </div>
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
