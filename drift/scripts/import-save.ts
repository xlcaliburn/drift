/**
 * Seed the DRIFT shared-world canon: validate the universe/faction/location/NPC
 * data against the Zod schemas and (optionally) push it to Supabase. These are
 * the parent rows every created campaign references via foreign keys, so they
 * must exist in the DB before real characters are persisted.
 *
 *   npm run import-save            # validate only (dry run)
 *   npm run import-save -- --push  # validate then upsert to Supabase
 *
 * The dry run needs no environment and proves the canon round-trips through the
 * schema cleanly. (Player campaigns/characters are created at runtime, not here.)
 */
import { Universe, Faction, Location, Npc } from "@/shared/schemas";
import * as seed from "./seedData";

function validate() {
  const checks: [string, () => unknown][] = [
    ["universe", () => Universe.parse(seed.universe)],
    ["factions", () => seed.factions.map((f) => Faction.parse(f))],
    ["locations", () => seed.locations.map((l) => Location.parse(l))],
    ["npcs", () => seed.npcs.map((n) => Npc.parse(n))],
  ];

  let ok = 0;
  for (const [name, fn] of checks) {
    try {
      const v = fn();
      const count = Array.isArray(v) ? v.length : 1;
      console.log(`  ✓ ${name} (${count})`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }
  console.log(`\nValidated ${ok}/${checks.length} entity groups. Canon is schema-clean.`);
}

async function push() {
  const { getServiceClient, toRow } = await import("@/db/queries");
  const db = getServiceClient();
  console.log("Pushing shared-world canon to Supabase…");

  // Upsert one table, surfacing any Postgres error (the client returns errors
  // rather than throwing — silently ignoring them hides FK failures).
  async function upsert(table: string, rows: unknown) {
    const payload = Array.isArray(rows) ? rows : [rows];
    const { error } = await db.from(table).upsert(payload as never);
    if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
    console.log(`  ✓ ${table} (${payload.length})`);
  }

  // Order matters: parents before children so foreign keys resolve.
  // universes → factions/locations (ref universe) → npcs (ref faction+location).
  await upsert("universes", toRow(seed.universe));
  await upsert("factions", seed.factions.map(toRow));
  await upsert("locations", seed.locations.map(toRow));
  await upsert("npcs", seed.npcs.map(toRow));
  console.log("Push complete.");
}

async function main() {
  console.log("DRIFT canon import — validating shared world against Zod schemas:\n");
  validate();
  if (process.argv.includes("--push")) {
    await push();
  } else {
    console.log("\n(dry run — pass --push to upsert into Supabase)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
