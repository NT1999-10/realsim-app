-- 現実派: Supabase 初期セットアップSQL
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて Run してください

-- ユーザープロファイル(プラン・AI利用回数・Stripe顧客ID)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free',
  ai_used int not null default 0,
  ai_month text not null default '',
  stripe_customer_id text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- 本人は自分の行を読める(書き込みポリシーは作らない = 変更はサーバー側のみ)
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- 新規登録時にプロファイルを自動作成
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
