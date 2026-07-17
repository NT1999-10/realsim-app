-- 現実派: PR#5 競売物件スキーマ追加SQL
-- 既存環境は Supabase Dashboard の SQL Editor で全文を実行してください。

create table if not exists public.auction_items (
  id text primary key,                -- 裁判所コード+事件番号+物件番号
  court text,
  case_no text,
  item_no int,
  pref text,
  city text,
  address text,
  type text,                          -- マンション/戸建て/土地/その他
  min_price bigint,                   -- 売却基準価額(円)
  deposit bigint,                     -- 買受申出保証額(円)
  bid_start date,
  bid_end date,
  open_date date,
  built_year int,
  floor_area numeric,
  land_area numeric,
  bit_url text not null,
  active boolean not null default true,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auction_items_pref_type_active_idx
  on public.auction_items (pref, type, active);
create index if not exists auction_items_bid_end_idx
  on public.auction_items (bid_end);

alter table public.auction_items enable row level security;

-- クライアントからは直接読み書きさせない。
-- RLSポリシーは作成せず、サーバーのservice_roleからのみ操作する。
