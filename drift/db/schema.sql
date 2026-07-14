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
  -- Occupational handle ("data broker") shown before a player learns the name;
  -- provenance for NPCs promoted into the shared cast from play/creation (014).
  role          text,
  origin_campaign_id text,
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

-- ── Durable play-session runtime (M7) ─────────────────────────────────────
-- Per-campaign snapshot of the live session (chat transcript, dice/event log,
-- and the narrator's model history), upserted each turn and restored on cold
-- load so a refresh/restart resumes the latest run instead of the opening.
create table if not exists campaign_runtime (
  campaign_id text primary key references campaigns(id) on delete cascade,
  transcript  jsonb not null default '[]',
  history     jsonb not null default '[]',
  log         jsonb not null default '[]',
  focus_ids   jsonb not null default '[]',
  ticked_this_scene jsonb not null default '[]',
  combat      jsonb default null,
  updated_at  timestamptz not null default now()
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

-- ── Row-level security (deny-by-default lockdown) ──────────────────────────
-- RLS is enabled on EVERY table with NO policies: anon/publishable-key access
-- is fully blocked. All app access is server-side via the secret key, which
-- bypasses RLS; authorization is enforced in route handlers (lib/auth.ts
-- guards). Policies are intentionally deferred until the publishable key is
-- actually used for table reads (e.g. world_events visibility='canon' once
-- multiplayer lands).
alter table universes        enable row level security;
alter table factions         enable row level security;
alter table locations        enable row level security;
alter table npcs             enable row level security;
alter table campaigns        enable row level security;
alter table characters       enable row level security;
alter table ships            enable row level security;
alter table faction_rep      enable row level security;
alter table clocks           enable row level security;
alter table threads          enable row level security;
alter table contracts        enable row level security;
alter table scenes           enable row level security;
alter table turns            enable row level security;
alter table rolls            enable row level security;
alter table world_events     enable row level security;
alter table feature_requests enable row level security;
-- ── 002_auth: profiles, usage metering, campaign ownership ─────────────────
-- Run this in the Supabase SQL editor BEFORE anyone signs in (the trigger must
-- exist so first sign-ins get a profile row). Safe to re-run: everything is
-- IF NOT EXISTS / OR REPLACE / ON CONFLICT.

-- ── Profiles (one row per auth user; the app's user + role + budget record) ─
create table if not exists profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  email                   text not null,
  display_name            text,
  role                    text not null default 'player' check (role in ('admin','player')),
  status                  text not null default 'pending' check (status in ('pending','approved','suspended')),
  monthly_token_budget    bigint not null default 2000000,      -- hard cap: total tokens per calendar month
  monthly_cost_budget_usd numeric(8,2) not null default 5.00,   -- hard cap: estimated $ per calendar month
  created_at              timestamptz default now()
);
alter table profiles enable row level security;  -- deny-all, same as every other table

-- Auto-provision a profile on first sign-in. The owner email is bootstrapped
-- admin + approved; everyone else lands pending until approved in /admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    case when lower(new.email) = 'michaelchunkitwong@gmail.com' then 'admin' else 'player' end,
    case when lower(new.email) = 'michaelchunkitwong@gmail.com' then 'approved' else 'pending' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill in case any auth.users signed in before this migration ran.
insert into profiles (id, email, display_name, role, status)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.email),
       case when lower(u.email) = 'michaelchunkitwong@gmail.com' then 'admin' else 'player' end,
       case when lower(u.email) = 'michaelchunkitwong@gmail.com' then 'approved' else 'pending' end
from auth.users u
on conflict (id) do nothing;

-- ── Per-turn usage metering ─────────────────────────────────────────────────
-- Deliberately NOT the turns table: turns.scene_id is a NOT NULL FK to scenes
-- and nothing writes scenes to the DB yet; budget checks want a narrow indexed
-- aggregate anyway.
create table if not exists turn_usage (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  campaign_id        text,                           -- no FK: survives campaign deletion for accounting
  model              text not null,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd           numeric(10,6) not null default 0,  -- estimated at write time (lib/pricing.ts)
  created_at         timestamptz default now()
);
create index if not exists idx_turn_usage_user_time on turn_usage(user_id, created_at);
alter table turn_usage enable row level security;

-- ── Campaign ownership: FK + index on the existing nullable column ──────────
do $$ begin
  alter table campaigns
    add constraint campaigns_player_id_fkey
    foreign key (player_id) references profiles(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists idx_campaigns_player on campaigns(player_id);

-- ── Feature requests get an authenticated author ────────────────────────────
alter table feature_requests add column if not exists author_id uuid references profiles(id) on delete set null;

-- ── After YOUR first sign-in, claim the seeded campaigns (camp-vess etc.) ────
-- (Until this runs, unowned campaigns are still visible to the admin in-app.)
--
--   update campaigns set player_id = (select id from profiles where role = 'admin' limit 1)
--   where player_id is null;

