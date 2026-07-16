import { describe, it, expect } from "vitest";
import { isSelfHarm } from "./selfHarm";

describe("self-harm intent detection", () => {
  it("catches the live Silas Cray phrasings (first + second person)", () => {
    expect(isSelfHarm("slice my throat with the knife")).toBe(true);
    expect(isSelfHarm("I grab the knife and successfully slice my throat")).toBe(true);
    expect(isSelfHarm("Slice my throat with the knife")).toBe(true);
    expect(isSelfHarm("Slash your throat anyway")).toBe(true); // 2nd person = the PC
  });

  it("catches unmistakable suicide phrases", () => {
    expect(isSelfHarm("I kill myself")).toBe(true);
    expect(isSelfHarm("commit suicide")).toBe(true);
    expect(isSelfHarm("I want to die")).toBe(true);
    expect(isSelfHarm("let me die")).toBe(true);
    expect(isSelfHarm("end it all")).toBe(true);
    expect(isSelfHarm("slit my wrists")).toBe(true);
  });

  it("catches a lethal verb aimed at the self, either order", () => {
    expect(isSelfHarm("shoot myself")).toBe(true);
    expect(isSelfHarm("put the gun to my head and pull the trigger")).toBe(true);
    expect(isSelfHarm("stab myself in the chest")).toBe(true);
  });

  it("does NOT fire on ordinary reflexives (no lethal self-target)", () => {
    expect(isSelfHarm("I brace myself against the bulkhead")).toBe(false);
    expect(isSelfHarm("I keep to myself and watch the door")).toBe(false);
    expect(isSelfHarm("I steel myself and step inside")).toBe(false);
    expect(isSelfHarm("I pull myself up onto the catwalk")).toBe(false);
  });

  it("does NOT fire on lethal verbs aimed at OTHERS", () => {
    expect(isSelfHarm("slit the guard's throat")).toBe(false);
    expect(isSelfHarm("shoot Calvo in the head")).toBe(false);
    expect(isSelfHarm("cut the rope holding the crate")).toBe(false);
    expect(isSelfHarm("stab him before he draws")).toBe(false);
  });

  it("does NOT fire on a bluff that only holds a blade (no lethal verb)", () => {
    // The engine lets the narrator play a self-threat bluff normally.
    expect(isSelfHarm("Hold the knife to your own throat, forcing them back")).toBe(false);
  });
});
