"use client";

import type { ReactNode } from "react";
import type { UniqueSkill } from "@/shared/schemas";
import { backgrounds } from "@/content/creation";

/** Tiny presentational primitives + formatters shared across the sidebar tabs. */

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
export const bgLabel = (id?: string) => backgrounds.find((b) => b.id === id)?.label ?? (id ? cap(id) : "");

/** Compact effect line for a signature (unique) skill. */
export function sigLine(sig: UniqueSkill): string {
  return sig.kind === "passive"
    ? `+${sig.passiveAmount} ${sig.passiveTarget}`
    : `nat-20 · ${sig.triggerScenario ?? ""}`;
}

export function Bar({
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

export function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 border-t border-edge pt-2">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

export function TraitRow({ k, v, tip }: { k: string; v?: string; tip?: string }) {
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
export function condition(injuries?: { name: string }[]): { text: string; className: string } | null {
  if (injuries?.some((i) => i.name === "Dead")) return { text: "☠ DECEASED", className: "text-bad" };
  if (injuries?.some((i) => i.name === "Downed")) return { text: "DOWNED", className: "text-bad" };
  return null;
}
