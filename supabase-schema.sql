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

-- range_min/range_max track the widest page range this session was
-- ever quizzed on (see record_attempt() below, which widens them on
-- every answer) — this is the *configured* range (e.g. "من 2 إلى 49"
-- for سورة البقرة), not just whichever pages happened to come up.
alter table public.sessions
  add column if not exists range_min int,
  add column if not exists range_max int;

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

-- 5) Lifetime stats (levels) + achievements (badges) — account-wide,
--    across every session (even deleted ones), not per-session.

create table if not exists public.user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp int not null default 0,
  total_correct int not null default 0,
  total_answers int not null default 0,
  current_streak int not null default 0,
  best_streak int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_stats
  add column if not exists last_attempt_at timestamptz;

alter table public.user_stats enable row level security;

-- Public read (no sensitive data — just counts), same spirit as
-- profiles, so a level could be shown next to a leaderboard entry.
-- All writes happen only via record_attempt() below (security
-- definer), so no insert/update policy is needed or granted here.
drop policy if exists "Stats are viewable by everyone" on public.user_stats;
create policy "Stats are viewable by everyone"
  on public.user_stats for select
  using (true);

create table if not exists public.achievements (
  code text primary key,
  title text not null,
  description text not null,
  icon text not null default '🏅',
  sort_order int not null default 0
);

alter table public.achievements enable row level security;

drop policy if exists "Achievements catalog is public" on public.achievements;
create policy "Achievements catalog is public"
  on public.achievements for select
  using (true);

insert into public.achievements (code, title, description, icon, sort_order) values
  ('first_correct',      'أول إجابة صحيحة',   'أجب عن أول سؤال بشكل صحيح',                                   '🌱', 1),
  ('correct_100',        '100 إجابة صحيحة',   'اجمع 100 إجابة صحيحة على مستوى كل جلساتك',                    '💯', 2),
  ('correct_500',        '500 إجابة صحيحة',   'اجمع 500 إجابة صحيحة على مستوى كل جلساتك',                    '🥉', 3),
  ('correct_1000',       '1000 إجابة صحيحة',  'اجمع 1000 إجابة صحيحة على مستوى كل جلساتك',                   '🥇', 4),
  ('streak_10',          'سلسلة 10 متتالية',  'أجب عن 10 أسئلة متتالية بشكل صحيح',                           '🔥', 5),
  ('streak_25',          'سلسلة 25 متتالية',  'أجب عن 25 سؤالاً متتالياً بشكل صحيح',                          '⚡', 6),
  ('perfect_session',    'جلسة مثالية',        'أنهِ جلسة من 20 سؤالاً على الأقل بدقة 100%',                   '🏆', 7),
  ('wide_coverage_500',  'مسافر في القرآن',    'أجب عن أسئلة من 500 صفحة مختلفة على الأقل عبر كل جلساتك',     '🗺️', 8)
on conflict (code) do nothing;

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null references public.achievements(code) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, code)
);

alter table public.user_achievements enable row level security;

drop policy if exists "Users view their own achievements" on public.user_achievements;
create policy "Users view their own achievements"
  on public.user_achievements for select
  using (auth.uid() = user_id);

-- 6) record_attempt(): inserts the attempt, widens the session's
--    range_min/range_max, updates lifetime XP/streak, and awards any
--    newly-earned badges — all in one atomic call (see
--    supabase-client.js). Returns {earned: text[], xp: int} as jsonb —
--    "earned" are badge codes newly earned by THIS call, "xp" is the
--    user's updated lifetime XP — so the client can show a toast and
--    refresh the level badge without a second round trip. security
--    definer so it can write all these tables in one go, but every
--    write is still pinned to auth.uid() — a user can only ever
--    record or widen their own rows.
--
--    Rate limited to one recorded attempt per 350ms per user (well
--    under any realistic "read the question, tap a choice" pace) —
--    calls faster than that are silently no-ops (current xp is still
--    returned so the client doesn't error), which quietly caps
--    scripted XP/leaderboard inflation without ever disrupting a
--    genuine fast answer.
--
--    Dropped and recreated (not just "or replace") because its
--    return type changed (void → text[] → jsonb across revisions).
drop function if exists public.record_attempt(bigint, text, int, boolean, int, int);

create function public.record_attempt(
  p_session_id bigint,
  p_question_type text,
  p_page int,
  p_is_correct boolean,
  p_range_min int default null,
  p_range_max int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_xp int;
  v_last_attempt_at timestamptz;
  v_total_correct int;
  v_best_streak int;
  v_session_total int;
  v_session_correct int;
  v_distinct_pages int;
  v_code text;
  v_earned text[] := '{}';
begin
  select xp, last_attempt_at into v_xp, v_last_attempt_at
  from public.user_stats where user_id = v_uid;

  if v_last_attempt_at is not null and clock_timestamp() - v_last_attempt_at < interval '350 milliseconds' then
    return jsonb_build_object('earned', '[]'::jsonb, 'xp', coalesce(v_xp, 0));
  end if;

  insert into public.attempts (user_id, session_id, question_type, page, is_correct)
  values (v_uid, p_session_id, p_question_type, p_page, p_is_correct);

  if p_session_id is not null and p_range_min is not null and p_range_max is not null then
    -- least()/greatest() ignore NULLs, so this also seeds the very
    -- first value correctly (range_min/range_max start out NULL).
    update public.sessions
    set range_min = least(range_min, p_range_min),
        range_max = greatest(range_max, p_range_max)
    where id = p_session_id and user_id = v_uid;
  end if;

  insert into public.user_stats (user_id, xp, total_correct, total_answers, current_streak, best_streak, last_attempt_at)
  values (
    v_uid,
    case when p_is_correct then 10 else 0 end,
    case when p_is_correct then 1 else 0 end,
    1,
    case when p_is_correct then 1 else 0 end,
    case when p_is_correct then 1 else 0 end,
    clock_timestamp()
  )
  on conflict (user_id) do update set
    xp = public.user_stats.xp + (case when p_is_correct then 10 else 0 end),
    total_correct = public.user_stats.total_correct + (case when p_is_correct then 1 else 0 end),
    total_answers = public.user_stats.total_answers + 1,
    current_streak = case when p_is_correct then public.user_stats.current_streak + 1 else 0 end,
    best_streak = greatest(
      public.user_stats.best_streak,
      case when p_is_correct then public.user_stats.current_streak + 1 else 0 end
    ),
    last_attempt_at = clock_timestamp(),
    updated_at = now();

  select xp, total_correct, best_streak into v_xp, v_total_correct, v_best_streak
  from public.user_stats where user_id = v_uid;

  -- milestone badges (each check is a no-op once already earned,
  -- thanks to the primary key + on conflict do nothing)
  if v_total_correct >= 1 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'first_correct')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if v_total_correct >= 100 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'correct_100')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if v_total_correct >= 500 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'correct_500')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if v_total_correct >= 1000 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'correct_1000')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if v_best_streak >= 10 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'streak_10')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if v_best_streak >= 25 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'streak_25')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if p_session_id is not null then
    select count(*), count(*) filter (where is_correct)
      into v_session_total, v_session_correct
    from public.attempts
    where session_id = p_session_id;

    if v_session_total >= 20 and v_session_correct = v_session_total then
      v_code := null;
      insert into public.user_achievements (user_id, code) values (v_uid, 'perfect_session')
        on conflict do nothing returning code into v_code;
      if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
    end if;
  end if;

  select count(distinct page) into v_distinct_pages
  from public.attempts where user_id = v_uid;

  if v_distinct_pages >= 500 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'wide_coverage_500')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  return jsonb_build_object('earned', to_jsonb(v_earned), 'xp', v_xp);
end;
$$;

grant execute on function public.record_attempt(bigint, text, int, boolean, int, int) to authenticated;

-- 7) Backfill: give existing users (from before sessions existed) a
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
    insert into public.sessions (user_id, title, range_min, range_max)
    values (r.user_id, 'الجلسة الأولى', 1, 604)
    returning id into new_id;

    update public.attempts
      set session_id = new_id
      where user_id = r.user_id and session_id is null;

    insert into public.user_settings (user_id, active_session_id)
      values (r.user_id, new_id)
      on conflict (user_id) do update set active_session_id = excluded.active_session_id;
  end loop;
end $$;

-- 8) Auto-create a profile, a first session, and settings whenever a
--    new auth user signs up.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_session_id bigint;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'مستخدم'));

  insert into public.sessions (user_id, title, range_min, range_max)
  values (new.id, 'الجلسة الأولى', 1, 604)
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

-- 9) "My sessions" — each user's own sessions with live totals.
--    The where-clause restricts results to the caller even though the
--    view itself runs with owner privileges (bypassing RLS on the
--    underlying tables), so the filter has to be explicit here.
create or replace view public.session_summary as
select
  s.id as session_id,
  s.user_id,
  s.title,
  s.is_public,
  s.range_min,
  s.range_max,
  s.created_at,
  count(a.id) as total_answers,
  count(a.id) filter (where a.is_correct) as total_correct,
  max(a.created_at) as last_active
from public.sessions s
left join public.attempts a on a.session_id = s.id
where s.user_id = auth.uid()
group by s.id, s.user_id, s.title, s.is_public, s.range_min, s.range_max, s.created_at
order by s.created_at desc;

-- 10) Retire the old whole-profile leaderboard view — replaced by the
--     per-session one below.
drop view if exists public.leaderboard;

-- 11) Public leaderboard, per session. Ranking is computed
--     client-side (auth-ui.js) from accuracy (Wilson score lower
--     bound, so a small sample like 3/3 (100%) can't outrank a large
--     one like 74/75 (98.7%)), question count (baked into that same
--     bound), and page range breadth (range_min/range_max below,
--     falling back to attempts' min/max page for older sessions
--     recorded before this column existed) — a session quizzed
--     across a wide span of the Mushaf ranks above an equally-
--     accurate one that stuck to a handful of pages. owner_xp is
--     included so the client can show the player's level too.
create or replace view public.session_leaderboard as
select
  s.id as session_id,
  s.user_id,
  p.display_name,
  s.title,
  s.range_min,
  s.range_max,
  s.created_at as session_created_at,
  count(a.id) as total_answers,
  count(a.id) filter (where a.is_correct) as total_correct,
  case when count(a.id) = 0 then 0
       else round(100.0 * count(a.id) filter (where a.is_correct) / count(a.id), 1)
  end as accuracy_pct,
  min(a.page) as min_page,
  max(a.page) as max_page,
  max(a.created_at) as last_active,
  u.xp as owner_xp
from public.sessions s
join public.profiles p on p.id = s.user_id
left join public.attempts a on a.session_id = s.id
left join public.user_stats u on u.user_id = s.user_id
where s.is_public = true
group by s.id, s.user_id, p.display_name, s.title, s.range_min, s.range_max, s.created_at, u.xp;

-- 12) Only one public (leaderboard) session per user. The app UI
--     already enforces this (turning one session public quietly
--     turns any other one off first), but this constraint is the
--     real guarantee — it also protects against two browser
--     tabs/devices racing each other.
create unique index if not exists sessions_one_public_per_user
  on public.sessions (user_id)
  where is_public;

-- 13) Page range is chosen once, at session creation, and is
--     permanent from then on (see auth-ui.js's create-session modal).
--     This trigger is the real guarantee: if OLD.range_min/range_max
--     are already set, any UPDATE trying to change them is silently
--     pinned back to the original value instead of erroring — so it
--     can never break record_attempt()'s harmless no-op widen call
--     for a session whose range was already fixed at creation.
create or replace function public.prevent_range_change()
returns trigger as $$
begin
  if old.range_min is not null then
    new.range_min := old.range_min;
  end if;
  if old.range_max is not null then
    new.range_max := old.range_max;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists sessions_prevent_range_change on public.sessions;
create trigger sessions_prevent_range_change
  before update on public.sessions
  for each row execute procedure public.prevent_range_change();

-- ============================================================
-- Done. Next steps:
-- 1. Project Settings → API → copy "Project URL" and "anon public" key
-- 2. Paste them into config.js in the app (SUPABASE_URL must be just
--    the bare project URL, nothing appended after .supabase.co)
-- 3. Authentication → Providers → make sure Email is enabled
--    (Authentication → URL Configuration → add your site URL,
--    e.g. https://yourname.github.io/quran-flashcards, to Redirect URLs)
-- ============================================================
