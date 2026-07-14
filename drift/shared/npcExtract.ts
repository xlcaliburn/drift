/**
 * Engine backstop for NPC continuity: pull proper-noun names out of the turn's
 * narration so a figure the narrator FORGOT to declare (Eddie's "wrecker woman",
 * Draven's enforcers) still gets registered and shown as present. Precision over
 * recall — a spurious NPC pollutes the cast, so this filters hard against known
 * entities + a stopword list, and single-word names must appear mid-sentence
 * (not just as sentence-initial capitalization).
 */

/** Capitalized words that are almost never a person's name in this prose. A cheap
 *  narrator dumps sentence-initial words into the npcs field ("End", "Get", "Sixty",
 *  "You're"), so this list also covers common verbs, contractions, and number words. */
const NAME_STOPWORDS = new Set([
  "the", "you", "your", "yours", "a", "an", "i", "it", "its", "they", "them", "their", "he", "him", "his",
  "she", "her", "hers", "we", "us", "our", "this", "that", "these", "those", "there", "then", "here", "now",
  "but", "and", "or", "so", "if", "as", "at", "in", "on", "of", "to", "for", "with", "from", "by", "when",
  "what", "who", "why", "how", "no", "not", "yes", "some", "someone", "something",
  "nothing", "nobody", "everyone", "still", "just", "even", "only", "before", "after", "behind", "above",
  "below", "inside", "outside", "across", "around", "beyond", "back", "off", "up", "down", "out", "over",
  "warning", "danger", "combat", "credits", "ac", "hp",
  // Common verbs a sentence can open with (and the model mis-lists as a name).
  "get", "got", "go", "goes", "come", "comes", "came", "take", "takes", "give", "gives", "stop", "stops",
  "wait", "keep", "keeps", "end", "ends", "start", "starts", "run", "runs", "move", "moves", "look", "looks",
  "find", "finds", "hold", "holds", "put", "set", "let", "lets", "make", "makes", "turn", "turns", "leave",
  "stay", "step", "steps", "walk", "pull", "push", "watch", "say", "says", "said", "tell", "tells", "ask",
  // Contractions the regex splits to a capitalized fragment.
  "you're", "i'm", "we're", "they're", "he's", "she's", "it's", "don't", "can't", "won't", "isn't", "that's",
  // Number words.
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
  "dozen", "first", "second", "third", "last", "next", "another", "each", "every", "any", "all", "none",
  // Interjections / adjectives a line can open with ("Good," she says).
  "good", "fine", "well", "right", "sure", "okay", "ok", "please", "thanks", "sorry", "hey", "listen",
  "maybe", "perhaps", "enough", "done", "wait", "hold", "easy", "steady", "quiet", "careful", "hurry",
  // The action-verb catalog (choice labels) the model mis-lists as NPCs.
  "examine", "loot", "scavenge", "search", "tend", "force", "climb", "sneak", "hack", "repair", "pilot",
  "spacewalk", "plot", "persuade", "lie", "threaten", "network", "endure", "attack", "flee", "aim", "cover",
]);

/**
 * Would this string pass as a person/NPC name worth registering? Rejects the junk
 * a sloppy narrator dumps into its npcs field: stopwords/verbs/numbers ("End",
 * "Get", "Sixty", "You're"), lowercase-led words, and anything that matches a
 * known NON-person entity (the ship, a location, a faction). `knownNonNpc` should
 * be knownEntityNames([...ship, ...locations, ...factions]).
 */
export function isPlausibleNpcName(name: string, knownNonNpc?: Set<string>): boolean {
  const trimmed = (name ?? "").trim().replace(/['’]s$/i, "").replace(/['’]$/i, "").trim();
  if (trimmed.length < 2) return false;
  if (!/^[A-Z]/.test(trimmed)) return false; // proper nouns start capitalized
  const lc = trimmed.toLowerCase();
  const words = lc.split(/\s+/);
  // Every word is a stopword/verb/number → not a name ("You're", "Get", "Sixty").
  if (words.every((w) => NAME_STOPWORDS.has(w))) return false;
  // Matches a known non-person entity (ship "Sparrow", a location, a faction).
  if (knownNonNpc && (knownNonNpc.has(lc) || words.every((w) => knownNonNpc.has(w)))) return false;
  return true;
}

/** Build the lookup of names already accounted for (case-insensitive), plus the
 *  individual words of multi-word entities so "Rook" filters against "Rook Station". */
export function knownEntityNames(names: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of names) {
    const n = raw.trim().toLowerCase();
    if (!n) continue;
    set.add(n);
    for (const w of n.split(/\s+/)) if (w.length >= 3) set.add(w);
  }
  return set;
}


/** Occupational person-roles a narrator names WITHOUT a proper noun ("the fixer",
 *  "the data broker", "the guard"). These are unambiguously people, so "the <role>"
 *  in the prose is a figure the player is dealing with — worth registering so they
 *  show up in the scene even before they get a name. Deliberately excludes generic
 *  words (man/woman/kid/figure) that over-match. */
const PERSON_ROLES = [
  "data broker", "broker", "fixer", "dealer", "smuggler", "merchant", "vendor", "trader", "quartermaster",
  "courier", "runner", "bartender", "barkeep", "bouncer", "innkeeper", "shopkeeper",
  "guard", "enforcer", "sentry", "mercenary", "gunman", "bodyguard", "soldier", "sniper",
  "captain", "pilot", "navigator", "engineer", "mechanic", "medic", "doctor", "technician", "operator",
  "officer", "inspector", "warden", "marshal", "detective", "constable",
  "informant", "handler", "fence", "forger", "hacker", "slicer", "smith",
  "foreman", "overseer", "administrator", "official", "envoy", "emissary", "diplomat",
  "priest", "prophet", "oracle", "bounty hunter", "hunter", "assassin",
];
/** Title-case a role phrase into a display handle ("data broker" → "Data Broker"). */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Verbs that attribute spoken dialogue to a speaker. A figure is registered ONLY
 *  when they clearly SPEAK, so passing mentions and dialogue CONTENT never become
 *  NPCs ("'Clean. Payout's on the tab.' She slides a chip" → nobody registered:
 *  the speaker is an unnamed "She", and "Clean" is just what was said). */
const SPEECH_VERBS = [
  "says", "said", "asks", "asked", "replies", "replied", "answers", "answered",
  "mutters", "muttered", "murmurs", "murmured", "growls", "growled", "snaps", "snapped",
  "whispers", "whispered", "warns", "warned", "tells", "told", "demands", "demanded",
  "insists", "insisted", "promises", "promised", "agrees", "agreed", "declares", "declared",
  "shouts", "shouted", "yells", "yelled", "hisses", "hissed", "barks", "barked",
  "sneers", "sneered", "drawls", "drawled", "grunts", "grunted", "chuckles", "scoffs",
  "laughs", "laughed", "continues", "continued", "cuts in", "chimes in",
];
const VERB_ALT = SPEECH_VERBS.join("|");
const NAME_PAT = `[A-Z][a-z'’]+(?:\\s+[A-Z][a-z'’]+){0,2}`;
const ROLE_ALT = [...PERSON_ROLES].sort((a, b) => b.length - a.length).join("|");
const ROLE_PAT = `(?:[a-z][a-z'’-]+\\s+)?(?:${ROLE_ALT})`;

/** Speaker-attribution patterns: name/role before a speech verb, after one, or a
 *  "Name:"-before-a-quote script form. Each capture group 1 is the speaker. */
const DIALOGUE_PATTERNS: { re: RegExp; role: boolean }[] = [
  { re: new RegExp(`\\b(${NAME_PAT})\\s+(?:${VERB_ALT})\\b`, "g"), role: false }, // Vex mutters
  { re: new RegExp(`\\b(?:${VERB_ALT})[,]?\\s+(${NAME_PAT})\\b`, "g"), role: false }, // says Vex
  { re: new RegExp(`\\b(?:the|a|an)\\s+(${ROLE_PAT})\\s+(?:${VERB_ALT})\\b`, "gi"), role: true }, // the fixer says
  { re: new RegExp(`\\b(?:${VERB_ALT})[,]?\\s+(?:to\\s+)?(?:the|a|an)\\s+(${ROLE_PAT})\\b`, "gi"), role: true }, // says the fixer
  { re: new RegExp(`\\b(${NAME_PAT})\\s*:\\s*["“]`, "g"), role: false }, // Vex: "…"
];

/** A figure found speaking in the narration: a proper-noun `handle`, or a role
 *  handle ("Fixer") carrying its `role` ("fixer"). */
export interface DialogueNpc {
  handle: string;
  role?: string;
}

/**
 * Register NPCs ONLY when the narration shows them in explicit dialogue — a named
 * or occupational-role speaker attributed to a line of speech. Deliberately
 * precise: dialogue content, pronoun speakers ("she says"), and passing mentions
 * never create NPCs. `known` filters out figures already tracked (they get
 * re-marked present elsewhere). Returns new speakers in first-seen order, capped.
 */
export function extractDialogueNpcs(narration: string, known: Set<string>, max = 3): DialogueNpc[] {
  const out: DialogueNpc[] = [];
  const seen = new Set<string>();
  for (const { re, role } of DIALOGUE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(narration)) !== null) {
      const raw = m[1].trim().replace(/\s+/g, " ");
      if (role) {
        const lc = raw.toLowerCase();
        if (seen.has(lc) || known.has(lc) || lc.split(" ").every((w) => known.has(w))) continue;
        seen.add(lc);
        out.push({ handle: titleCase(lc), role: lc });
      } else {
        const name = raw.replace(/['’]s$/i, "");
        const lc = name.toLowerCase();
        if (seen.has(lc) || known.has(lc) || !isPlausibleNpcName(name, known)) continue;
        seen.add(lc);
        out.push({ handle: name });
      }
      if (out.length >= max) return out;
    }
  }
  return out;
}
