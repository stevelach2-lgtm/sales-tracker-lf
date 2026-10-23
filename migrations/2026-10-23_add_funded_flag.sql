-- LeafFilter Sales Tracker — funded flag on sold jobs
-- Already applied on project gktnrjtmuxhnxggqgpny. Kept here so the repo matches production.
-- Idempotent: ADD COLUMN IF NOT EXISTS, so running this again changes nothing.
-- Additive only. Does not drop columns or rewrite other lead fields.
-- Steve sets is_funded and funded_at directly in the database.

alter table public.leads add column if not exists is_funded boolean not null default false;
alter table public.leads add column if not exists funded_at date;

comment on column public.leads.is_funded is
  'True when a sold job is funded and the commission is being paid. Unpaid funded jobs show in blue on the Commissions list.';
comment on column public.leads.funded_at is
  'Date the job was marked funded. Null until set.';
