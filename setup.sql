-- ============================================================
-- LeafFilter Sales Tracker — Supabase Setup
-- Run this entire script in your Supabase SQL Editor
-- Supabase Dashboard → SQL Editor → New query → Paste → Run
-- ============================================================

-- 1. NOT SOLD REASONS TABLE
create table if not exists public.not_sold_reasons (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz default now()
);

-- 2. LEADS TABLE (full schema)
create table if not exists public.leads (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null default auth.uid() references auth.users(id),
  created_at        timestamptz default now(),
  status            text        not null check (status in ('sold', 'not_sold')),
  sale_amount       numeric(10,2),
  reason_id         uuid        references public.not_sold_reasons(id) on delete set null,
  notes             text,
  sale_type         text        check (sale_type in ('single','combo')),
  lead_type         text        check (lead_type in ('company','rehash','self_gen')),
  job_number        text,
  sales_date        date,
  install_date      date,
  commission_amount numeric(10,2),
  commission_paid   boolean     default false,
  is_cancelled      boolean     default false,
  is_btd            boolean     default false,
  followup_name     text,
  followup_phone    text,
  followup_date     date,
  followup_done     boolean     default false,
  retail_percentage numeric(10,2),
  commission_percentage numeric(10,2)
);

-- 3. MIGRATION: add missing columns to existing leads table (safe to re-run)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='sale_type') then
    alter table public.leads add column sale_type text check (sale_type in ('single','combo'));
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='lead_type') then
    alter table public.leads add column lead_type text check (lead_type in ('company','rehash','self_gen'));
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='job_number') then
    alter table public.leads add column job_number text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='sales_date') then
    alter table public.leads add column sales_date date;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='install_date') then
    alter table public.leads add column install_date date;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='commission_amount') then
    alter table public.leads add column commission_amount numeric(10,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='commission_paid') then
    alter table public.leads add column commission_paid boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='is_cancelled') then
    alter table public.leads add column is_cancelled boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='is_btd') then
    alter table public.leads add column is_btd boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='followup_name') then
    alter table public.leads add column followup_name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='followup_phone') then
    alter table public.leads add column followup_phone text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='followup_date') then
    alter table public.leads add column followup_date date;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='followup_done') then
    alter table public.leads add column followup_done boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='retail_percentage') then
    alter table public.leads add column retail_percentage numeric(10,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='commission_percentage') then
    alter table public.leads add column commission_percentage numeric(10,2);
  end if;
end $$;


-- 4. BACKFILL: set sales_date = created_at date for ALL leads missing a sales_date
-- (run this once after adding the column so old data is not orphaned)
-- NOTE: After this runs, edit old leads in the History tab to set their correct dates.
update public.leads
set    sales_date = created_at::date
where  sales_date is null;

-- 5. INDEXES for fast queries
create index if not exists leads_created_at_idx  on public.leads (created_at desc);
create index if not exists leads_status_idx       on public.leads (status);
create index if not exists leads_sales_date_idx   on public.leads (sales_date desc);  -- key index for dashboard

-- 6. SEED DEFAULT "NOT SOLD" REASONS
-- MIGRATION: Deduplicate reasons and add unique constraint safely
do $$ 
declare
    r record;
    survivor uuid;
begin
  if not exists (select 1 from pg_constraint where conname = 'not_sold_reasons_label_key') then
    -- Find groups of identical labels
    for r in (select label, array_agg(id order by created_at asc) as ids from public.not_sold_reasons group by label having count(*) > 1) loop
        survivor := r.ids[1];
        -- Point leads attached to duplicates to the survivor
        update public.leads set reason_id = survivor where reason_id = any(r.ids[2:array_length(r.ids, 1)]);
        -- Delete the duplicates
        delete from public.not_sold_reasons where id = any(r.ids[2:array_length(r.ids, 1)]);
    end loop;
    alter table public.not_sold_reasons add constraint not_sold_reasons_label_key unique (label);
  end if;
end $$;

-- MIGRATIONS: Clean up, merge, and rename reasons
do $$
declare
    old_id uuid;
    new_id uuid;
    r record;
begin
    -- 1. Spouse not present / needs to discuss -> Spouse not home
    select id into old_id from public.not_sold_reasons where label = 'Spouse not present / needs to discuss' limit 1;
    if found then
        select id into new_id from public.not_sold_reasons where label = 'Spouse not home' limit 1;
        if not found then
            insert into public.not_sold_reasons (label, sort_order) values ('Spouse not home', 4) returning id into new_id;
        end if;
        update public.leads set reason_id = new_id where reason_id = old_id;
        delete from public.not_sold_reasons where id = old_id;
    end if;

    -- 2. No show / not home -> No one home
    select id into old_id from public.not_sold_reasons where label = 'No show / not home' limit 1;
    if found then
        select id into new_id from public.not_sold_reasons where label = 'No one home' limit 1;
        if not found then
            insert into public.not_sold_reasons (label, sort_order) values ('No one home', 10) returning id into new_id;
        end if;
        update public.leads set reason_id = new_id where reason_id = old_id;
        delete from public.not_sold_reasons where id = old_id;
    end if;

    -- 3. Not interested in product -> No demo
    select id into old_id from public.not_sold_reasons where label = 'Not interested in product' limit 1;
    if found then
        select id into new_id from public.not_sold_reasons where label = 'No demo' limit 1;
        if not found then
            insert into public.not_sold_reasons (label, sort_order) values ('No demo', 6) returning id into new_id;
        end if;
        update public.leads set reason_id = new_id where reason_id = old_id;
        delete from public.not_sold_reasons where id = old_id;
    end if;

    -- 4. Delete Financing denied / declined
    delete from public.not_sold_reasons where label in ('Financing denied', 'Financing declined');

    -- 5. Rename Wants other quotes -> Shop around
    update public.not_sold_reasons set label = 'Shop around' where label = 'Wants other quotes';
    -- 6. Home not a fit -> No demo
    select id into old_id from public.not_sold_reasons where label = 'Home not a fit' limit 1;
    if found then
        select id into new_id from public.not_sold_reasons where label = 'No demo' limit 1;
        if not found then
            insert into public.not_sold_reasons (label, sort_order) values ('No demo', 6) returning id into new_id;
        end if;
        update public.leads set reason_id = new_id where reason_id = old_id;
        delete from public.not_sold_reasons where id = old_id;
    end if;

    -- 7. Already has gutter protection -> No demo
    select id into old_id from public.not_sold_reasons where label = 'Already has gutter protection' limit 1;
    if found then
        select id into new_id from public.not_sold_reasons where label = 'No demo' limit 1;
        if not found then
            insert into public.not_sold_reasons (label, sort_order) values ('No demo', 6) returning id into new_id;
        end if;
        update public.leads set reason_id = new_id where reason_id = old_id;
        delete from public.not_sold_reasons where id = old_id;
    end if;

    -- 8. Reschedule / Call back -> No one home
    select id into old_id from public.not_sold_reasons where label = 'Reschedule / Call back' limit 1;
    if found then
        select id into new_id from public.not_sold_reasons where label = 'No one home' limit 1;
        if not found then
            insert into public.not_sold_reasons (label, sort_order) values ('No one home', 10) returning id into new_id;
        end if;
        update public.leads set reason_id = new_id where reason_id = old_id;
        delete from public.not_sold_reasons where id = old_id;
    end if;

    -- 9. Price too high -> Too much
    select id into old_id from public.not_sold_reasons where label = 'Price too high' limit 1;
    if found then
        select id into new_id from public.not_sold_reasons where label = 'Too much' limit 1;
        if not found then
            insert into public.not_sold_reasons (label, sort_order) values ('Too much', 1) returning id into new_id;
        end if;
        update public.leads set reason_id = new_id where reason_id = old_id;
        delete from public.not_sold_reasons where id = old_id;
    end if;

    -- 10. Consolidate all variations of 'Too much' (e.g. 'Too Much', 'Too much ')
    select id into new_id from public.not_sold_reasons where label = 'Too much' limit 1;
    if not found then
        insert into public.not_sold_reasons (label, sort_order) values ('Too much', 1) returning id into new_id;
    end if;

    for r in (select id from public.not_sold_reasons where id != new_id and lower(trim(label)) = 'too much') loop
        update public.leads set reason_id = new_id where reason_id = r.id;
        delete from public.not_sold_reasons where id = r.id;
    end loop;

end $$;

insert into public.not_sold_reasons (label, sort_order) values
  ('Too much',                              1),
  ('Needs to think about it',               2),
  ('Shop around',                           3),
  ('Spouse not home',                       4),
  ('No demo',                               6),
  ('No one home',                          10)
on conflict (label) do nothing;

-- 7. APP SETTINGS TABLE (stores goals & grading baselines per user)
create table if not exists public.app_settings (
  id          uuid primary key default auth.uid(),
  user_id     uuid not null default auth.uid() references auth.users(id),
  nvpil       numeric default 2000,
  slg         numeric default 55,
  ntg         numeric default 80,
  cr          numeric default 50,
  daily_sales numeric default 2,
  weekly_rev  numeric default 5000,
  comm_goal   numeric default 5000,
  updated_at  timestamptz default now()
);

-- ============================================================
-- MIGRATION FOR EXISTING SETUP (Run if you already created tables):
-- ============================================================
do $$ begin
  -- Add user_id to leads
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='user_id') then
    alter table public.leads add column user_id uuid references auth.users(id) default auth.uid();
  end if;
  
  -- For settings, since old one used integer ID = 1, we drop and recreate for UUID
  -- (If migrating old settings data is needed, handle carefully. Otherwise just drop)
  if exists (select 1 from information_schema.columns where table_name='app_settings' and data_type='integer' and column_name='id') then
    drop table public.app_settings;
    create table public.app_settings (
      id          uuid primary key default auth.uid(),
      user_id     uuid not null default auth.uid() references auth.users(id),
      nvpil       numeric default 2000,
      slg         numeric default 55,
      ntg         numeric default 80,
      cr          numeric default 50,
      daily_sales numeric default 2,
      weekly_rev  numeric default 5000,
      comm_goal   numeric default 5000,
      updated_at  timestamptz default now()
    );
  end if;
end $$;

-- 8. ROW LEVEL SECURITY (Mandatory for Multi-User)
alter table public.leads enable row level security;
alter table public.not_sold_reasons enable row level security;
alter table public.app_settings enable row level security;

-- Leads: Users can only see and modify their own leads
drop policy if exists "Users can manage their own leads" on public.leads;
create policy "Users can manage their own leads" on public.leads for all using (auth.uid() = user_id);

-- Settings: Users can only see and modify their own settings
drop policy if exists "Users can manage their own settings" on public.app_settings;
create policy "Users can manage their own settings" on public.app_settings for all using (auth.uid() = user_id);

-- Reasons (Shared Data): Anyone logged in can read, update, or insert reasons
drop policy if exists "Authenticated users can read reasons" on public.not_sold_reasons;
create policy "Authenticated users can read reasons" on public.not_sold_reasons for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can modify reasons" on public.not_sold_reasons;
create policy "Authenticated users can modify reasons" on public.not_sold_reasons for all using (auth.role() = 'authenticated');

-- ============================================================
-- Done! Your tables are ready.
-- ============================================================
