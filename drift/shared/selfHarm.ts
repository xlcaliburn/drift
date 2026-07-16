/**
 * Intentional self-harm / suicide intent in a typed player action.
 *
 * DRIFT narrates in the second person ("you"), so the player targets their OWN
 * character with EITHER "myself"/"my …" OR "yourself"/"your …" — both mean the PC.
 * When a player clearly moves to end their own character, the engine intercepts and
 * offers an explicit "end this character?" confirmation instead of letting the cheap
 * narrator improvise skill checks around a suicide — the live Silas Cray case, where
 * a throat-slit got resolved as an `electronics` roll and a narrated death the engine
 * never actually applied (HP stayed at 1).
 *
 * Deliberately TIGHT: a LETHAL verb aimed at the self, or an unmistakable suicide
 * phrase. Ordinary reflexives ("brace myself", "keep to myself", "throw myself at
 * the guard") never match — they carry no lethal verb aimed at the self.
 */

/** A self-target: reflexive, or a vital body part owned by "my"/"your" (= the PC). */
const SELF =
  "(?:myself|yourself|my own|your own|my (?:throat|wrists?|neck|head|skull|heart|chest|temple)|your (?:throat|wrists?|neck|head|skull|heart|chest|temple))";
/** A lethal action verb/phrase. */
const LETHAL =
  "(?:kill|shoot|stab|slit|slice|slash|cut|gut|hang|strangle|choke|impale|plunge|drive (?:the|my|your) (?:blade|knife|dagger)|blow (?:my|your) brains|put a (?:bullet|round|slug)|pull the trigger)";

/** Lethal verb then self-target (or the reverse), within a short window so an
 *  unrelated later clause can't glue a false positive together. */
const LETHAL_THEN_SELF = new RegExp(`\\b${LETHAL}\\b[\\s\\S]{0,24}?\\b${SELF}\\b`, "i");
const SELF_THEN_LETHAL = new RegExp(`\\b${SELF}\\b[\\s\\S]{0,24}?\\b${LETHAL}\\b`, "i");

/** Unmistakable suicide phrasings that need no separate target. */
const SUICIDE_PHRASE =
  /\b(?:kill(?:ing)?\s+myself|commit(?:ting)?\s+suicide|suicide|end\s+my\s+(?:own\s+)?life|take\s+my\s+own\s+life|off\s+myself|end\s+it\s+all|slit\s+my\s+wrists?|i\s+want\s+to\s+die|i\s+wish\s+i\s+(?:was|were)\s+dead|let\s+me\s+die)\b/i;

/**
 * True when the player's typed action is a clear attempt to end their own
 * character. The engine turns this into an explicit confirmation gate.
 */
export function isSelfHarm(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 3) return false;
  if (SUICIDE_PHRASE.test(t)) return true;
  return LETHAL_THEN_SELF.test(t) || SELF_THEN_LETHAL.test(t);
}
