import type { CampaignState } from "@/shared/schemas";
import { shipThreadId } from "@/shared/recap";

/**
 * Entity retrieval + shared text helpers for the per-turn context slice.
 *
 * Scored keyword/entity matching (no vector DB — overkill at this scale) decides
 * which NPCs and threads a turn's context should include, keeping token cost flat
 * regardless of how large the world grows. `tokenize` is shared with the prompt
 * sections (older-scene recall scoring), so it lives here as the single source.
 */

/** How many entities to surface per turn — kept small so context (and cost) stays
 *  flat regardless of how large the world grows. */
const MAX_NPCS = 5;
const MAX_THREADS = 4;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "that", "this", "from", "into",
  "onto", "who", "what", "where", "when", "them", "their", "there", "here",
  "about", "over", "off", "out", "get", "got", "let", "she", "him", "her", "his",
]);

/** Significant lowercase word tokens (length ≥ 3, non-stopword) for keyword overlap. */
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
}

/** An NPC whose status marks them out of play (dead/gone/…) shouldn't be pulled in. */
export function npcIsGone(status?: string): boolean {
  return !!status && /\b(dead|gone|killed|removed|inactive|departed|left)\b/i.test(status);
}

/**
 * Entity retrieval: which NPCs and threads should this turn's context include?
 *
 * Scored keyword/entity matching. Signals, strongest first: carried focus from the
 * last scene, the player naming an entity (full name or a name token, so "Ilyana"
 * matches "Ilyana Vance"), NPCs physically at the current location, factions/
 * locations named in the text, and the player's own faction. Threads score on
 * entityRefs pointing at a surfaced entity, title keyword overlap, and a low
 * always-on floor for the current objective threads so the narrator never loses
 * the plot on a vague action. Results are capped so the context slice stays lean.
 */
export function retrieveEntities(state: CampaignState, playerText: string, focusIds: string[] = []) {
  const text = playerText.toLowerCase();
  const textTokens = new Set(tokenize(playerText));
  const pc = state.characters.find((c) => c.kind === "pc");
  const currentLoc = state.campaign.currentLocationId;
  const pcFactionId = pc?.parentFactionId;

  // Factions / locations the player named this turn → scope NPCs and threads to them.
  const mentionedFactionIds = new Set(
    state.factions.filter((f) => f.name && text.includes(f.name.toLowerCase())).map((f) => f.id),
  );
  const mentionedLocationIds = new Set(
    state.locations.filter((l) => l.name && text.includes(l.name.toLowerCase())).map((l) => l.id),
  );

  const npcScored = state.npcs
    .filter((n) => !npcIsGone(n.status))
    .map((n) => {
      let score = 0;
      let named = false; // player typed this NPC's name/handle this turn
      const nameLc = n.name.toLowerCase();
      if (focusIds.includes(n.id)) score += 100;
      if (text.includes(nameLc)) {
        score += 60;
        named = true;
      } else {
        const parts = nameLc.match(/[a-z0-9]+/g) ?? [];
        if (parts.some((p) => p.length >= 3 && textTokens.has(p))) {
          score += 40;
          named = true;
        }
      }
      if (n.locationId && n.locationId === currentLoc) score += 25; // physically present
      if (n.locationId && mentionedLocationIds.has(n.locationId)) score += 20;
      if (n.factionId && mentionedFactionIds.has(n.factionId)) score += 20;
      if (n.factionId && n.factionId === pcFactionId) score += 8;
      return { n, score, named };
    });

  const npcs = npcScored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NPCS)
    .map((x) => x.n);

  // Entities the player explicitly named this turn, carried forward as next turn's
  // `focusIds` for short-term continuity (e.g. "I nod" right after naming someone).
  // Named-only, so it can't self-reinforce into an eternal pin — a name has to be
  // typed again to renew focus; otherwise it decays after one turn of grace.
  const namedNpcIds = npcScored.filter((x) => x.named).map((x) => x.n.id);

  const npcIds = new Set(npcs.map((n) => n.id));
  const selectedRefs = new Set<string>([
    ...focusIds,
    ...npcIds,
    ...mentionedFactionIds,
    ...mentionedLocationIds,
    ...(pcFactionId ? [pcFactionId] : []),
  ]);
  const starterThreadIds = new Set([`th-start-${state.campaign.id}`, shipThreadId(state.campaign.id)]);

  const active = state.threads.filter((t) => t.status === "active");
  // Active threads are the player's OPEN OBJECTIVES — they must ALWAYS stay in
  // context, or a job drifts out of view and is forgotten (the fence-job-that-ran-
  // the-whole-game bug). So DON'T drop unmatched threads; rank every active thread
  // by this turn's relevance and show them all up to the cap.
  const threads = active
    .map((t) => {
      let score = 1; // every open objective has a floor — it never vanishes
      if (t.entityRefs.some((r) => selectedRefs.has(r))) score += 60;
      const overlap = tokenize(t.title).filter((w) => textTokens.has(w)).length;
      score += overlap * 25;
      if (starterThreadIds.has(t.id)) score += 10;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_THREADS)
    .map((x) => x.t);

  return { npcs, threads, namedNpcIds };
}
