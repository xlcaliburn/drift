import type { ChoiceOption } from "@/shared/turnPlan";

/**
 * Presentation registry for ENGINE-owned chips — the deterministic suggested
 * actions the engine applies directly (no LLM math). Keyed by which ChoiceOption
 * field the chip carries. Adding a new chip kind = one entry here; PlayClient
 * renders icon/tooltip/styling from this registry and forwards the whole choice
 * to /api/turn, so it never needs editing for a new kind.
 */
export interface ChipKind {
  /** Which chips this kind matches (first match wins). */
  match: (c: ChoiceOption) => boolean;
  /** Leading icon shown on the chip. */
  icon: string;
  /** Hover tooltip. Skill-check chips build their own from `check` instead. */
  tip?: string;
}

export const CHIP_KINDS: ChipKind[] = [
  {
    match: (c) => !!c.useItemId,
    icon: "🎒",
    tip: "Use this item — the engine applies it immediately.",
  },
  { match: (c) => !!c.swapDrop || !!c.swapDecline, icon: "🎒" },
  {
    match: (c) => !!c.repairHull,
    icon: "🔧",
    tip: "Repair the hull at the dock — the engine charges ¢12/HP (credit extended if short).",
  },
  {
    match: (c) => !!c.patronRest,
    icon: "🛟",
    tip: "Your patron patches you up for free — full HP & hull, a stim or two, a small stipend if you're broke. Offered while you're still finding your feet.",
  },
  {
    match: (c) => !!c.confirmDeath,
    icon: "☠",
    tip: "End this character for good — their story is over and you can start a new one. This cannot be undone.",
  },
  {
    match: (c) => !!c.recruitNpc,
    icon: "🤝",
    tip: "Sign them onto your crew — they fight beside you and draw a wage every tenday. Berths are limited by your hull.",
  },
];

/** The engine-chip kind a choice belongs to, or undefined for a plain narrative
 *  choice (rendered without the engine styling). */
export function chipKind(c: ChoiceOption): ChipKind | undefined {
  return CHIP_KINDS.find((k) => k.match(c));
}
