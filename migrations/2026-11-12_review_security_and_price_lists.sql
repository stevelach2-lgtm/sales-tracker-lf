-- REVIEW ONLY. Do not run this until Steve has read it.
-- This file is not applied by the app. It does not change production by itself.
--
-- 1. Price lists can sync to app_settings once these columns exist.
--    Until then the phone keeps price lists in local storage and will not
--    fail the rest of the settings save if the columns are missing.
-- 2. not_sold_reasons currently has a policy named "allow all" (USING true,
--    WITH CHECK true). That lets anyone with the anon key read and change
--    every not-sold reason. Drop it. Keep read access for signed-in users,
--    and limit writes to the account that owns the oldest profile row
--    (the tracker owner). Confirm that row is Steve's before running.
-- 3. In the Supabase dashboard, turn off open sign-ups:
--    Authentication → Providers → Email → disable "Allow new users to sign up".
--    The app no longer shows Create Account. The dashboard switch is what
--    actually stops a new account.
-- 4. Backup tables are listed at the bottom. This script does NOT drop them.

alter table public.app_settings
  add column if not exists price_list_leaffilter jsonb,
  add column if not exists price_list_roofline jsonb;

drop policy if exists "allow all" on public.not_sold_reasons;
drop policy if exists "Authenticated users can modify reasons" on public.not_sold_reasons;

drop policy if exists "Owner can modify reasons" on public.not_sold_reasons;
create policy "Owner can modify reasons"
  on public.not_sold_reasons
  for all
  to authenticated
  using (
    auth.uid() = (
      select p.id from public.profiles p
      order by p.created_at asc nulls last
      limit 1
    )
  )
  with check (
    auth.uid() = (
      select p.id from public.profiles p
      order by p.created_at asc nulls last
      limit 1
    )
  );

-- Read policies already on the table (left in place):
--   "Authenticated users can read reasons"
--   "Authenticated users read reasons"
-- Both allow select where auth.role() = 'authenticated'.

-- Backup tables seen in public, still with RLS on. Move or drop them
-- only after Steve confirms nothing else reads them:
--   followup_templates_backup_20261021
--   followup_touches_backup_20261021
--   leads_backup_20261018
--   leads_backup_20261028
--   leads_backup_20261030
--   leads_deleted_backup
--   leads_deleted_backup_20261026
--   leads_deleted_backup_20261030
--   leaffilter-sales
--
-- Example, still commented out:
-- drop table if exists public.leads_backup_20261018;
-- drop table if exists public.leads_backup_20261028;
-- drop table if exists public.leads_backup_20261030;
-- drop table if exists public.leads_deleted_backup;
-- drop table if exists public.leads_deleted_backup_20261026;
-- drop table if exists public.leads_deleted_backup_20261030;
-- drop table if exists public.followup_templates_backup_20261021;
-- drop table if exists public.followup_touches_backup_20261021;
-- drop table if exists public."leaffilter-sales";
