-- ============================================================
-- Quran Flashcards — Supabase schema (single source of truth)
--
-- Run this ONCE in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste this whole file → Run)
--
-- Safe to run on:
--   - a brand new project (nothing exists yet), OR
--   - your existing project that already ran an earlier version of
--     this file (everything is guarded with IF NOT EXISTS / OR REPLACE,
--     and it backfills your existing data into sessions automatically)
-- ============================================================

-- 1) Profiles: one row per user, public-safe fields only
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'مستخدم',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Drop the old profile-level leaderboard opt-in — leaderboard is now
-- per-session (see sessions.is_public below), not per-user.
alter table public.profiles drop column if exists show_on_leaderboard;

-- 2) Sessions: a user can have many; each groups its own attempts
--    and can optionally be published to the public leaderboard.
create table if not exists public.sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'جلسة جديدة',
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.sessions enable row level security;

drop policy if exists "Users manage their own sessions" on public.sessions;
create policy "Users manage their own sessions"
  on public.sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Public sessions are visible to everyone" on public.sessions;
create policy "Public sessions are visible to everyone"
  on public.sessions for select
  using (is_public = true);

-- 3) User settings: synced across devices (last used config +
--    which session is currently "active" and receiving attempts)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  question_type text not null default 'first',
  timer_seconds int not null default 30,
  range_key text not null default 'all',
  custom_min int not null default 1,
  custom_max int not null default 604,
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  add column if not exists active_session_id bigint references public.sessions(id) on delete set null;

alter table public.user_settings enable row level security;

drop policy if exists "Users manage their own settings" on public.user_settings;
create policy "Users manage their own settings"
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4) Attempts: one row per answered flashcard, grouped into a session
create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_type text not null,
  page int,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

alter table public.attempts
  add column if not exists session_id bigint references public.sessions(id) on delete cascade;

alter table public.attempts enable row level security;

drop policy if exists "Users manage their own attempts" on public.attempts;
create policy "Users manage their own attempts"
  on public.attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists attempts_user_created_idx
  on public.attempts (user_id, created_at desc);
create index if not exists attempts_session_idx
  on public.attempts (session_id);

-- 5) Backfill: give existing users (from before sessions existed) a
--    default session and attach their orphaned attempts to it.
--    No-op on a fresh project (nothing to backfill).
do $$
declare
  r record;
  new_id bigint;
begin
  for r in
    select distinct user_id from public.attempts where session_id is null
  loop
    insert into public.sessions (user_id, title)
    values (r.user_id, 'الجلسة الأولى')
    returning id into new_id;

    update public.attempts
      set session_id = new_id
      where user_id = r.user_id and session_id is null;

    insert into public.user_settings (user_id, active_session_id)
      values (r.user_id, new_id)
      on conflict (user_id) do update set active_session_id = excluded.active_session_id;
  end loop;
end $$;

-- 6) Auto-create a profile, a first session, and settings whenever a
--    new auth user signs up.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_session_id bigint;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'مستخدم'));

  insert into public.sessions (user_id, title)
  values (new.id, 'الجلسة الأولى')
  returning id into new_session_id;

  insert into public.user_settings (user_id, active_session_id)
  values (new.id, new_session_id);

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 7) "My sessions" — each user's own sessions with live totals.
--    The where-clause restricts results to the caller even though the
--    view itself runs with owner privileges (bypassing RLS on the
--    underlying tables), so the filter has to be explicit here.
create or replace view public.session_summary as
select
  s.id as session_id,
  s.user_id,
  s.title,
  s.is_public,
  s.created_at,
  count(a.id) as total_answers,
  count(a.id) filter (where a.is_correct) as total_correct,
  min(a.page) as range_min,
  max(a.page) as range_max,
  max(a.created_at) as last_active
from public.sessions s
left join public.attempts a on a.session_id = s.id
where s.user_id = auth.uid()
group by s.id, s.user_id, s.title, s.is_public, s.created_at
order by s.created_at desc;

-- 8) Retire the old whole-profile leaderboard view — replaced by the
--    per-session one below.
drop view if exists public.leaderboard;

-- 9) Public leaderboard, per session. Ranking uses a Wilson score
--    lower bound computed client-side (auth-ui.js) so a small sample
--    like 3/3 (100%) can't outrank a large one like 74/75 (98.7%).
create or replace view public.session_leaderboard as
select
  s.id as session_id,
  s.user_id,
  p.display_name,
  s.title,
  s.created_at as session_created_at,
  count(a.id) as total_answers,
  count(a.id) filter (where a.is_correct) as total_correct,
  case when count(a.id) = 0 then 0
       else round(100.0 * count(a.id) filter (where a.is_correct) / count(a.id), 1)
  end as accuracy_pct,
  min(a.page) as range_min,
  max(a.page) as range_max,
  max(a.created_at) as last_active
from public.sessions s
join public.profiles p on p.id = s.user_id
left join public.attempts a on a.session_id = s.id
where s.is_public = true
group by s.id, s.user_id, p.display_name, s.title, s.created_at;

-- ============================================================
-- Done. Next steps:
-- 1. Project Settings → API → copy "Project URL" and "anon public" key
-- 2. Paste them into config.js in the app (SUPABASE_URL must be just
--    the bare project URL, nothing appended after .supabase.co)
-- 3. Authentication → Providers → make sure Email is enabled
--    (Authentication → URL Configuration → add your site URL,
--    e.g. https://yourname.github.io/quran-flashcards, to Redirect URLs)
-- ============================================================