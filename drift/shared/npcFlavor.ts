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

// ── Appearance pools (build × face/hair × one distinguishing mark) ───────────
// Deliberately sex/age-neutral wording: an NPC's sex is the model's to establish
// in the fiction (and many never need one) — the FIXED parts are the physique,
// the face, and the mark, so a described person can never silently change body.

const BUILDS = [
  "wiry and quick-moving",
  "broad-shouldered and heavyset",
  "tall and rangy",
  "short and solid",
  "lean and angular",
  "stocky, built like a cargo loader",
  "slight, almost delicate",
  "big-framed but slow-moving",
  "compact and coiled, a fighter's build",
  "soft-bodied, more desk than deck",
  "gaunt, all tendon and bone",
  "average build that disappears in a crowd",
];

const FACES = [
  "a shaved head and heavy brows",
  "grey-streaked hair pulled back tight",
  "a weathered, sun-cracked face",
  "close-cropped dark hair and sharp cheekbones",
  "a round, open face that hides nothing",
  "deep-set eyes under a mess of unkempt hair",
  "a long face with a crooked, often-broken nose",
  "pale eyes that don't blink enough",
  "a jaw like a bulkhead and a flattened ear",
  "fine features gone hard around the mouth",
  "a lined face and steel-colored stubble of hair",
  "dark, watchful eyes and a widow's peak",
  "a boxer's brow and knuckle-scarred hands",
  "hollow cheeks and lank, colorless hair",
];

const MARKS = [
  "a burn scar climbing one side of the neck",
  "a cheap chrome prosthetic left hand",
  "faction ink, half lasered off, on one forearm",
  "a milky, sightless left eye",
  "a missing ring finger",
  "an old blast scar across the scalp where hair won't grow",
  "a dockworker's stoop and rope-scarred palms",
  "a voice box implant that flattens every word",
  "a limp favoring the right leg",
  "vacuum-frost mottling up both wrists",
  "a jagged scar through one eyebrow",
  "teeth capped in mismatched alloy",
  "a tremor in the left hand they try to hide",
  "old shrapnel pocking one cheek",
];

// ── Age bands, folded into appearance (not a separate field/column) ──────────
const AGES = [
  "young, barely past apprentice age",
  "in their late twenties",
  "in their thirties",
  "mid-forties and weathered",
  "in their fifties",
  "grey and past sixty",
  "old enough that people wonder how they've lasted this long",
];

// ── Voice pools — HOW they talk, distinct from quirk's demeanor+tell ─────────
const VOICES = [
  "clipped sentences, dock slang thick enough to cut",
  "over-formal, never contracts a word",
  "a slow drawl, picks every word with care",
  "rapid-fire, swallows the ends of words",
  "spacer cant nobody outside the lanes would follow",
  "quiet, makes you lean in to catch it",
  "florid, loves a metaphor more than a straight answer",
  "blunt monosyllables, nothing wasted",
  "constant low profanity, oddly warm underneath it",
  "answers questions with questions of their own",
  "talks about themselves in the third person",
  "quotes prices and odds for everything, even feelings",
  "old lane-freighter slang, half of it decades out of date",
  "precise, like reading off a manifest",
];

/** Where they came from — the past that shaped them. Role-agnostic like DRIVES. */
const ORIGINS = [
  "Grew up in the gutter-decks of a Crown station and clawed out",
  "Was born shipside and has never held still since",
  "Served a faction for years and left with scars instead of a pension",
  "Came up through a salvage crew that didn't all make it back",
  "Once had money and a name, and lost both fast",
  "Was raised by dock folk who taught them every angle",
  "Survived a decompression accident that took people they knew",
  "Ran cargo through the lanes until a bad manifest ended that life",
  "Buried a partner young and never took another",
  "Was somebody's enforcer once, and doesn't talk about it",
  "Jumped ship at this station years ago and never left",
  "Came out from the inner worlds chasing a debt that outran them",
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
