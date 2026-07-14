/**
 * Deterministic NPC flavor — a personality quirk and a light backstory hook.
 *
 * NPCs are universe-shared, so their character must be STABLE and canonical: every
 * player who meets the same NPC sees the same person. Both facets are seeded off the
 * NPC's id (engine-owned, free, no LLM) and assigned once at registration.
 *
 * - `quirk`     = a demeanor + a tell the narrator plays so the NPC is recognizable.
 * - `backstory` = a want + a complication — a light hook a future quest can hang on
 *                 (kept role-agnostic so it never contradicts an NPC's job/faction).
 */

const DEMEANORS = [
  "Wary and slow to trust",
  "Warm on the surface, always working an angle",
  "Brash and too loud for the room",
  "Deadpan and unhurried",
  "Jittery, eyes always on the exits",
  "Cold and precise, wastes no words",
  "Folksy and disarming, sharper than they look",
  "Bitter, nursing an old grudge",
  "Restless, hates standing still",
  "Unshakably calm, even when it's bad",
  "Proud and easily insulted",
  "Tired, has seen too much",
  "Cheerful in a way that never reaches the eyes",
  "Blunt to the point of rudeness",
  "Cautious, measures every word",
  "Reckless, grins at danger",
  "Soft-spoken, makes you lean in",
  "Suspicious of everyone, you included",
  "World-weary but still kind",
  "Twitchy and over-eager to please",
];

const TELLS = [
  "answers a question with a question",
  'never uses your name — only "friend"',
  "counts something under their breath when thinking",
  "cleans a sidearm they never draw",
  "quotes regulations nobody else follows",
  "chews a stim-stick down to the filter",
  "taps out a rhythm on the nearest surface",
  "name-drops people you've never heard of",
  "talks about their ship like it's a person",
  "can't stop straightening things",
  "laughs a beat too late at their own jokes",
  "trails off mid-sentence and stares",
  "haggles on reflex, even over nothing",
  "keeps score of every favor owed",
  "speaks in ship-and-cargo metaphors",
  "flinches at loud noises, then covers it",
  "is always eating something",
  "repeats your last few words back to you",
  "sizes up your gear before your face",
  "hums old spacer shanties without noticing",
  "never sits with their back to a door",
  "cracks knuckles one at a time before talking",
  "drops into a second language when rattled",
  "pockets a small trinket off every deal",
  "checks a battered chrono every few minutes",
  "calls everyone by their faction, not their name",
  "over-explains the simplest things",
  "goes very still when they lie",
  "offers you a drink before any bad news",
  "keeps a running tally of who's watching",
];

/** What the NPC wants — a latent quest goal. Role-agnostic so it fits any job. */
const DRIVES = [
  "wants off this station for good",
  "is scraping together the price of a ship of their own",
  "wants back into the faction that cast them out",
  "is hunting whoever burned them",
  "wants a name clean enough to start over",
  "is trying to buy someone they love out of a bad debt",
  "wants one big score to disappear on",
  "is chasing a rumor of a wreck worth a fortune",
  "wants to prove they're more than the work they do",
  "is looking for a way out from under the Crown's thumb",
  "is quietly building leverage over people above them",
  "wants to find someone who went missing in the Shear",
  "is trying to keep a failing business afloat one more month",
  "wants revenge they can't afford to take yet",
];

/** The complication a quest hangs on — pairs with any drive. */
const HOOKS = [
  "but owes the wrong people and the clock is running",
  "and is sitting on information someone would kill to bury",
  "though a past job left them a dangerous enemy",
  "but someone from their old life just turned up",
  "and can't move the one thing that would pay for it",
  "though they're being watched and they know it",
  "but the only way through runs past a debt they can't cover",
  "and the one person who can help wants a price they hate",
  "though they're one mistake from losing everything",
  "but they made a promise they can't keep alone",
  "and the Sable Chain has started asking about them",
  "though the favor they'd need to call in isn't free",
];

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
 * A stable light backstory — a want + a complication, i.e. a latent quest hook.
 * Role-agnostic so it never contradicts the NPC's job or faction (~170 combos).
 */
export function generateBackstory(seed: string): string {
  const key = (seed || "npc").trim().toLowerCase();
  const drive = pick(DRIVES, "drive:" + key);
  return `${drive.charAt(0).toUpperCase()}${drive.slice(1)}, ${pick(HOOKS, "hook:" + key)}.`;
}

/** Both facets at once — used when an NPC is first registered. */
export function generateNpcFlavor(seed: string): { quirk: string; backstory: string } {
  return { quirk: generateQuirk(seed), backstory: generateBackstory(seed) };
}
