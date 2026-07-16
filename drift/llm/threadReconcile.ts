import type { TurnRuntime } from "./engineBridge";
import type { ThreadAnalysis } from "./summarizer";

/**
 * Apply the scene analyst's inferred quest threads to the runtime — the
 * retrospective backstop for the cheap model under-firing threads:[] on the live
 * turn (the emergent Fingers→Yarl→loot chain that ran for dozens of turns and never
 * got tracked). Same light dedup as the live path (applyPlan/world.ts `quests`):
 * skip an OPEN whose title overlaps an existing open thread, and only RESOLVE a
 * thread that actually exists and is still open. Returns how many ops landed.
 */
export function applyThreadUpdates(rt: TurnRuntime, updates: ThreadAnalysis[]): number {
  let applied = 0;
  for (const t of updates) {
    if (t.op === "open") {
      const title = t.title.trim();
      if (!title) continue;
      const norm = title.toLowerCase();
      const dupe = rt.state.threads.some(
        (x) =>
          x.status !== "resolved" &&
          (x.title.toLowerCase().includes(norm) || norm.includes(x.title.toLowerCase())),
      );
      if (dupe) continue;
      rt.execute("update_thread", { op: "create", title, body: t.body?.trim() ?? "" });
      applied++;
    } else if (t.op === "resolve") {
      const id = t.id.trim();
      if (id && rt.state.threads.some((x) => x.id === id && x.status !== "resolved")) {
        rt.execute("update_thread", { op: "resolve", threadId: id });
        applied++;
      }
    }
  }
  return applied;
}
