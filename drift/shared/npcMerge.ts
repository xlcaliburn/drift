import type { Npc } from "@/shared/schemas";

/**
 * Merge the universe cast loaded from the npcs table (`table`) with a campaign's
 * legacy per-campaign runtime NPCs (`legacy`). The table is authoritative: since
 * migration 014, generated + backstory NPCs are promoted into the shared npcs
 * table, so a table row and an older runtime copy can coexist under the same NAME
 * with different ids. Dedupe by name, table row wins — the legacy copy only
 * survives when nothing in the table matches it (back-compat for campaigns saved
 * before the promotion landed). Pure so it can be tested without a DB.
 */
export function mergeNpcs(table: Npc[], legacy: Npc[]): Npc[] {
  const seenNames = new Set(table.map((n) => n.name.toLowerCase()));
  const out = [...table];
  for (const n of legacy) {
    const key = n.name.toLowerCase();
    if (seenNames.has(key)) continue; // table row wins
    seenNames.add(key);
    out.push(n);
  }
  return out;
}
