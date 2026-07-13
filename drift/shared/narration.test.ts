import { describe, it, expect } from "vitest";
import { stripInlineMenu } from "./narration";

describe("stripInlineMenu", () => {
  it("cuts at the first inline > menu and drops the multi-beat overrun", () => {
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
    expect(stripInlineMenu(t)).toBe("You drift toward the wreck. The other crew is already aboard.");
  });

  it("leaves a clean narration untouched", () => {
    const t = "You match the airlock and step through. They freeze, torches up.";
    expect(stripInlineMenu(t)).toBe(t);
  });

  it("does not nuke a response that opens with a blockquote", () => {
    const t = "> the whole thing is a quote for some reason";
    expect(stripInlineMenu(t)).toBe(t);
  });
});
