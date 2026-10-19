-- LeafFilter Sales Tracker — no-sale follow-up touches
-- Apply once in the Supabase SQL editor (project gktnrjtmuxhnxggqgpny).
-- Additive only: new tables, nullable columns, and one optional reason row.
-- Does not drop columns, rewrite lead rows, or change quoting / mileage tables.

alter table public.leads add column if not exists followup_status text;
alter table public.leads add column if not exists followup_stopped_reason text;

comment on column public.leads.followup_status is
  'Follow-up sequence state: active, stopped, or completed. NULL means the app treats a not-sold lead as active when its reason has a cadence.';
comment on column public.leads.followup_stopped_reason is
  'Why the sequence ended: not_interested, opt_out, wrong_number, rehash_booked, sold, or completed.';

-- One row each time Steve taps Text and Messages opens.
create table if not exists public.followup_touches (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id     uuid        not null references public.leads(id) on delete cascade,
  step_key    text        not null,
  step_num    int,
  sent_at     timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.followup_touches enable row level security;

drop policy if exists "Users select own followup touches" on public.followup_touches;
drop policy if exists "Users insert own followup touches" on public.followup_touches;
drop policy if exists "Users update own followup touches" on public.followup_touches;
drop policy if exists "Users delete own followup touches" on public.followup_touches;

create policy "Users select own followup touches"
  on public.followup_touches for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own followup touches"
  on public.followup_touches for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own followup touches"
  on public.followup_touches for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own followup touches"
  on public.followup_touches for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.followup_touches to authenticated;

create index if not exists followup_touches_user_lead_idx
  on public.followup_touches (user_id, lead_id, sent_at desc);

-- Per-user SMS templates. One row per account. Does not replace cc_fu_msgs until the app migrates it.
create table if not exists public.followup_templates (
  user_id     uuid        primary key default auth.uid() references auth.users(id) on delete cascade,
  templates   jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.followup_templates enable row level security;

drop policy if exists "Users select own followup templates" on public.followup_templates;
drop policy if exists "Users insert own followup templates" on public.followup_templates;
drop policy if exists "Users update own followup templates" on public.followup_templates;
drop policy if exists "Users delete own followup templates" on public.followup_templates;

create policy "Users select own followup templates"
  on public.followup_templates for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own followup templates"
  on public.followup_templates for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own followup templates"
  on public.followup_templates for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own followup templates"
  on public.followup_templates for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.followup_templates to authenticated;

-- Shared reason list. Insert the row only when that label is not already there.
insert into public.not_sold_reasons (label, sort_order)
select 'No show', 11
where not exists (
  select 1 from public.not_sold_reasons where lower(trim(label)) = 'no show'
);
