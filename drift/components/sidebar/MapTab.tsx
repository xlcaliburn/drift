"use client";

import { useState } from "react";
import type { CampaignState } from "@/shared/schemas";
import type { SceneCard } from "@/shared/scene";
import { routeBetween, riskColor, riskLabel } from "@/shared/routes";
import { MAP_LAYOUT } from "@/content/pack";

// ── Star map ────────────────────────────────────────────────────────────────
// A hand-authored stellar layout for the shared world's canonical locations,
// rendered dynamically from live state: the player's current location pulses,
// and any location id NOT in the curated layout falls back to an evenly-spaced
// ring so the map never breaks if the world's canon grows. Routes are NOT drawn
// by default — hover a location to preview the line, colored by that route's
// risk tier (shared/routes.ts), with the travel time.
const MAP_W = 260;
const MAP_H = 340;

// Node positions/colors are AUTHORED on the content pack's locations (`mapPos`);
// the ring fallback below still covers anything a pack forgets to place.

// Deterministic decorative starfield (no RNG — stable across renders).
const MAP_STARS = [
  { x: 30, y: 30, r: 0.8 }, { x: 220, y: 40, r: 1 }, { x: 160, y: 26, r: 0.7 },
  { x: 240, y: 130, r: 0.9 }, { x: 18, y: 150, r: 0.7 }, { x: 236, y: 210, r: 0.8 },
  { x: 40, y: 250, r: 1 }, { x: 150, y: 300, r: 0.7 }, { x: 230, y: 320, r: 0.9 },
  { x: 60, y: 180, r: 0.6 }, { x: 120, y: 90, r: 0.6 }, { x: 200, y: 170, r: 0.7 },
];

export function MapTab({ state, sceneCard }: { state: CampaignState; sceneCard?: SceneCard | null }) {
  const currentId = state.campaign.currentLocationId;
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
  // "In transit" — the free-text place doesn't match the pinned station's name (the
  // same signal the Status tab's "near {loc.name}" hint already uses). currentLocationId
  // only changes at the MOMENT of arrival, so while traveling the map still anchors
  // on the departure station; this is honest about that rather than guessing a
  // destination no engine signal actually names yet.
  const inTransit = !!(
    sceneCard?.place &&
    current?.name &&
    !sceneCard.place.toLowerCase().includes(current.name.toLowerCase())
  );

  const currentPos = currentId ? positions.get(currentId) : undefined;
  const hoveredPos = hoveredId ? positions.get(hoveredId) : undefined;
  const hoveredRoute =
    hoveredId && currentId && hoveredId !== currentId ? routeBetween(currentId, hoveredId, state.locations) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Known space</div>
        <div
          className="cursor-help text-[11px] text-neutral-600"
          title="In-world time. Travel advances it — a longer, riskier route costs more tendays."
        >
          🕐 Tenday {state.campaign.tendaysElapsed ?? 0}
        </div>
      </div>
      <div className="rounded-lg border border-edge bg-ink/60 p-1">
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full" role="img" aria-label="Star map of known space">
          {MAP_STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#2a3342" opacity={0.7} />
          ))}

          {/* Hover-revealed route: no lines by default — hovering a location previews
              the trip there from wherever you're pinned now, colored by risk. */}
          {currentPos && hoveredPos && hoveredRoute && (
            <g pointerEvents="none">
              <line
                x1={currentPos.x}
                y1={currentPos.y}
                x2={hoveredPos.x}
                y2={hoveredPos.y}
                stroke={riskColor(hoveredRoute.risk)}
                strokeWidth={1.6}
                strokeDasharray="3 3"
                opacity={0.9}
              />
              <text
                x={(currentPos.x + hoveredPos.x) / 2}
                y={(currentPos.y + hoveredPos.y) / 2 - 4}
                textAnchor="middle"
                fontSize={8}
                fontWeight={600}
                fill={riskColor(hoveredRoute.risk)}
                stroke="#0b0e14"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                {hoveredRoute.tendays === 0 ? "local" : `${hoveredRoute.tendays} tenday${hoveredRoute.tendays > 1 ? "s" : ""}`} · {riskLabel(hoveredRoute.risk)}
              </text>
            </g>
          )}

          {/* Location nodes; the current one is enlarged with a pulsing ring (a
              second, wider dashed ring while in transit). Hover any node to preview
              the route line above. */}
          {state.locations.map((l) => {
            const p = positions.get(l.id);
            if (!p) return null;
            const isCurrent = l.id === currentId;
            const isHovered = l.id === hoveredId;
            return (
              <g
                key={l.id}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredId(l.id)}
                onMouseLeave={() => setHoveredId((h) => (h === l.id ? null : h))}
              >
                <title>
                  {l.name}
                  {!isCurrent && currentId
                    ? ` — ${(() => {
                        const r = routeBetween(currentId, l.id, state.locations);
                        return `${r.tendays === 0 ? "local hop" : `${r.tendays} tenday${r.tendays > 1 ? "s" : ""}`}, ${riskLabel(r.risk).toLowerCase()}`;
                      })()}`
                    : ""}
                </title>
                {isCurrent && (
                  <>
                    <circle cx={p.x} cy={p.y} r={11} fill="none" stroke="#e8a33d" strokeWidth={1.5} opacity={0.6} className="animate-pulse" />
                    {inTransit && (
                      <circle cx={p.x} cy={p.y} r={17} fill="none" stroke="#6fb0e8" strokeWidth={1} strokeDasharray="2 3" opacity={0.75} className="animate-pulse" />
                    )}
                  </>
                )}
                {/* A generous invisible hit-area — the visible dot is small, but
                    hovering "the name" should feel forgiving, not pixel-perfect. */}
                <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isCurrent ? 6 : 4}
                  fill={p.color}
                  stroke={isCurrent ? "#e8a33d" : isHovered ? "#fff" : "#0b0e14"}
                  strokeWidth={isCurrent || isHovered ? 2 : 1}
                />
                <text
                  x={p.x}
                  y={p.y + 15}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isCurrent ? "#e8a33d" : isHovered ? "#fff" : "#9aa3b2"}
                  fontWeight={isCurrent || isHovered ? 600 : 400}
                >
                  {l.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {inTransit && (
        <div className="rounded border border-accent/40 bg-accent/5 px-2 py-1 text-[11px] text-accent">
          ✈ In transit — {sceneCard?.place}
        </div>
      )}

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
