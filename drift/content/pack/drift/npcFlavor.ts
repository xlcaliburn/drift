import type { PackNpcFlavor } from "../types";

/**
 * NPC flavor pools — a physical description, a personality quirk, a speech
 * pattern, and a backstory hook. Moved verbatim from shared/npcFlavor.ts
 * (Modularity M1 Task C). ⚠ ORDER-SENSITIVE — see PackNpcFlavor's comment in
 * types.ts and HANDOFF_MODULARITY_M1.md's named trap: shared/npcFlavor.test.ts
 * pins exact strings for known ids so this move is provably byte-identical.
 */
export const driftNpcFlavor: PackNpcFlavor = {
  demeanors: [
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
  ],

  tells: [
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
  ],

  // What the NPC wants — a latent quest goal. Role-agnostic so it fits any job.
  drives: [
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
  ],

  // The complication a quest hangs on — pairs with any drive.
  hooks: [
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
  ],

  // Deliberately sex/age-neutral wording: an NPC's sex is the model's to
  // establish in the fiction (and many never need one) — the FIXED parts are
  // the physique, the face, and the mark, so a described person can never
  // silently change body.
  builds: [
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
  ],

  faces: [
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
  ],

  marks: [
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
  ],

  // Age bands, folded into appearance (not a separate field/column).
  ages: [
    "young, barely past apprentice age",
    "in their late twenties",
    "in their thirties",
    "mid-forties and weathered",
    "in their fifties",
    "grey and past sixty",
    "old enough that people wonder how they've lasted this long",
  ],

  // HOW they talk, distinct from quirk's demeanor+tell.
  voices: [
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
  ],

  // Where they came from — the past that shaped them. Role-agnostic like drives.
  origins: [
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
  ],
};
