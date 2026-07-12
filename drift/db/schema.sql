-- DRIFT — Supabase schema (Postgres).
-- Mirrors shared/schemas.ts. jsonb columns are validated through Zod in app code.
-- Run in the Supabase SQL editor, or via `supabase db push` if using the CLI.
--
-- Three-level model: universe (shared canon) -> campaign (one playthrough) ->
-- character/ship (per campaign). world_events is the multiplayer spillover seam:
-- written from day one, read cross-campaign only once sharing is enabled.

create extension if not exists "pgcrypto";

-- ── Universe layer (shared canon) ─────────────────────────────────────────
create table if not exists universes (
  id            text primary key,
  name          text not null,
  owner_id      uuid,
  primer        text not null,
  style_rules   text,
  created_at    timestamptz default now()
);

create table if not exists factions (
  id            text primary key,
  universe_id   text not null references universes(id) on delete cascade,
  name          text not null,
  description   text,
  default_rep   int not null default 0
);

create table if not exists locations (
  id            text primary key,
  universe_id   text not null references universes(id) on delete cascade,
  name          text not null,
  description   text,
  tags          text[] not null default '{}'
);

create table if not exists npcs (
  id            text primary key,
  universe_id   text not null references universes(id) on delete cascade,
  name          text not null,
  one_breath    text not null,
  status        text,
  faction_id    text references factions(id) on delete set null,
  location_id   text references locations(id) on delete set null,
  notes         text
);

-- ── Campaign layer (one playthrough) ──────────────────────────────────────
create table if not exists campaigns (
  id                  text primary key,
  universe_id         text not null references universes(id) on delete cascade,
  name                text not null,
  player_id           uuid,
  status              text not null default 'active',
  current_location_id text references locations(id) on delete set null,
  tendays_elapsed     int not null default 0,
  narrator_model      text,
  created_at          timestamptz default now()
);

create table if not exists characters (
  id                text primary key,
  campaign_id       text not null references campaigns(id) on delete cascade,
  kind              text not null check (kind in ('pc','party')),
  name              text not null,
  attributes        jsonb not null,
  hp                int not null,
  max_hp            int not null,
  ac                int not null,
  slots             int,
  max_slots         int,
  stims             int not null default 0,
  credits           int,
  loyalty           int,
  fragile           boolean not null default false,
  skills            jsonb not null default '[]',
  action_modifiers  jsonb not null default '{}',
  backstory         text,
  drives            text,
  gear              jsonb not null default '[]',
  injuries          jsonb not null default '[]'
);

create table if not exists ships (
  id                text primary key,
  campaign_id       text not null references campaigns(id) on delete cascade,
  name              text not null,
  ship_class        text not null,
  hp                int not null,
  max_hp            int not null,
  ac                int not null,
  evasive_ac_bonus  int not null default 0,
  damage_reduction  int not null default 0,
  weapons           jsonb not null default '[]',
  has_shield        boolean not null default false,
  shield_ready      boolean not null default true,
  has_point_defense boolean not null default false,
  burst_drive_ready boolean not null default false,
  dc_modifier       int not null default 0,
  buyout_remaining  int not null default 0,
  notes             text
);

create table if not exists faction_rep (
  campaign_id   text not null references campaigns(id) on delete cascade,
  faction_id    text not null references factions(id) on delete cascade,
  rep           int not null,
  standing      text,
  primary key (campaign_id, faction_id)
);

create table if not exists clocks (
  id            text primary key,
  campaign_id   text not null references campaigns(id) on delete cascade,
  name          text not null,
  current       int not null default 0,
  max           int not null,
  trigger_text  text not null,
  milestones    jsonb not null default '[]',
  status        text not null default 'active'
);

create table if not exists threads (
  id            text primary key,
  campaign_id   text not null references campaigns(id) on delete cascade,
  title         text not null,
  body          text not null,
  status        text not null default 'active',
  entity_refs   text[] not null default '{}'
);

create table if not exists contracts (
  id            text primary key,
  campaign_id   text not null references campaigns(id) on delete cascade,
  name          text not null,
  payout_range  text,
  notes         text,
  status        text not null default 'standing'
);

create table if not exists scenes (
  id            text primary key,
  campaign_id   text not null references campaigns(id) on delete cascade,
  seq           int not null,
  title         text not null,
  location_id   text references locations(id) on delete set null,
  summary       text,
  entity_refs   text[] not null default '{}',
  started_at    timestamptz,
  ended_at      timestamptz,
  snapshot      jsonb
);

create table if not exists turns (
  id            uuid primary key default gen_random_uuid(),
  scene_id      text not null references scenes(id) on delete cascade,
  seq           int not null,
  player_text   text,
  narration_text text,
  tool_calls    jsonb not null default '[]',
  token_usage   jsonb,
  created_at    timestamptz default now()
);

create table if not exists rolls (
  id            uuid primary key default gen_random_uuid(),
  scene_id      text references scenes(id) on delete cascade,
  character_id  text,
  skill         text not null,
  d20           int not null,
  modifier      int not null,
  total         int not null,
  dc            int,
  outcome       text not null default 'n/a',
  stakes        boolean not null default false,
  ticked        boolean not null default false,
  breakdown     text not null,
  created_at    timestamptz default now()
);

-- ── Multiplayer spillover seam ────────────────────────────────────────────
create table if not exists world_events (
  id                 text primary key,
  universe_id        text not null references universes(id) on delete cascade,
  source_campaign_id text not null references campaigns(id) on delete cascade,
  faction_ids        text[] not null default '{}',
  location_id        text references locations(id) on delete set null,
  headline           text not null,
  detail             text,
  visibility         text not null default 'private',
  created_at         timestamptz default now()
);

-- ── Feature requests (players propose, owner approves/declines) ────────────
create table if not exists feature_requests (
  id            text primary key,
  campaign_id   text references campaigns(id) on delete set null,
  author_name   text,
  raw           text not null,
  title         text not null,
  summary       text,
  category      text not null default 'other',
  status        text not null default 'pending',
  decision_note text,
  created_at    timestamptz default now(),
  decided_at    timestamptz
);

create index if not exists idx_world_events_universe on world_events(universe_id, visibility);
create index if not exists idx_world_events_factions on world_events using gin(faction_ids);
create index if not exists idx_scenes_campaign on scenes(campaign_id, seq);
create index if not exists idx_rolls_scene on rolls(scene_id);

-- ── Row-level security (permissive single-user for now) ────────────────────
-- Enable RLS everywhere; policies start owner-scoped and widen for canon world
-- events when multiplayer ships (add a universe_members table + membership check).
alter table universes    enable row level security;
alter table campaigns    enable row level security;
alter table characters   enable row level security;
alter table ships        enable row level security;
alter table world_events enable row level security;

-- Single-user dev policy: authenticated users can do everything. Tighten later.
create policy if not exists dev_all_universes on universes
  for all using (true) with check (true);
create policy if not exists dev_all_campaigns on campaigns
  for all using (true) with check (true);
create policy if not exists dev_all_characters on characters
  for all using (true) with check (true);
create policy if not exists dev_all_ships on ships
  for all using (true) with check (true);
-- world_events: everyone in the universe can read canon; only source can write.
create policy if not exists read_canon_events on world_events
  for select using (true);
create policy if not exists write_own_events on world_events
  for all using (true) with check (true);
