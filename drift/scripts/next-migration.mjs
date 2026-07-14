#!/usr/bin/env node
// next-migration.mjs — pick the next sequential migration number.
//
// The repo uses zero-padded NN_ migration filenames (drift/db/migrations/NN_name.sql).
// Numbers must NEVER be hand-picked from memory — a parallel window may have added
// files you haven't pulled, and applied migrations may exist in the live DB. This
// script reads the highest NN_ on disk and prints the next one.
//
// Usage:
//   node scripts/next-migration.mjs                 # prints the next number, e.g. 017
//   node scripts/next-migration.mjs shared_ledger   # ALSO scaffolds 017_shared_ledger.sql
//
// IMPORTANT: this only sees repo FILES. Before creating or applying a migration,
// reconcile against the live applied-migration log (Supabase MCP `list_migrations`
// on drift / mgsogqnrpvoblqxkfgge) — see CLAUDE.md → "Multi-window coordination".

import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(scriptDir, "..", "db", "migrations");
const PAD = 3; // 002, 003, … — keep the existing width

/** Highest NN_ prefix among *.sql files in db/migrations (0 if none). */
function highestNumber() {
  let max = 0;
  for (const f of readdirSync(migrationsDir)) {
    const m = /^(\d+)_.*\.sql$/.exec(f);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

const nn = String(highestNumber() + 1).padStart(PAD, "0");

// Optional scaffold: a bare (non-flag) first arg is treated as the migration name.
const rawName = process.argv[2];
if (rawName && !rawName.startsWith("-")) {
  const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) {
    console.error("✗ name produced an empty slug — use letters/numbers.");
    process.exit(1);
  }
  const file = join(migrationsDir, `${nn}_${slug}.sql`);
  if (existsSync(file)) {
    console.error(`✗ ${nn}_${slug}.sql already exists — reconcile before proceeding.`);
    process.exit(1);
  }
  writeFileSync(
    file,
    `-- ── ${nn}: ${rawName} ──────────────────────────────────────────────\n` +
      `-- Run in the Supabase SQL editor (or via the authenticated MCP apply_migration).\n` +
      `-- Safe to re-run: use IF NOT EXISTS / OR REPLACE / ON CONFLICT.\n\n`,
    { flag: "wx" },
  );
  console.log(`Created db/migrations/${nn}_${slug}.sql`);
}

// The next number goes to stdout (last line, script-parseable); the reminder to stderr.
console.log(nn);
console.error(
  "⚠ Reconcile before applying: compare db/migrations/ against the live applied log\n" +
    "  (Supabase MCP list_migrations on drift / mgsogqnrpvoblqxkfgge). Never hand-pick from memory.",
);
