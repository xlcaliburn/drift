/** A single displayed line in the play transcript. Shared by server + client. */
export interface ChatEntry {
  /** `recap` = deterministic, free opening context (not LLM-generated). */
  role: "player" | "dm" | "system" | "recap";
  text: string;
}

/** Transcript cap — refresh rehydration without unbounded growth (CHECKS.md §1). */
export const TRANSCRIPT_CAP = 400;

/**
 * Append entries and enforce the transcript cap, RE-BASING the open scene's
 * `startTranscriptIdx` by however many entries the trim dropped. The index is a
 * POSITIONAL pointer into the transcript array; once a campaign reaches the cap,
 * every later turn drops old entries off the FRONT, silently shifting every
 * later index left. Left unadjusted, scene compression slices the wrong window
 * (too late, or — once drift exceeds the scene's length — an EMPTY slice, which
 * used to write no summary row at all: a silent, unflagged memory hole). Born
 * from the Lyra Vale analysis (camp-mrnw51dj-ac2a): drift is zero until a
 * campaign hits the cap, then grows every turn, which is why the heaviest
 * campaigns had the worst memory loss.
 *
 * Mutates `sceneCard` IN PLACE (matches the session-owned mutation pattern used
 * throughout the runtime — sceneCard is always the session's own object here).
 */
export function appendTranscript(
  transcript: ChatEntry[],
  adds: ChatEntry[],
  sceneCard: { startTranscriptIdx: number },
): ChatEntry[] {
  const combined = [...transcript, ...adds];
  const dropped = Math.max(0, combined.length - TRANSCRIPT_CAP);
  if (dropped > 0) {
    sceneCard.startTranscriptIdx = Math.max(0, sceneCard.startTranscriptIdx - dropped);
  }
  return combined.slice(-TRANSCRIPT_CAP);
}
