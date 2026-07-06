-- 【既にschema.sqlを実行済みの人向け】追加分のみ
-- Supabaseダッシュボード → SQL Editor に貼り付けて Run

create table public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);
alter table public.user_data enable row level security;
create policy "own data select" on public.user_data for select using (auth.uid() = user_id);
create policy "own data insert" on public.user_data for insert with check (auth.uid() = user_id);
create policy "own data update" on public.user_data for update using (auth.uid() = user_id);
create policy "own data delete" on public.user_data for delete using (auth.uid() = user_id);
