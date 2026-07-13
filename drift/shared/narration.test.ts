import { describe, it, expect } from "vitest";
import { parseInlineMenu, stripInlineMenu } from "./narration";

describe("parseInlineMenu", () => {
  it("cuts at the first inline menu and extracts its options as choices", () => {
    const t = [
      "You drift toward the wreck. The other crew is already aboard.",
      "",
      "> **Match the airlock and go in.**",
      "> **Hold position and watch.**",
      "",
      "You match the airlock and step through. They freeze, torches up.",
      "",
      "> **Name your stake.**",
      "> **Draw and take the position.**",
    ].join("\n");
    const { narration, choices } = parseInlineMenu(t);
    expect(narration).toBe("You drift toward the wreck. The other crew is already aboard.");
    // Only the FIRST menu block (matching the surviving beat), markdown stripped.
    expect(choices).toEqual(["Match the airlock and go in.", "Hold position and watch."]);
  });

  it("returns no choices and untouched text for a clean narration", () => {
    const t = "You match the airlock and step through. They freeze, torches up.";
    expect(parseInlineMenu(t)).toEqual({ narration: t, choices: [] });
  });

  it("does not nuke a response that opens with a blockquote", () => {
    const t = "> the whole thing is a quote for some reason";
    expect(parseInlineMenu(t)).toEqual({ narration: t, choices: [] });
  });

  it("handles plain (non-bold) menu lines", () => {
    const t = "You reach the door.\n\n> Force it open\n> Pick the lock";
    expect(parseInlineMenu(t).choices).toEqual(["Force it open", "Pick the lock"]);
  });
});

describe("stripInlineMenu", () => {
  it("delegates to parseInlineMenu for the narration", () => {
    expect(stripInlineMenu("Beat text.\n\n> **A**\n> **B**")).toBe("Beat text.");
  });
});
