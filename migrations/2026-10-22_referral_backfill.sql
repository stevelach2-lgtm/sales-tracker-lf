-- LeafFilter Sales Tracker — one-time referral reminder dates
-- DO NOT APPLY until Steve approves. This file is not run by the app.
-- Project gktnrjtmuxhnxggqgpny. Apply once in the Supabase SQL editor after approval.
-- Additive only: one nullable column, then one UPDATE that fills it where it is still null.
-- Does not drop columns, change not-sold rows, or rewrite any other lead field.
-- Until this runs, the app computes the same stagger in memory and skips anyone without a phone.

alter table public.leads add column if not exists referral_backfill_on date;

comment on column public.leads.referral_backfill_on is
  'One-time due date for the referral reminder on sold jobs whose install_date is before 2026-10-22. NULL means the app still computes the 5-per-day stagger.';

with ranked as (
  select
    id,
    (date '2026-10-22' + (((row_number() over (order by sales_date, id) - 1) / 5)::int)) as due_on
  from public.leads
  where status = 'sold'
    and coalesce(is_cancelled, false) = false
    and sales_date >= date '2026-07-01'
    and install_date is not null
    and install_date < date '2026-10-22'
    and length(regexp_replace(coalesce(customer_phone, followup_phone, ''), '\D', '', 'g')) >= 10
)
update public.leads as l
set referral_backfill_on = ranked.due_on
from ranked
where l.id = ranked.id
  and l.referral_backfill_on is null;
