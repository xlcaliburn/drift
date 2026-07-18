/**
 * Creation-flavor MECHANICS: pure functions over the pack's name pools and
 * example gallery (Modularity M1 Task B moved the actual DATA into
 * content/pack/drift/{names,examples}.ts — this file is now a facade so every
 * existing `@/content/examples` import keeps working unchanged).
 */

import { pack } from "./pack";

export const GIVEN_NAMES = pack.names.given;
export const SURNAMES = pack.names.surnames;
export const MONONYMS = pack.names.mononyms;

/**
 * Deterministic-free name suggestion. `seed` (0..1) is provided by the caller
 * (e.g. Math.random() in the browser) so this stays a pure function usable on
 * the server or in tests. ~1 in 6 suggestions is a lone callsign.
 */
export function suggestName(seed: number): string {
  const r = (n: number) => Math.floor(seed * 100003 * (n + 1)) % n; // cheap spread
  if (r(6) === 0) return MONONYMS[r(MONONYMS.length)];
  return `${GIVEN_NAMES[r(GIVEN_NAMES.length)]} ${SURNAMES[r(SURNAMES.length)]}`;
}

export type ExampleSkill = (typeof pack.examples.skills)[number];

export const exampleSkills = pack.examples.skills;
export const exampleMoralCodes = pack.examples.moralCodes;
export const exampleLosses = pack.examples.losses;
export const exampleTies = pack.examples.ties;
export const exampleTells = pack.examples.tells;

/**
 * Deterministic sample of `n` items from `arr`, seeded by an integer. Seed 0
 * yields a stable first result (safe for SSR — no hydration mismatch); bumping
 * the seed reshuffles. Pure, so the same seed always gives the same picks.
 */
export function sample<T>(arr: readonly T[], n: number, seed: number): T[] {
  const a = arr.slice();
  let s = (seed * 2654435761 + 1) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}
