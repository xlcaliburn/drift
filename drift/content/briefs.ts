/**
 * Player-facing onboarding text: the world primer and the faction briefs shown
 * during character creation, plus the current season spine. Data now lives in
 * the pack (content/pack/drift/briefs.ts — Modularity M1 Task E); this file is
 * a pure facade so every existing `@/content/briefs` import keeps working.
 */

import { pack } from "@/content/pack";

export const worldIntro = pack.briefs.worldIntro;
export const seasonOneSpine = pack.briefs.seasonOneSpine;

export type FactionBrief = (typeof pack.briefs.factions)[number];

/** Factions a player can begin embedded in. */
export const factionBriefs = pack.briefs.factions;
