import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pack } from "./index";

/**
 * THE CANON SEAM ENFORCEMENT: no world id may appear in engine/UI SOURCE — canon
 * lives in content/ (the pack) and nowhere else, so rebooting the world never
 * means hunting literals through the codebase again (how FACTION_ALIGNMENT,
 * MAP_LAYOUT, and two copies of FACTION_HOME happened).
 *
 * Ids are derived FROM the active pack, so the lint stays correct for any future
 * world. Comments are stripped before matching (a comment citing a live bug by
 * id is history, not coupling). Tests/fixtures/snapshots are exempt — they pin
 * the current world's behavior on purpose (the test-pack injection is a separate
 * step). Prose NAMES ("Rook only" in a prompt string) are out of scope: names
 * are content the world-authoring pass rewrites wholesale; ids are wiring.
 */

const ROOT = join(__dirname, "..", "..");
// "content" scans LOOSE content/ (Modularity M1 Task F) — everything OUTSIDE
// content/pack/ must now be a pure facade (mechanics + re-exports), since the
// pack IS where canon ids belong. content/pack/** is exempt below, along with
// skills.json/matrix.json's TS neighbors (there are none — JSON isn't scanned;
// they're RULES vocabulary, not world flavor, and stay global on purpose).
const SCANNED_DIRS = ["engine", "shared", "llm", "lib", "app", "components", "scripts", "content"];
const EXEMPT = [/\.test\.tsx?$/, /__fixtures__/, /__snapshots__/, /\.golden\./, /^content\/pack\//];

const CANON_IDS = [
  pack.universe.id,
  ...pack.factions.map((f) => f.id),
  ...pack.locations.map((l) => l.id),
  ...pack.cast.map((n) => n.id),
];

function stripComments(src: string): string {
  // Block comments, then line comments. Not string-aware — good enough here: a
  // canon id inside a string LOOKING like a comment isn't a shape we write.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

describe("canon lint — world ids never leak outside content/", () => {
  it("no canon id appears in scanned source (comments stripped)", () => {
    const offenders: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        if (EXEMPT.some((re) => re.test(rel))) continue;
        const code = stripComments(readFileSync(file, "utf-8"));
        for (const id of CANON_IDS) {
          if (code.includes(`"${id}"`) || code.includes(`'${id}'`) || code.includes(`\`${id}\``)) {
            offenders.push(`${rel}: ${id}`);
          }
        }
      }
    }
    expect(offenders, `canon ids hardcoded outside content/pack:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("content/index.ts is a pure facade — imports, re-exports, and mechanics only, no world-data literals", () => {
    // A plain assignment (not `==`/`===`/`=>`) starting an object/array literal
    // would mean loose world data crept back into the barrel (Modularity M1
    // Task F). `as {…}` type casts and `Object.entries(x)` calls don't match —
    // only `= {`/`= [` literal assignment does.
    const code = stripComments(readFileSync(join(ROOT, "content", "index.ts"), "utf-8"));
    const literalAssignment = /(?<![=!<>])=(?!=|>)\s*[{[]/;
    expect(literalAssignment.test(code), "content/index.ts has an inline object/array literal — move the data into content/pack/").toBe(false);
  });
});
