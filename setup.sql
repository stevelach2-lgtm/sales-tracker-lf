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

-- 2. LEADS TABLE
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  status       text not null check (status in ('sold', 'not_sold')),
  sale_amount  numeric(10,2),
  reason_id    uuid references public.not_sold_reasons(id) on delete set null,
  notes        text
);

-- 3. INDEXES for fast date queries
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);

-- 4. SEED DEFAULT "NOT SOLD" REASONS
insert into public.not_sold_reasons (label, sort_order) values
  ('Price too high',                        1),
  ('Needs to think about it',               2),
  ('Wants other quotes',                    3),
  ('Spouse not present / needs to discuss', 4),
  ('Financing denied',                      5),
  ('Not interested in product',             6),
  ('Already has gutter protection',         7),
  ('Home not a fit',                        8),
  ('Reschedule / Call back',                9),
  ('No one home',                          10)
on conflict do nothing;

-- 5. ROW LEVEL SECURITY (optional but recommended)
-- By default Supabase allows all with anon key. 
-- Enable RLS below once you're ready to lock it down.
-- alter table public.leads enable row level security;
-- alter table public.not_sold_reasons enable row level security;
-- create policy "Allow all" on public.leads for all using (true);
-- create policy "Allow all" on public.not_sold_reasons for all using (true);

-- ============================================================
-- Done! Your tables are ready.
-- ============================================================
