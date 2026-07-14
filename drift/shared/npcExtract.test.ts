import { describe, it, expect } from "vitest";
import {
  extractDialogueNpcs,
  knownEntityNames,
  isPlausibleNpcName,
  isCollectiveName,
  isShareableNpcName,
} from "./npcExtract";

describe("isPlausibleNpcName — the model-npcs junk filter", () => {
  it("rejects sentence-fragment junk (verbs, contractions, numbers)", () => {
    for (const junk of ["End", "Get", "Sixty", "You're", "The", "And then", "Wait"]) {
      expect(isPlausibleNpcName(junk)).toBe(false);
    }
  });

  it("rejects a name matching a known non-person entity (ship / location / faction)", () => {
    const nonPersons = knownEntityNames(["Sparrow", "Rook Station", "Sable Chain"]);
    expect(isPlausibleNpcName("Sparrow", nonPersons)).toBe(false);
    expect(isPlausibleNpcName("Rook Station", nonPersons)).toBe(false);
  });

  it("rejects lowercase-led or too-short strings", () => {
    expect(isPlausibleNpcName("wrecker")).toBe(false);
    expect(isPlausibleNpcName("K")).toBe(false);
  });

  it("accepts real names, including roles and a trailing possessive", () => {
    expect(isPlausibleNpcName("Kael")).toBe(true);
    expect(isPlausibleNpcName("Sable")).toBe(true);
    expect(isPlausibleNpcName("Wrecker Boss")).toBe(true);
    expect(isPlausibleNpcName("Draven’s")).toBe(true); // possessive stripped → "Draven"
  });

  it("rejects collective/group handles (the prod-observed junk)", () => {
    for (const mob of ["Two heavies", "Wrecker crowd", "Docking bay crew", "Three thugs", "The guards"]) {
      expect(isPlausibleNpcName(mob)).toBe(false);
    }
  });
});

describe("isCollectiveName — group vs individual", () => {
  it("flags crowds, crews, and plural mobs", () => {
    for (const mob of ["Wrecker crowd", "Docking bay crew", "Two heavies", "Several guards", "the mob"]) {
      expect(isCollectiveName(mob)).toBe(true);
    }
  });
  it("does not flag a single named figure or a singular role", () => {
    for (const person of ["Rix", "Corso", "Wrecker Boss", "Data Broker", "Kael Voss"]) {
      expect(isCollectiveName(person)).toBe(false);
    }
  });
});

describe("isShareableNpcName — universe-promotion gate", () => {
  it("promotes genuinely-named individuals", () => {
    expect(isShareableNpcName("Rix")).toBe(true);
    expect(isShareableNpcName("Kael Voss")).toBe(true);
  });
  it("keeps bare roles and collective mobs campaign-local", () => {
    for (const local of ["Guard", "Quartermaster", "Data Broker", "Two heavies", "Wrecker crowd"]) {
      expect(isShareableNpcName(local)).toBe(false);
    }
  });
});

describe("extractDialogueNpcs — dialogue-gated registration", () => {
  const known = knownEntityNames(["Draven", "Rook Station", "Sable Chain", "Cinder"]);

  it("registers a NAMED speaker attributed to a line of dialogue", () => {
    expect(extractDialogueNpcs('"Deal," says Vex, sliding the chip back.', known)).toEqual([{ handle: "Vex" }]);
    expect(extractDialogueNpcs("Kessa mutters something about the Crown.", known)).toEqual([{ handle: "Kessa" }]);
  });

  it("registers an occupational-ROLE speaker ('the fixer says')", () => {
    expect(extractDialogueNpcs('The fixer says, "Payout\'s on the tab."', known)).toEqual([
      { handle: "Fixer", role: "fixer" },
    ]);
  });

  it("does NOT register dialogue CONTENT or an unnamed speaker (the reported bug)", () => {
    const n =
      "'Clean. Payout's on the tab.' She slides a cred chip across the counter. The courier run is complete.";
    expect(extractDialogueNpcs(n, known)).toEqual([]);
  });

  it("does NOT register a passing mention with no dialogue", () => {
    expect(extractDialogueNpcs("You pass the broker's empty stall and keep walking.", known)).toEqual([]);
  });

  it("does not re-register a known NPC that speaks", () => {
    expect(extractDialogueNpcs('Draven laughs. "Get out," he says.', known)).toEqual([]);
  });

  it("catches the Name-colon-quote script form", () => {
    expect(extractDialogueNpcs('Vex: "We are done here."', known)).toEqual([{ handle: "Vex" }]);
  });
});
