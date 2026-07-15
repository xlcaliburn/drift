"use client";

import type { CampaignState } from "@/shared/schemas";

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

export function MapTab({ state }: { state: CampaignState }) {
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
