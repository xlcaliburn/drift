-- ── 015: universe-shared PC dossiers ───────────────────────────────────────
-- A dossier is a PC's PUBLIC profile — the read-surface other campaigns in the
-- same universe pull to cameo that character as an NPC (name, faction, role,
-- reputation, capability tier, last-known location, alive?, notable deeds). It
-- is UNIVERSE-scoped, exactly like the shared npcs table (014): every campaign
-- in the world can read every other PC's dossier, but the full sheet + secrets
-- stay private in the owning campaign.
--
-- One dossier per campaign (a campaign has one PC), so campaign_id is the PK and
-- rebuilds are last-write-wins upserts. The whole public projection is stored as
-- `data` jsonb (the shared/multiplayer.ts Dossier shape, validated in app code);
-- universe_id is lifted into its own indexed column for cheap cross-campaign reads.
--
-- RLS: enabled, NO policies — deny-all, matching every other table. All access is
-- server-side via the secret key (bypasses RLS). Safe to re-run.

create table if not exists dossiers (
  campaign_id   text primary key references campaigns(id) on delete cascade,
  character_id  text,
  universe_id   text not null references universes(id) on delete cascade,
  data          jsonb not null,
  updated_at    timestamptz not null default now()
);

create index if not exists idx_dossiers_universe on dossiers(universe_id);

alter table dossiers enable row level security;
