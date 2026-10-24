-- LeafFilter + Lighting combo sales.
-- NOT applied to production by this change. Run it in the Supabase SQL editor when ready.
-- Idempotent: ADD COLUMN IF NOT EXISTS. Additive only. Does not update or delete existing rows.
--
-- One leads row holds the job:
--   sale_type = 'combo'
--   product = 'leaffilter'
--   sale_amount = LeafFilter dollars + lighting dollars (the combined total)
--   lighting_amount = lighting dollars only
--   commission_amount = the one commission LeafFilter pays for the job
-- Older gutter + LeafFilter combos stay sale_type 'combo' with lighting_amount null.
-- Their sale_amount is still the combined gutter amount and they are not lighting sales.

alter table public.leads add column if not exists lighting_amount numeric(10,2);

comment on column public.leads.lighting_amount is
  'Lighting portion of a LeafFilter + Lighting combo (sale_type = combo). Null on single-product sales and on older gutter + LeafFilter combos. sale_amount stays the combined total.';
