import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { sanitizeHistory } from "./history";

/**
 * The invariant every case asserts: no assistant tool_use is left without a
 * matching tool_result in the very next message, no orphan tool_results survive,
 * and the array starts on a user turn — i.e. what Anthropic will accept.
 */
function assertValid(msgs: Anthropic.MessageParam[]) {
  if (msgs.length) expect(msgs[0].role).toBe("user");
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const toolUseIds = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
      if (toolUseIds.length) {
        const next = msgs[i + 1];
        const resultIds =
          next && Array.isArray(next.content)
            ? next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))
            : [];
        for (const id of toolUseIds) expect(resultIds).toContain(id);
      }
    }
    if (m.role === "user" && Array.isArray(m.content)) {
      const orphanResults = m.content.filter((b) => b.type === "tool_result");
      if (orphanResults.length) {
        const prev = msgs[i - 1];
        const prevIds =
          prev && prev.role === "assistant" && Array.isArray(prev.content)
            ? prev.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
            : [];
        for (const r of orphanResults) expect(prevIds).toContain(r.tool_use_id);
      }
    }
  }
}

const userText = (text: string): Anthropic.MessageParam => ({ role: "user", content: text });
const assistant = (content: Anthropic.ContentBlockParam[]): Anthropic.MessageParam => ({
  role: "assistant",
  content,
});
const toolResult = (id: string): Anthropic.MessageParam => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, content: "{}" }],
});

describe("sanitizeHistory", () => {
  it("passes a clean alternating history through unchanged", () => {
    const h: Anthropic.MessageParam[] = [userText("hi"), assistant([{ type: "text", text: "there" }])];
    const out = sanitizeHistory(h);
    expect(out).toEqual(h);
    assertValid(out);
  });

  it("repairs a dangling sink tool_use (the reported 400) by keeping only text", () => {
    // What the old sink-terminal turn persisted: assistant text + offer_choices
    // tool_use, with NO tool_result following it.
    const h: Anthropic.MessageParam[] = [
      userText("look around"),
      assistant([
        { type: "text", text: "The bar is loud." },
        { type: "tool_use", id: "call_00_x", name: "offer_choices", input: { choices: ["a", "b"] } },
      ]),
    ];
    const out = sanitizeHistory(h);
    assertValid(out);
    // The dangling tool_use is gone; the narration text survives.
    const last = out[out.length - 1];
    expect(last.role).toBe("assistant");
    expect(Array.isArray(last.content) && last.content.every((b) => b.type === "text")).toBe(true);
  });

  it("keeps a matched tool_use/tool_result pair", () => {
    const h: Anthropic.MessageParam[] = [
      userText("shoot"),
      assistant([
        { type: "text", text: "You fire." },
        { type: "tool_use", id: "toolu_1", name: "roll_check", input: {} },
      ]),
      toolResult("toolu_1"),
      assistant([{ type: "text", text: "A hit." }]),
    ];
    const out = sanitizeHistory(h);
    expect(out).toEqual(h);
    assertValid(out);
  });

  it("drops an orphan tool_result with no preceding tool_use", () => {
    const h: Anthropic.MessageParam[] = [userText("x"), toolResult("toolu_ghost")];
    const out = sanitizeHistory(h);
    assertValid(out);
    expect(out.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"))).toBe(
      false,
    );
  });

  it("unwinds a trailing tool exchange so history ends on an assistant turn", () => {
    // roll_check answered, but the turn ended (sink-terminal) with no assistant
    // reply after the tool_result → would produce two user messages next turn.
    const h: Anthropic.MessageParam[] = [
      userText("go"),
      assistant([
        { type: "text", text: "You move." },
        { type: "tool_use", id: "toolu_2", name: "roll_check", input: {} },
      ]),
      toolResult("toolu_2"),
    ];
    const out = sanitizeHistory(h);
    assertValid(out);
    expect(out[out.length - 1].role).toBe("assistant");
  });

  it("trims leading non-user messages (Anthropic needs a user turn first)", () => {
    const h: Anthropic.MessageParam[] = [
      assistant([{ type: "text", text: "orphan opening" }]),
      userText("hi"),
      assistant([{ type: "text", text: "hello" }]),
    ];
    const out = sanitizeHistory(h);
    expect(out[0].role).toBe("user");
    assertValid(out);
  });

  it("handles empty history", () => {
    expect(sanitizeHistory([])).toEqual([]);
  });
});
