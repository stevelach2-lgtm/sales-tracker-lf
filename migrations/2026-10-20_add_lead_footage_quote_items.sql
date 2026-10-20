-- LeafFilter Sales Tracker — quote footage and line items on leads
-- Apply once in the Supabase SQL editor (project gktnrjtmuxhnxggqgpny).
-- Additive only: two nullable columns. Safe to re-run.
-- Does not drop columns, rewrite lead rows, or change quoting / mileage tables.

alter table public.leads add column if not exists footage numeric;
alter table public.leads add column if not exists quote_items jsonb;

comment on column public.leads.footage is
  'Linear feet quoted: sum of LeafFilter Installation ft quantities and Roof Line Lighting Installation ft quantities.';

comment on column public.leads.quote_items is
  'Quote calculator lines that have a quantity. Each object is {s, l, u, qty, p}.';
