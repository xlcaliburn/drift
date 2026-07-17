import type { Section } from "./types";

/**
 * ESTABLISHED FACTS (CONTINUITY.md v2 — the durable ledger). Standing facts the
 * engine has recorded that outlive scenes: struck deal terms, appointments,
 * bans, debts. Fed back every turn so the narrator can't renegotiate a settled
 * deal or forget a scheduled meeting once it left the history window.
 */
export const establishedFacts: Section = ({ memory }) => {
  const facts = memory?.facts ?? [];
  if (!facts.length) return [];
  // Pinned (load-bearing) facts first — same ordering otherwise; no other visual change.
  const ordered = [...facts].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const lines = ordered.map((f) => `  - ${f.text}${f.tenday != null ? ` (tenday ${f.tenday})` : ""}`);
  return [
    `ESTABLISHED FACTS (durable canon — honor these exactly; they do NOT expire with scenes. A deal's terms stay struck until a scene DELIBERATELY changes them — then record the change via "facts"):\n${lines.join("\n")}`,
    ``,
  ];
};
