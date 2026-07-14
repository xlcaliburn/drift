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

/**
 * Extract likely person-names from narration that aren't already known.
 * `known` should come from knownEntityNames(state entities). Returns unique
 * names in first-seen order, capped by `max`.
 */
export function extractNpcNames(narration: string, known: Set<string>, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /([A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+){0,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(narration)) !== null) {
    // Drop a trailing possessive so "Draven's" resolves to the known "Draven".
    const name = m[1].trim().replace(/['’]s$/i, "");
    const lc = name.toLowerCase();
    if (name.length < 3 || seen.has(lc)) continue;
    // Any word of the candidate is a stopword or a known entity → skip the whole.
    const words = lc.split(/\s+/);
    if (words.some((w) => NAME_STOPWORDS.has(w) || known.has(w)) || known.has(lc)) continue;
    // Multi-word capitalized phrases are almost always proper nouns. A single
    // word must appear MID-sentence — preceded by a lowercase letter, comma, dash,
    // or opening quote/paren (an appositive/dialogue name) — not at a sentence
    // start, where a stray capitalized adjective ("Cold sweat…") would false-match.
    const multiWord = words.length > 1;
    const preceding = narration.slice(0, m.index).replace(/\s+$/, "");
    const prevChar = preceding[preceding.length - 1] ?? "";
    const midSentence = /[a-z0-9,;:—–\-"'“‘(]/.test(prevChar);
    if (!multiWord && !midSentence) continue;
    seen.add(lc);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}
