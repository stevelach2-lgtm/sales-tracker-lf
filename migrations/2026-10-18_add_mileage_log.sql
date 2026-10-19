-- LeafFilter Sales Tracker — IRS business mileage log
-- Apply once in the Supabase SQL editor (project gktnrjtmuxhnxggqgpny).
-- Creates new tables only, plus one nullable column on public.leads.
-- Does not drop columns, rewrite lead rows, or change any other table.

-- Null: a normal sold / not-sold close, counted in that day's route.
-- true: "Yes, no show" — he drove there, so the stop stays in the route.
-- false: "Cancelled before arrival" — he did not drive there, so the stop is left out.
alter table public.leads add column if not exists drove_there boolean;

comment on column public.leads.drove_there is
  'Mileage flag. NULL = normal close (include). true = no-show but the rep drove there. false = cancelled before arrival (exclude).';

-- Home address and the editable IRS cents-per-mile rate. Kept off app_settings
-- so this migration does not alter that table. One row per user.
create table if not exists public.mileage_settings (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  home_address  text not null default '221 Sunny Jim Dr, Medford, NJ 08055',
  mileage_rate  numeric(6,4) not null default 0.7600,
  updated_at    timestamptz not null default now(),
  constraint mileage_settings_rate_positive check (mileage_rate > 0),
  constraint mileage_settings_home_present check (char_length(btrim(home_address)) > 0)
);

alter table public.mileage_settings enable row level security;

drop policy if exists "Users select own mileage settings" on public.mileage_settings;
drop policy if exists "Users insert own mileage settings" on public.mileage_settings;
drop policy if exists "Users update own mileage settings" on public.mileage_settings;
drop policy if exists "Users delete own mileage settings" on public.mileage_settings;

create policy "Users select own mileage settings"
  on public.mileage_settings for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own mileage settings"
  on public.mileage_settings for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own mileage settings"
  on public.mileage_settings for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own mileage settings"
  on public.mileage_settings for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.mileage_settings to authenticated;

-- One row per user per Eastern calendar day. Upsert on (user_id, log_date)
-- so closing another lead updates that day instead of inserting a second row.
-- stops: every closed lead that day, with included true/false.
-- legs: driving legs for the included stops (home, stops in order, home).
-- manual_trips: extra trips he added (office meeting, a leg with no lead).
-- excluded_stop_ids / included_stop_ids: toggles that stick across auto updates.
create table if not exists public.mileage_log (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  log_date            date not null,
  business_purpose    text not null default 'LeafFilter sales appointments',
  note                text,
  home_address        text,
  stops               jsonb not null default '[]'::jsonb,
  legs                jsonb not null default '[]'::jsonb,
  manual_trips        jsonb not null default '[]'::jsonb,
  excluded_stop_ids   jsonb not null default '[]'::jsonb,
  included_stop_ids   jsonb not null default '[]'::jsonb,
  total_miles         numeric(10,1),
  miles_customized    boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint mileage_log_user_date_key unique (user_id, log_date)
);

alter table public.mileage_log enable row level security;

drop policy if exists "Users select own mileage log" on public.mileage_log;
drop policy if exists "Users insert own mileage log" on public.mileage_log;
drop policy if exists "Users update own mileage log" on public.mileage_log;
drop policy if exists "Users delete own mileage log" on public.mileage_log;

create policy "Users select own mileage log"
  on public.mileage_log for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own mileage log"
  on public.mileage_log for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own mileage log"
  on public.mileage_log for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own mileage log"
  on public.mileage_log for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.mileage_log to authenticated;

create index if not exists mileage_log_user_date_idx
  on public.mileage_log (user_id, log_date desc);
