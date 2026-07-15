-- 現実派: PR#3 相場照合キャッシュ追加SQL
-- 既存環境は Supabase Dashboard の SQL Editor で全文を実行してください。

create table if not exists public.market_cache (
  key text primary key,          -- pref:city:type
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.market_cache enable row level security;

-- クライアントからは直接読み書きさせない。
-- RLSポリシーは作成せず、サーバーのservice_roleからのみ操作する。
