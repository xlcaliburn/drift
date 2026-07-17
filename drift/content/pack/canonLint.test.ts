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
const SCANNED_DIRS = ["engine", "shared", "llm", "lib", "app", "components", "scripts"];
const EXEMPT = [/\.test\.tsx?$/, /__fixtures__/, /__snapshots__/, /\.golden\./];

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
});
