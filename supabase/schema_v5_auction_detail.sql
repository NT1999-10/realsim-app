-- 競売3点セットPDF解析で得る詳細項目（既存環境への追加分）
alter table public.auction_items
  add column if not exists buyable_price bigint,
  add column if not exists appraisal_value bigint,
  add column if not exists property_tax_yen int,
  add column if not exists city_planning_tax_yen int,
  add column if not exists zoning text,
  add column if not exists building_coverage numeric,
  add column if not exists floor_area_ratio numeric,
  add column if not exists occupancy text,
  add column if not exists price_reduced boolean default false,
  add column if not exists notes text;
