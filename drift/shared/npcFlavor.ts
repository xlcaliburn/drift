import { pack } from "@/content/pack";

/**
 * Deterministic NPC flavor — a physical description, a personality quirk, a
 * speech pattern, and a backstory (origin + want + complication).
 *
 * NPCs are universe-shared, so their character must be STABLE and canonical: every
 * player who meets the same NPC sees the same person. All facets are seeded off the
 * NPC's id (engine-owned, free, no LLM) and assigned once at registration.
 *
 * - `appearance` = build + AGE BAND + face/hair + one distinguishing mark — the
 *                  FIXED physical description, so the narrator can't re-invent the
 *                  same person's body (or age) scene to scene (the live failure:
 *                  an NPC's look drifting — scarred one scene, unmarked the next;
 *                  "the old man" drifting young).
 * - `quirk`      = a demeanor + a tell the narrator plays so the NPC is recognizable.
 * - `voice`      = HOW they talk — sentence rhythm, formality, slang — so the same
 *                  dockworker doesn't speak like a poet one scene and a soldier
 *                  the next.
 * - `backstory`  = an origin + a want + a complication — where they came from and
 *                  what they're after; a hook a future quest can hang on (kept
 *                  role-agnostic so it never contradicts an NPC's job/faction).
 *
 * The pools themselves live in the PACK (Modularity M1 Task C —
 * content/pack/drift/npcFlavor.ts): a world reboot can retune the CONTENT
 * freely, but never the pool COUNT or ORDER — every pick below hashes an NPC's
 * id into a pool by INDEX, and many call sites are render-time fallbacks
 * (world.ts recomputes for a seed NPC with no persisted value, every turn), so
 * a reordered/resized pool would silently change what a live campaign shows.
 */

const { demeanors: DEMEANORS, tells: TELLS, drives: DRIVES, hooks: HOOKS, builds: BUILDS, faces: FACES, marks: MARKS, ages: AGES, voices: VOICES, origins: ORIGINS } = pack.npcFlavor;

/** FNV-1a 32-bit — a stable, fast string hash (no deps, deterministic). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pick = <T>(arr: T[], seed: string): T => arr[hash32(seed) % arr.length];

/**
 * A stable one-line quirk — a demeanor + a tell. Seed off the NPC's id. Two
 * independent hashes vary the facets freely (~600 combinations).
 */
export function generateQuirk(seed: string): string {
  const key = (seed || "npc").trim().toLowerCase();
  return `${pick(DEMEANORS, key)}; ${pick(TELLS, "tell:" + key)}.`;
}

/**
 * A stable physical description — build + age band + face/hair + one
 * distinguishing mark (~14000 combinations). The narrator DESCRIBES from this
 * and never re-invents it: the same person is scarred (and the same AGE) in
 * every scene, not just the one that coined it.
 */
export function generateAppearance(seed: string): string {
  const key = (seed || "npc").trim().toLowerCase();
  const build = pick(BUILDS, "build:" + key);
  return `${build.charAt(0).toUpperCase()}${build.slice(1)}, ${pick(AGES, "age:" + key)}, with ${pick(FACES, "face:" + key)} and ${pick(MARKS, "mark:" + key)}.`;
}

/**
 * A stable speech pattern — HOW they talk, not what they say (~14 options).
 * Distinct from `quirk`'s demeanor+tell: this pins sentence rhythm, formality,
 * and slang so the narrator can't drift a dockworker's voice from soldier to
 * poet scene to scene.
 */
export function generateVoice(seed: string): string {
  const key = (seed || "npc").trim().toLowerCase();
  return pick(VOICES, "voice:" + key);
}

/**
 * A stable backstory — an origin + a want + a complication (~2000 combos): where
 * they came from, what they're after, and the snag a quest can hang on.
 * Role-agnostic so it never contradicts the NPC's job or faction.
 */
export function generateBackstory(seed: string): string {
  const key = (seed || "npc").trim().toLowerCase();
  const drive = pick(DRIVES, "drive:" + key);
  return `${pick(ORIGINS, "origin:" + key)}. ${drive.charAt(0).toUpperCase()}${drive.slice(1)}, ${pick(HOOKS, "hook:" + key)}.`;
}

/** All facets at once — used when an NPC is first registered. */
export function generateNpcFlavor(seed: string): { quirk: string; backstory: string; appearance: string; voice: string } {
  return {
    quirk: generateQuirk(seed),
    backstory: generateBackstory(seed),
    appearance: generateAppearance(seed),
    voice: generateVoice(seed),
  };
}
