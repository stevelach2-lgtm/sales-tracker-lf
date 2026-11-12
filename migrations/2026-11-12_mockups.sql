-- NOT APPLIED. Bob runs this in the Supabase SQL editor after Steve approves it.
-- Adds the night-mockup request table, lead columns, and a private Storage bucket.
-- Does not change commission, pricing, or any existing row's money fields.
-- Safe to run once. Uses IF NOT EXISTS / drop policy if exists.

alter table public.leads
  add column if not exists mockup_status text,
  add column if not exists mockup_after_path text,
  add column if not exists mockup_before_path text,
  add column if not exists mockup_texted_at timestamptz,
  add column if not exists mockup_error text;

alter table public.leads drop constraint if exists leads_mockup_status_check;
alter table public.leads
  add constraint leads_mockup_status_check
  check (mockup_status is null or mockup_status in ('requested', 'in_progress', 'ready', 'failed'));

comment on column public.leads.mockup_status is
  'Night mockup: requested, in_progress, ready, or failed. Null when Steve has not asked.';
comment on column public.leads.mockup_error is
  'Why a mockup could not be made. Shown with the Try again button.';

create table if not exists public.mockup_requests (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  status        text not null default 'requested'
                check (status in ('requested', 'in_progress', 'ready', 'failed')),
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  ready_at      timestamptz,
  before_path   text,
  after_path    text,
  style_notes   text default 'Warm white, individual pinpoint lights, evenly spaced along the roofline and fascia; never a continuous strip, rope, or glow line',
  error         text
);

alter table public.mockup_requests enable row level security;

drop policy if exists "Users select own mockup requests" on public.mockup_requests;
drop policy if exists "Users insert own mockup requests" on public.mockup_requests;
drop policy if exists "Users update own mockup requests" on public.mockup_requests;
drop policy if exists "Users delete own mockup requests" on public.mockup_requests;

create policy "Users select own mockup requests"
  on public.mockup_requests for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own mockup requests"
  on public.mockup_requests for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own mockup requests"
  on public.mockup_requests for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own mockup requests"
  on public.mockup_requests for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.mockup_requests to authenticated;

-- Private bucket. The app reads with signed URLs. Bob writes only through
-- /api/mockup-upload (service role), never from the browser with a public URL.
insert into storage.buckets (id, name, public)
values ('mockups', 'mockups', false)
on conflict (id) do update set public = false;

drop policy if exists "Mockup owner read" on storage.objects;
drop policy if exists "Mockup owner insert" on storage.objects;
drop policy if exists "Mockup owner update" on storage.objects;
drop policy if exists "Mockup owner delete" on storage.objects;

create policy "Mockup owner read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'mockups'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Mockup owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mockups'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Mockup owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'mockups'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'mockups'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Mockup owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'mockups'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
