import type { Location } from "./schemas";

/**
 * Engine-owned LOCATION SYNC (CHECKS.md §8) — the backstop for the last major
 * model-owned state write: `campaign.currentLocationId`'s only writer used to be
 * the model emitting `arrivedAtLocationId` inside sceneEnd, and it under-fires
 * like every other structured field. A live audit found 6 of 10 active campaigns
 * with the engine pinned to a DIFFERENT station than the fiction (Lyra "at
 * Meridian" while the scene played out in Halcyon's Rust Anchor) — which silently
 * re-breaks everything keyed on location: the scene header's station+danger tier
 * (the narrator gets told the wrong station every turn), retrieval's co-location
 * boost (wrong-station NPCs surface), the home-location presence gate (the RIGHT
 * station's NPCs get gated out), the local job board, travel tendays, transit
 * incidents, and market rotation.
 *
 * The fix reads the narrator's own `scene.place` line — which reliably follows a
 * "Station — spot" convention (all 10 live campaigns, no exceptions) — and lets
 * the ENGINE detect the arrival deterministically. The model's explicit
 * arrivedAtLocationId stays the primary path; this is the under-fire backstop,
 * same pattern as every other one in CHECKS.md.
 *
 * Precision over recall: a missed arrival self-heals on a later turn (the place
 * line keeps naming the station), but a FALSE arrival teleports the campaign — so
 * matches are full-name, word-boundary, and destination-phrases ("shuttle to
 * Halcyon", "bound for Rook Station") never count as being there.
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words that mark the location name as a DESTINATION being traveled toward, not a
 *  place the player is standing in. Checked immediately before the match (with an
 *  optional article), so "the shuttle to Halcyon" or "bound for the Nest" never
 *  reads as an arrival while "Halcyon — Berth 12" does. */
const DESTINATION_RE = /\b(?:to|toward|towards|for)\s+(?:the\s+)?$/i;

/**
 * Which canonical location the scene's `place` line says the player is AT, or
 * undefined when none can be inferred (transit, an unnamed spot, no place set).
 * When several location names appear ("Rook Station — Nest cargo bay"), the
 * EARLIEST match wins — the convention leads with the station; later names are
 * spot flavor. Ties on position prefer the longer (more specific) name.
 */
export function inferLocationFromPlace(
  place: string | undefined,
  locations: Location[],
): string | undefined {
  const text = place?.trim();
  if (!text) return undefined;

  let best: { id: string; pos: number; len: number } | undefined;
  for (const loc of locations) {
    const name = loc.name?.trim();
    if (!name || name.length < 3) continue;
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, "i");
    const m = re.exec(text);
    if (!m) continue;
    // Destination phrasing directly before the name → traveling TOWARD it, not there.
    if (DESTINATION_RE.test(text.slice(0, m.index))) continue;
    if (!best || m.index < best.pos || (m.index === best.pos && name.length > best.len)) {
      best = { id: loc.id, pos: m.index, len: name.length };
    }
  }
  return best?.id;
}
