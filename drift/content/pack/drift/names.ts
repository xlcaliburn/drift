import type { PackNames } from "../types";

/**
 * Mixed-origin given names + surnames that fit a hard, polyglot frontier. Kept
 * grounded — no fantasy apostrophe-soup. `suggestName()` (content/examples.ts)
 * combines them; a handful double as lone-callsign names some spacers go by.
 * Modularity M1 Task B — moved verbatim from content/examples.ts (order/length
 * pinned by content/examples.test.ts; suggestName hashes by pool INDEX).
 */
export const driftNames: PackNames = {
  given: [
    "Silas", "Rell", "Denna", "Josen", "Kira", "Marn", "Tovic", "Cassin",
    "Ana", "Corwin", "Yuki", "Dax", "Neve", "Osei", "Lena", "Bram", "Ravi",
    "Sena", "Cato", "Mira", "Halden", "Nadia", "Emil", "Zara", "Piotr", "Ludo",
    "Iona", "Garrick", "Sol", "Tamsin", "Voss", "Ekko", "Wren", "Isko", "Perla",
  ],
  surnames: [
    "Karo", "Corr", "Vantry", "Okonkwo", "Reyes", "Ashfall", "Dresch", "Vale",
    "Kessler", "Marlow", "Sung", "Bellamy", "Draeve", "Novak", "Orsini", "Halloran",
    "Cray", "Voung", "Sabatch", "Renfield", "Duross", "Machado", "Teller", "Volkov",
    "Amari", "Sallow", "Quist", "Bex", "Radek", "Nyx", "Calloway", "Osei",
  ],
  mononyms: [
    "Rook", "Ash", "Ghost", "Deuce", "Slate", "Vane", "Cinder", "Mox", "Fen",
    "Talon", "Riven", "Sparrow", "Coll", "Nix",
  ],
};
