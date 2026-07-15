import type { Dossier, Deed, LedgerEntry, KnowledgeLevel, RelationStance, CapabilityTier } from "./multiplayer";

/**
 * The relationship LEDGER (MULTIPLAYER.md §2) — the "who-knows-what" layer over the
 * shared dossiers. A dossier being PUBLIC doesn't mean your character KNOWS the
 * person: the ledger gates how much of another player's character reaches your
 * game. Firsthand contacts (you've met/worked/fought with them) see the real person
 * and their known deeds; someone you've only HEARD of gets rumor + reputation; a
 * true stranger doesn't surface as a known figure at all.
 *
 * Pure/deterministic — no DB, no Date.now (the persistence layer stamps updatedAt).
 * Stored per-campaign as the owner's Rolodex; keyed by the subject's characterId.
 * Only FIRSTHAND meetings are stored; secondhand knowledge is DERIVED from the
 * subject's public notoriety + a shared faction, so it needs no bookkeeping.
 */

/** The owner's ledger: subject characterId → what they know of that character. */
export type PlayerLedger = Record<string, LedgerEntry>;

/**
 * What the owner knows about a subject dossier. Firsthand only if they have a stored
 * firsthand entry (an actual meeting). Secondhand if they stored a rumor, OR the
 * subject has a NOTORIOUS deed (widely known), OR they share a faction (word travels
 * inside a faction). Otherwise unknown — not in the owner's world yet.
 */
export function deriveKnowledge(
  ledger: PlayerLedger,
  dossier: Dossier,
  ownerFactionId?: string,
): KnowledgeLevel {
  const stored = ledger[dossier.characterId]?.knowledge;
  if (stored === "firsthand") return "firsthand";
  // You've HEARD of them if they have any PUBLIC deed (known/notorious — it spread) or
  // share your faction (word travels inside a faction). A character whose only mark is
  // a whispered RUMOR, or who's done nothing public, stays a stranger — never cameo'd.
  const publicDeed = dossier.deeds.some((d) => d.notoriety !== "rumored");
  const sharedFaction = !!ownerFactionId && !!dossier.factionId && dossier.factionId === ownerFactionId;
  if (stored === "secondhand" || publicDeed || sharedFaction) return "secondhand";
  return "unknown";
}

/** Which of a subject's deeds the owner has actually learned, at a knowledge level.
 *  Both firsthand and secondhand see the PUBLIC deeds (known/notorious); a RUMORED
 *  deed reaches only a firsthand contact who personally learned it. */
export function visibleDeeds(dossier: Dossier, knowledge: KnowledgeLevel, entry?: LedgerEntry): Deed[] {
  if (knowledge === "unknown") return [];
  if (knowledge === "secondhand") return dossier.deeds.filter((d) => d.notoriety !== "rumored");
  const known = new Set(entry?.knownDeedIds ?? []);
  return dossier.deeds.filter((d) => d.notoriety !== "rumored" || known.has(d.id));
}

/** A ledger-gated projection of a dossier for the prompt, or null when the owner
 *  doesn't know the subject at all. Firsthand carries the full sheet (name/faction/
 *  tier/standing/voice + known deeds + the owner's stance); secondhand carries only
 *  rumor (name/faction/reputation + notorious deeds), no tier or voice. */
export interface DossierView {
  characterId: string;
  knowledge: "firsthand" | "secondhand";
  name: string;
  factionId?: string;
  capabilityTier?: CapabilityTier;
  standing?: string;
  reputation?: string;
  voiceNotes?: string;
  deeds: Deed[];
  /** From the owner's stored entry (firsthand only). */
  stance?: RelationStance;
  warmth?: number;
  notes?: string;
}

export function projectDossier(
  dossier: Dossier,
  knowledge: KnowledgeLevel,
  entry?: LedgerEntry,
): DossierView | null {
  if (knowledge === "unknown") return null;
  const deeds = visibleDeeds(dossier, knowledge, entry);
  if (knowledge === "firsthand") {
    return {
      characterId: dossier.characterId,
      knowledge,
      name: dossier.name,
      factionId: dossier.factionId,
      capabilityTier: dossier.capabilityTier,
      standing: dossier.standing,
      voiceNotes: dossier.voiceNotes,
      deeds,
      stance: entry?.stance,
      warmth: entry?.warmth,
      notes: entry?.notes,
    };
  }
  // secondhand — rumor only: name, faction, reputation, the public deeds.
  return {
    characterId: dossier.characterId,
    knowledge,
    name: dossier.name,
    factionId: dossier.factionId,
    standing: dossier.standing,
    reputation: dossier.reputation,
    deeds,
  };
}

/**
 * Record a FIRSTHAND encounter with another player's character — the owner has now
 * met them, so they see the real person going forward. Upserts the entry (preserving
 * any stance/warmth/notes the owner accrued), promotes knowledge to firsthand, and
 * folds the subject's currently-known deeds into `knownDeedIds`. Returns a NEW ledger
 * (pure); the caller stamps `updatedAt`.
 */
export function recordEncounter(
  ledger: PlayerLedger,
  owner: { characterId: string },
  dossier: Dossier,
): PlayerLedger {
  const prev = ledger[dossier.characterId];
  const learnedDeeds = dossier.deeds.filter((d) => d.notoriety !== "rumored").map((d) => d.id);
  const knownDeedIds = [...new Set([...(prev?.knownDeedIds ?? []), ...learnedDeeds])];
  const entry: LedgerEntry = {
    ownerCharacterId: owner.characterId,
    subjectId: dossier.characterId,
    subjectName: dossier.name,
    knowledge: "firsthand",
    stance: prev?.stance ?? "neutral",
    warmth: prev?.warmth ?? 0,
    knownDeedIds,
    notes: prev?.notes,
  };
  return { ...ledger, [dossier.characterId]: entry };
}
