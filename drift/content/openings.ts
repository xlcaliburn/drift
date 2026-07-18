/**
 * Per-faction OPENING SCENARIOS + STARTING POINTS, keyed by the faction a new
 * character starts in. Two jobs:
 *
 *  1. STATIC FALLBACK (`hook`, `threadTitle`, `threadBody`, `firstMoves`) — a
 *     ready-made opening used verbatim when there is no narrator API key or the
 *     creation-time generation fails. It NEVER costs a call and is what the free
 *     opening recap (shared/recap.ts) reads on load.
 *
 *  2. GENERATION SEED (`seed`) — raw material fed into the one creation-time LLM
 *     pass (llm/creationFinalize.ts) so it can write a customized opening
 *     `situation` (context) and starting quest thread for THIS character,
 *     grounded in real canon instead of freestyling. The generated result is
 *     stored on the campaign (situation) and the starting thread — both already
 *     persist — so play still opens for free on every later load.
 *
 * The data (`factionOpenings`) now lives in the pack
 * (content/pack/drift/openings.ts — Modularity M1 Task E); this file is the
 * facade (mechanics + the `GeneratedOpening` runtime-shared type) so every
 * existing `@/content/openings` import keeps working. All anchors reference
 * canon in the pack's cast (Ilyana, Kesh, the Meridian broker, home locations).
 * `firstMoves` stay per-faction (the clickable buttons) — each is doable on
 * foot with no ship, since mobility is earned in play.
 */

import { pack } from "@/content/pack";

export type LoanerDef = NonNullable<(typeof pack.openings.factions)[number]["loaner"]>;
export type OpeningSeed = (typeof pack.openings.factions)[number]["seed"];
export type FactionOpening = (typeof pack.openings.factions)[number];

/**
 * The shape the creation-time LLM pass returns for a personalized opening. Kept
 * here (content, non-server) so both the generator (llm/creationFinalize.ts) and
 * the campaign builder (lib/newCampaign.ts) can share the type without importing
 * a server-only module. NOT pack data — a per-call LLM output shape, not world
 * canon — so it stays hand-authored here rather than moving.
 */
export interface GeneratedOpening {
  /** Personalized present-tense context — the scene the character stands in now.
   *  No faction prefix / season suffix; newCampaign wraps those around it. */
  situation: string;
  /** Personalized starting-quest title (a concrete goal). */
  questTitle: string;
  /** 2-3 sentences framing the first job and the choice it poses. */
  questBody: string;
}

export const factionOpenings = pack.openings.factions;

/** Look up a faction's opening + starting points, if authored. */
export function openingFor(factionId: string | undefined): FactionOpening | undefined {
  if (!factionId) return undefined;
  return factionOpenings.find((o) => o.factionId === factionId);
}
