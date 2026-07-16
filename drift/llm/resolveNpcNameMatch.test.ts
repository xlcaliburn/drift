import { describe, it, expect } from "vitest";
import { resolveNpcNameMatch } from "./runtimeNarrative";

describe("resolveNpcNameMatch — pure branch logic (CHECKS.md §2 name-collision guard)", () => {
  it("no existing candidates — nothing to resolve", () => {
    expect(resolveNpcNameMatch([], "courier")).toEqual({ collision: false });
    expect(resolveNpcNameMatch([], undefined)).toEqual({ collision: false });
  });

  it("no role on the incoming mention — falls back to the first candidate", () => {
    const candidates = [{ id: "a", role: "courier" }, { id: "b", role: "fixer" }];
    expect(resolveNpcNameMatch(candidates, undefined)).toEqual({ existingId: "a", collision: false });
  });

  it("a candidate's role matches the incoming role — same person, found", () => {
    const candidates = [{ id: "a", role: "courier" }, { id: "b", role: "fixer" }];
    expect(resolveNpcNameMatch(candidates, "fixer")).toEqual({ existingId: "b", collision: false });
    expect(resolveNpcNameMatch(candidates, "FIXER")).toEqual({ existingId: "b", collision: false }); // case-insensitive
  });

  it("an existing candidate has no role yet — adopts it, same person", () => {
    const candidates = [{ id: "a", role: undefined }];
    expect(resolveNpcNameMatch(candidates, "courier")).toEqual({ existingId: "a", collision: false });
  });

  it("every candidate has a role and none match the incoming one — a genuine collision", () => {
    const candidates = [{ id: "a", role: "courier" }];
    expect(resolveNpcNameMatch(candidates, "fixer")).toEqual({ collision: true });
  });

  it("multiple existing candidates, none matching — still a collision, not a merge into any of them", () => {
    const candidates = [{ id: "a", role: "courier" }, { id: "b", role: "fixer" }];
    expect(resolveNpcNameMatch(candidates, "bartender")).toEqual({ collision: true });
  });
});
