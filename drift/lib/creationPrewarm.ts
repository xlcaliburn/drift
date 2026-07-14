import "server-only";
import type { Character } from "@/shared/schemas";
import type { CreationInput } from "@/shared/multiplayer";
import { finalizeCreation } from "@/llm/creationFinalize";

type FinalizeResult = Awaited<ReturnType<typeof finalizeCreation>>;

interface PrewarmEntry {
  key: string;
  started: number;
  promise: Promise<FinalizeResult>;
}

/**
 * In-memory cache for the slow character-creation AI pass. As soon as the player
 * finishes the questionnaire and moves on to pick their signature, the client
 * fires POST /api/create/prewarm; we kick off finalizeCreation in the background
 * so that by the time they actually submit /api/create the story is (usually)
 * already done and can be consumed instead of re-run.
 *
 * SINGLE-INSTANCE ONLY: the Map lives in module memory, so a prewarm started on
 * one server instance is invisible to another. That's fine at playtest scale
 * (one instance); the real /api/create always falls back to a fresh
 * finalizeCreation when no matching prewarm is found, so a cache miss is only a
 * lost head-start, never a correctness problem.
 */
const cache = new Map<string, PrewarmEntry>();

/**
 * Stable key over ONLY the story-driving creation fields. Deliberately EXCLUDES
 * uniqueSkill: the signature isn't picked yet when we prewarm (player is still on
 * the questionnaire→signature transition) and it barely affects the generated
 * story, so a prewarm keyed without it still matches the eventual submit.
 */
export function prewarmKey(input: CreationInput): string {
  return JSON.stringify({
    name: input.name,
    parentFactionId: input.parentFactionId,
    background: input.background,
    bias: input.bias,
    alignment: input.alignment,
    ambition: input.ambition,
    sex: input.sex,
    moralCode: input.flavor?.moralCode ?? "",
    loss: input.flavor?.loss ?? "",
    tie: input.flavor?.tie ?? "",
    tell: input.flavor?.tell ?? "",
  });
}

/**
 * Begin (or keep) a background finalize for this user. No-op if an entry with the
 * SAME key is already warming/warm. A different key replaces the stale entry.
 */
export function startPrewarm(userId: string, input: CreationInput, base: Character): void {
  const key = prewarmKey(input);
  const existing = cache.get(userId);
  if (existing && existing.key === key) return; // already warming/warm — leave it

  // Attach a catch so a rejected finalize never surfaces as an unhandledRejection,
  // but keep the rejection observable: we resolve to the caught value by
  // re-throwing inside a wrapper the consumer awaits. We store the ORIGINAL
  // promise (with a no-op error swallow) so `await`-ing it in the consumer still
  // sees the rejection and can fall back.
  const promise = finalizeCreation(input, base);
  // Prevent unhandledRejection without hiding the error from a later awaiter.
  promise.catch(() => {});

  cache.set(userId, { key, started: Date.now(), promise });
}

/**
 * Consume a matching prewarm. Returns the in-flight/settled promise and DELETES
 * the entry (consume-once) when the user has an entry whose key matches the given
 * input's story-driving fields; otherwise null so the caller runs its own pass.
 */
export function takePrewarm(
  userId: string,
  input: CreationInput,
): Promise<FinalizeResult> | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.key !== prewarmKey(input)) return null;
  cache.delete(userId);
  return entry.promise;
}
