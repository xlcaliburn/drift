"use client";

import { useState } from "react";
import type { CampaignState, Skill } from "@/shared/schemas";
import { tickMax } from "@/engine/progression";
import { shipIsOwned } from "@/shared/recap";
import skillsMeta from "@/content/skills.json";

/** Every skill in the game, merged with the character's levels (0 if unlearned),
 *  learned first — so the sheet shows the full range the player can attempt, not
 *  just what they've trained. */
function allSkillRows(owned: Skill[]): Skill[] {
  const bySkill = new Map(owned.map((s) => [s.name, s]));
  return Object.keys(skillsMeta.skills)
    .map((name) => bySkill.get(name) ?? { name, level: 0, ticks: 0 })
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

type Tab = "sheet" | "ship" | "map" | "clocks";

export default function Sidebar({
  state,
  mobileOpen = false,
  onClose,
}: {
  state: CampaignState;
  /** Mobile slide-over drawer control (desktop rail ignores these). */
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("sheet");

  const body = (
    <>
      <div className="flex border-b border-edge text-xs">
        {(["sheet", "ship", "map", "clocks"] as Tab[]).map((t) => (
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
        {tab === "sheet" && <SheetTab state={state} />}
        {tab === "ship" && <ShipTab state={state} />}
        {tab === "map" && <MapTab state={state} />}
        {tab === "clocks" && <ClocksTab state={state} />}
      </div>
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

function SheetTab({ state }: { state: CampaignState }) {
  return (
    <div className="space-y-4">
      {state.characters.map((c) => (
        <div key={c.id} className="rounded border border-edge p-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-neutral-100">{c.name}</span>
            <span className="text-neutral-500">
              {c.kind === "pc" ? "You" : `loyalty ${c.loyalty}/5`}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-14 text-neutral-500">HP {c.hp}/{c.maxHp}</span>
            <Bar value={c.hp} max={c.maxHp} tone={c.hp / c.maxHp < 0.34 ? "bg-bad" : "bg-good"} />
          </div>
          <div className="mt-1 text-neutral-500">
            Armor Class {c.ac}
            {c.credits !== undefined && ` · ¢${c.credits}`}
            {c.fragile && <span className="text-bad"> · FRAGILE</span>}
          </div>
          {c.kind === "pc" && (
            <div className="mt-2 border-t border-edge pt-2">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">
                Skills <span className="text-neutral-600">— all you can attempt</span>
              </div>
              <div className="space-y-2">
                {allSkillRows(c.skills).map((s) => {
                  const learned = s.level > 0 || s.ticks > 0;
                  return (
                    <div key={s.name} className={learned ? "" : "opacity-45"}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] text-neutral-200">{humanizeSkill(s.name)}</span>
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
            </div>
          )}
        </div>
      ))}
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
