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
