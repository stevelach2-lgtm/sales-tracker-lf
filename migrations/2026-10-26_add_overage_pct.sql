-- Per-product overage commission percent on app_settings.
-- Overage is the dollars above par (sale − $500 admin − finance − par).
-- Commission on a sale at or above par is 8% of par plus this percent of that overage.
-- Both products default to 40, which is the rate the calculators used before this column existed.
-- Does not update leads. Saved sale amounts and commission amounts stay as they were logged.
-- Idempotent: safe to run more than once.

alter table public.app_settings add column if not exists overage_pct_leaffilter numeric default 40;
alter table public.app_settings add column if not exists overage_pct_roofline numeric default 40;

comment on column public.app_settings.overage_pct_leaffilter is
  'Percent of LeafFilter dollars above par paid as commission. Default 40. Does not rewrite saved leads.';
comment on column public.app_settings.overage_pct_roofline is
  'Percent of Lighting dollars above par paid as commission. Default 40. Does not rewrite saved leads.';
