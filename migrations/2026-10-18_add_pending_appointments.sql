-- Already applied to the live Supabase project (gktnrjtmuxhnxggqgpny).
-- This file is the record of that change. Do not run it again on that database.
-- Pending rows are pre-entered appointments: no sales_date, no sale, no commission.

alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (status in ('sold','not_sold','pending'));
alter table public.leads add column if not exists appointment_at timestamptz, add column if not exists sf_opportunity_name text;
create index if not exists leads_pending_appt_idx on public.leads (user_id, appointment_at) where status = 'pending';
