import { z } from "zod";
import { UniqueSkill } from "./schemas";

/**
 * Shared-world multiplayer types (see MULTIPLAYER.md). Kept separate from the
 * core game state so the single-player engine doesn't depend on them.
 */

// ── Public dossier ───────────────────────────────────────────────────────────
// The read-surface other players' games pull to play a character as an NPC.
// Public projection only — full sheet + secrets stay in the owning campaign.

export const CapabilityTier = z.enum(["green", "capable", "dangerous", "elite"]);
export type CapabilityTier = z.infer<typeof CapabilityTier>;

export const Deed = z.object({
  id: z.string(),
  headline: z.string(),
  factionIds: z.array(z.string()).default([]),
  /** How widely this is known — gates who can learn it. */
  notoriety: z.enum(["rumored", "known", "notorious"]).default("known"),
  at: z.string().optional(),
});
export type Deed = z.infer<typeof Deed>;

export const Dossier = z.object({
  characterId: z.string(),
  universeId: z.string(),
  name: z.string(),
  factionId: z.string().optional(),
  role: z.string().optional(),
  reputation: z.string().optional(),
  capabilityTier: CapabilityTier,
  standing: z.string().optional(),
  deeds: z.array(Deed).default([]),
  voiceNotes: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Dossier = z.infer<typeof Dossier>;

// ── Relationship ledger (who-knows-what) ─────────────────────────────────────

export const KnowledgeLevel = z.enum(["unknown", "secondhand", "firsthand"]);
export const RelationStance = z.enum(["ally", "rival", "enemy", "neutral", "owed", "owes"]);

export const LedgerEntry = z.object({
  /** Whose ledger this belongs to. */
  ownerCharacterId: z.string(),
  /** The known party — another PC or an NPC. */
  subjectId: z.string(),
  subjectName: z.string(),
  knowledge: KnowledgeLevel.default("secondhand"),
  stance: RelationStance.default("neutral"),
  /** Warmth/trust lean, -3..+3. */
  warmth: z.number().int().min(-3).max(3).default(0),
  /** Ids of the subject's deeds this owner has actually learned. */
  knownDeedIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

// ── Season ───────────────────────────────────────────────────────────────────

export const Season = z.object({
  id: z.string(),
  universeId: z.string(),
  number: z.number().int().min(1),
  title: z.string(),
  /** The central destabilizing premise everyone orbits. */
  spine: z.string(),
  factionIds: z.array(z.string()).default([]),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(["upcoming", "active", "resolved"]).default("active"),
  /** GM-authored state-of-the-universe reckoning, written at end. */
  reckoning: z.string().optional(),
});
export type Season = z.infer<typeof Season>;

// ── Character-creation input (the questionnaire answers) ──────────────────────

export const CreationInput = z.object({
  name: z.string().min(1),
  parentFactionId: z.string(),
  bias: z.enum(["commerce", "combat", "intrigue", "piloting", "diplomacy"]),
  alignment: z.enum(["ruthless", "pragmatic", "principled"]),
  background: z.string(),
  ambition: z.string(),
  moralCode: z.string().min(1),
  uniqueSkill: UniqueSkill,
});
export type CreationInput = z.infer<typeof CreationInput>;
