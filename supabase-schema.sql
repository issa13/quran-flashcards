-- ============================================================
-- Quran Flashcards — Supabase schema
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- ============================================================

-- 1) Profiles: one row per user, public-safe fields only
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'مستخدم',
  show_on_leaderboard boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'مستخدم'));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2) User settings: synced across devices (last used config)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  question_type text not null default 'first',
  timer_seconds int not null default 30,
  range_key text not null default 'all',
  custom_min int not null default 1,
  custom_max int not null default 604,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users manage their own settings"
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3) Attempts: one row per answered flashcard (history + stats)
create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_type text not null,
  page int,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

alter table public.attempts enable row level security;

create policy "Users manage their own attempts"
  on public.attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists attempts_user_created_idx
  on public.attempts (user_id, created_at desc);

-- 4) Leaderboard: public view of opted-in users' totals
create or replace view public.leaderboard as
select
  p.id as user_id,
  p.display_name,
  count(a.id) as total_answers,
  count(a.id) filter (where a.is_correct) as total_correct,
  case when count(a.id) = 0 then 0
       else round(100.0 * count(a.id) filter (where a.is_correct) / count(a.id), 1)
  end as accuracy_pct,
  max(a.created_at) as last_active
from public.profiles p
join public.attempts a on a.user_id = p.id
where p.show_on_leaderboard = true
group by p.id, p.display_name
order by total_correct desc;

-- Views inherit RLS from underlying tables; attempts/profiles policies
-- above already restrict this to opted-in, correctly-scoped rows.

-- ============================================================
-- Done. Next steps:
-- 1. Project Settings → API → copy "Project URL" and "anon public" key
-- 2. Paste them into config.js in the app
-- 3. Authentication → Providers → make sure Email is enabled
--    (Authentication → URL Configuration → add your site URL,
--    e.g. https://yourname.github.io/quran-flashcards, to Redirect URLs)
-- ============================================================
