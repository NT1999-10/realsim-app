-- BITには物件ごとの固定URLが存在しないため、既存テーブルのURL制約を解除する。
alter table public.auction_items
  alter column bit_url drop not null;
