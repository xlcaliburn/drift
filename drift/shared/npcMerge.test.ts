import { describe, it, expect } from "vitest";
import { mergeNpcs } from "@/shared/npcMerge";
import type { Npc } from "@/shared/schemas";

const npc = (id: string, name: string): Npc => ({
  id,
  universeId: "uni-1",
  name,
  oneBreath: `${name}, someone in the world.`,
});

describe("mergeNpcs — shared table + legacy runtime cast", () => {
  it("keeps every table row and appends legacy NPCs not already present by name", () => {
    const table = [npc("npc-seed-doyle", "Doyle"), npc("npc-gen-vane-3", "Vane")];
    const legacy = [npc("npc-gen-mox-1", "Mox")];
    const merged = mergeNpcs(table, legacy);
    expect(merged.map((n) => n.name).sort()).toEqual(["Doyle", "Mox", "Vane"]);
  });

  it("prefers the table row when both exist under the same name (table wins)", () => {
    const table = [{ ...npc("npc-gen-vane-3", "Vane"), role: "data broker" }];
    const legacy = [{ ...npc("npc-rel-old-0", "vane"), role: "smuggler" }]; // same name, older id
    const merged = mergeNpcs(table, legacy);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("npc-gen-vane-3");
    expect(merged[0].role).toBe("data broker");
  });

  it("is a no-op-safe pass-through when there is no legacy cast", () => {
    const table = [npc("npc-seed-doyle", "Doyle")];
    expect(mergeNpcs(table, [])).toEqual(table);
  });

  it("dedupes case-insensitively", () => {
    const merged = mergeNpcs([npc("a", "Kessa Vane")], [npc("b", "KESSA VANE")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("a");
  });
});
