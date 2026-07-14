/**
 * Engine backstop for NPC continuity: pull proper-noun names out of the turn's
 * narration so a figure the narrator FORGOT to declare (Eddie's "wrecker woman",
 * Draven's enforcers) still gets registered and shown as present. Precision over
 * recall — a spurious NPC pollutes the cast, so this filters hard against known
 * entities + a stopword list, and single-word names must appear mid-sentence
 * (not just as sentence-initial capitalization).
 */

/** Capitalized words that are almost never a person's name in this prose. */
const NAME_STOPWORDS = new Set([
  "the", "you", "your", "yours", "a", "an", "i", "it", "its", "they", "them", "their", "he", "him", "his",
  "she", "her", "hers", "we", "us", "our", "this", "that", "these", "those", "there", "then", "here", "now",
  "but", "and", "or", "so", "if", "as", "at", "in", "on", "of", "to", "for", "with", "from", "by", "when",
  "what", "who", "why", "how", "no", "not", "yes", "one", "two", "three", "some", "someone", "something",
  "nothing", "nobody", "everyone", "still", "just", "even", "only", "before", "after", "behind", "above",
  "below", "inside", "outside", "across", "around", "beyond", "back", "off", "up", "down", "out", "over",
  "warning", "danger", "combat", "credits", "ac", "hp",
]);

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
