import type Anthropic from "@anthropic-ai/sdk";

/**
 * Canonical-history hygiene shared by every turn path (JSON, combat, downed).
 * Extracted from the retired freeform narrator loop (llm/narrator.ts, deleted) —
 * these two helpers were the only parts still in use.
 */

/**
 * Guarantee the history we send to the model is structurally valid: every
 * tool_use is immediately followed by its tool_result, no orphan tool_results,
 * no trailing tool exchange left hanging, and the array starts on a user turn.
 *
 * This is defense-in-depth. The write path no longer persists a dangling
 * tool_use, but sessions saved by older code did (a sink-terminal turn kept the
 * offer_choices tool_use with no tool_result) — sending that to Anthropic 400s
 * with "tool_use ids were found without tool_result blocks". Sanitizing on read
 * repairs those histories so a single bad turn can't wedge a campaign, and works
 * across providers (DeepSeek `call_*` ids and Anthropic `toolu_*` ids alike).
 */
export function sanitizeHistory(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const toolUses = m.content.filter(
        (b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use",
      );
      if (toolUses.length) {
        const next = history[i + 1];
        const resultIds = new Set<string>(
          next && Array.isArray(next.content)
            ? next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))
            : [],
        );
        if (!toolUses.every((b) => resultIds.has(b.id))) {
          // A tool_use has no matching result → drop every tool_use, keep text.
          const text = m.content.filter((b) => b.type === "text");
          if (text.length) out.push({ role: "assistant", content: text });
          continue;
        }
      }
      out.push(m);
      continue;
    }
    if (m.role === "user" && Array.isArray(m.content)) {
      // Drop orphan tool_results (no matching tool_use in the previous kept msg).
      const prev = out[out.length - 1];
      const prevIds = new Set<string>(
        prev && prev.role === "assistant" && Array.isArray(prev.content)
          ? prev.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
          : [],
      );
      const kept = m.content.filter((b) => b.type !== "tool_result" || prevIds.has(b.tool_use_id));
      if (kept.length) out.push({ role: "user", content: kept });
      continue;
    }
    out.push(m);
  }
  // Unwind a trailing tool exchange with no assistant reply after it, so history
  // ends on an assistant turn and the appended player message never produces two
  // user messages in a row.
  for (;;) {
    const last = out[out.length - 1];
    const onlyToolResults =
      !!last &&
      last.role === "user" &&
      Array.isArray(last.content) &&
      last.content.length > 0 &&
      last.content.every((b) => b.type === "tool_result");
    if (!onlyToolResults) break;
    out.pop();
    const prev = out[out.length - 1];
    if (prev && prev.role === "assistant" && Array.isArray(prev.content)) {
      out.pop();
      const text = prev.content.filter((b) => b.type === "text");
      if (text.length) out.push({ role: "assistant", content: text });
    }
  }
  // Anthropic requires the first message to be a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/** Trim a narration back to its last COMPLETE sentence — used when a hard
 *  max_tokens stop leaves the final sentence dangling mid-word. */
export function trimToLastSentence(s: string): string {
  const m = s.match(/^[\s\S]*[.!?][)"'”’]?(?=\s|$)/);
  return m ? m[0].trim() : s;
}
