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

-- friend_code: a short public identifier a user shares out-of-band so
-- someone else can send them a friend request (see friend_requests
-- below) — replaces the earlier link-token sharing model entirely.
alter table public.profiles add column if not exists friend_code text;

update public.profiles
set friend_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
where friend_code is null;

alter table public.profiles alter column friend_code set not null;
create unique index if not exists profiles_friend_code_key on public.profiles (friend_code);

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
  ('wide_coverage_500',  'مسافر في القرآن',    'أجب عن أسئلة من 500 صفحة مختلفة على الأقل عبر كل جلساتك',     '🗺️', 8),
  ('streak_days_3',      'نشاط 3 أيام متتالية', 'مارس التطبيق 3 أيام متتالية',                                '📅', 9),
  ('streak_days_7',      'أسبوع كامل',          'مارس التطبيق 7 أيام متتالية',                                '🗓️', 10),
  ('streak_days_30',     'شهر كامل',            'مارس التطبيق 30 يومًا متتاليًا',                              '🌙', 11)
on conflict (code) do nothing;

-- 5b) type_correct_counts: per-question-type lifetime correct counter
-- (jsonb map like {"surah": 12, "juz": 4, ...}) — powers the
-- per-type "mastery" badges inserted just below, without needing a
-- separate table. Only ever written by record_attempt() (security
-- definer), same as the rest of user_stats.
alter table public.user_stats
  add column if not exists type_correct_counts jsonb not null default '{}'::jsonb;

-- 5c) Time-based badges. These use the *caller's local* hour/weekday
-- (passed in via record_attempt()'s p_local_hour/p_is_weekend params)
-- rather than the server's UTC clock, so "night owl" actually means
-- the person's own midnight, not Supabase's.
insert into public.achievements (code, title, description, icon, sort_order) values
  ('night_owl',        'بومة الليل',    'أجب عن سؤال بين منتصف الليل والساعة 5 فجرًا بتوقيتك المحلي',   '🦉', 20),
  ('early_bird',       'الطائر المبكر', 'أجب عن سؤال بين الساعة 4 و7 صباحًا بتوقيتك المحلي',            '🐦', 21),
  ('weekend_warrior',  'محارب العطلة',  'أجب عن سؤال في يوم الجمعة أو السبت',                          '🎯', 22)
on conflict (code) do nothing;

-- 5d) Per-question-type mastery — 30 correct answers of one question
-- type earns its own badge. Generated with a loop (mirroring app.js's
-- getTypeLabel()) instead of 13 hand-typed rows, so it can't drift.
do $$
declare
  v_types text[] := array['first','last','previous','surah','pageNumber','ayahCount',
                           'nextPageFirst','prevPageFirst','pageEndToNextFirst',
                           'pageStartToPrevLast','juz','ayahNumber','listenNext'];
  v_labels text[] := array['خمن الآية الأولى بالصفحة','خمن الآية الأخيرة بالصفحة','خمن الآية السابقة',
                            'خمن السورة','خمن رقم الصفحة','خمن عدد آيات الصفحة',
                            'خمن أول آية بالصفحة التالية','خمن أول آية بالصفحة السابقة',
                            'من آخر آية: خمن أول آية بالصفحة التالية','من أول آية: خمن آخر آية بالصفحة السابقة',
                            'خمن الجزء','خمن رقم الآية بالسورة','استمع ثم خمن الآية التالية'];
  i int;
begin
  for i in 1 .. array_length(v_types, 1) loop
    insert into public.achievements (code, title, description, icon, sort_order)
    values (
      'type_master_' || v_types[i],
      'خبير: ' || v_labels[i],
      'أجب بشكل صحيح 30 مرة على أسئلة "' || v_labels[i] || '"',
      '🎯',
      30 + i
    )
    on conflict (code) do nothing;
  end loop;
end $$;

-- 5e) Per-juz completion — one badge per juz (30 total), earned once
-- every page in that juz has at least one correct answer across any
-- session. record_attempt() below checks this incrementally, scoped
-- to just the juz of the page just answered (never a full 30-juz scan).
do $$
declare
  j int;
begin
  for j in 1 .. 30 loop
    insert into public.achievements (code, title, description, icon, sort_order)
    values (
      'juz_complete_' || j,
      'أتممتَ الجزء ' || j,
      'أجب بشكل صحيح مرة واحدة على الأقل من كل صفحة في الجزء ' || j,
      '📖',
      60 + j
    )
    on conflict (code) do nothing;
  end loop;
end $$;

-- 5f) juz_for_page() / juz_page_range(): the same standard Madinah
-- Mushaf juz boundaries as JUZ_START_PAGE in app.js, in SQL form, so
-- record_attempt() can work out "which juz is this page in, and is
-- that juz now fully covered?" without hardcoding it inline.
create or replace function public.juz_for_page(p_page int)
returns int
language sql
immutable
as $$
  select count(*)::int
  from unnest(array[1,22,42,62,82,102,121,142,162,182,
                     201,222,242,262,282,302,322,342,362,382,
                     402,422,442,462,482,502,522,542,562,582]) as start_page
  where p_page >= start_page;
$$;

create or replace function public.juz_page_range(p_juz int)
returns table(range_min int, range_max int)
language sql
immutable
as $$
  with starts as (
    select juz_num, start_page
    from unnest(
      array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],
      array[1,22,42,62,82,102,121,142,162,182,201,222,242,262,282,302,
            322,342,362,382,402,422,442,462,482,502,522,542,562,582]
    ) as t(juz_num, start_page)
  )
  select s.start_page,
         coalesce((select st2.start_page - 1 from starts st2 where st2.juz_num = s.juz_num + 1), 604)
  from starts s
  where s.juz_num = p_juz;
$$;

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
--    supabase-client.js). Returns jsonb {earned, xp, xpGained,
--    currentStreak} — "earned" are badge codes newly earned by THIS
--    call, "xp" is updated lifetime XP, "xpGained" is how much XP
--    this specific call awarded (base 10 × a same-day-streak
--    multiplier, plus a flat combo bonus every 5th correct answer in
--    a row), and "currentStreak" is the live consecutive-correct
--    count — so the client can show a "+N XP" popup and a combo/fire
--    indicator without a second round trip. security definer so it
--    can write all these tables in one go, but every write is still
--    pinned to auth.uid() — a user can only ever record or widen
--    their own rows, and a p_session_id that isn't actually theirs is
--    silently ignored (see the ownership check below) rather than
--    trusted.
--
--    p_local_hour (0–23) and p_is_weekend are supplied by the client
--    from its own local clock (see app.js) — used only for the
--    night_owl/early_bird/weekend_warrior badges below, since the
--    server's clock_timestamp() is UTC and wouldn't reflect the
--    person's actual morning/evening/weekend.
--
--    Rate limited to one recorded attempt per 350ms per user (well
--    under any realistic "read the question, tap a choice" pace) —
--    calls faster than that are silently no-ops (current xp is still
--    returned so the client doesn't error), which quietly caps
--    scripted XP/leaderboard inflation without ever disrupting a
--    genuine fast answer.
--
--    Dropped and recreated (not just "or replace") because its
--    return type changed (void → text[] → jsonb across revisions),
--    and its signature just grew two new trailing params.
drop function if exists public.record_attempt(bigint, text, int, boolean, int, int);

create function public.record_attempt(
  p_session_id bigint,
  p_question_type text,
  p_page int,
  p_is_correct boolean,
  p_range_min int default null,
  p_range_max int default null,
  p_local_hour int default null,
  p_is_weekend boolean default null
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
  v_old_streak int;
  v_new_streak int;
  v_total_correct int;
  v_best_streak int;
  v_current_streak int;
  v_type_counts_json jsonb;
  v_type_count int;
  v_session_total int;
  v_session_correct int;
  v_distinct_pages int;
  v_day_streak int;
  v_xp_mult numeric;
  v_combo_bonus int;
  v_base_xp int;
  v_xp_gain int;
  v_juz int;
  v_juz_min int;
  v_juz_max int;
  v_code text;
  v_earned text[] := '{}';
  v_owns_session boolean;
begin
  -- security definer bypasses RLS entirely, so this ownership check is
  -- the ONLY thing stopping a caller from passing another user's
  -- (guessable, sequential) session id and attaching their attempt to
  -- it — which would pollute that session's total_answers/accuracy in
  -- session_summary/session_leaderboard. A non-owned id is treated as
  -- "no session" rather than trusted.
  if p_session_id is not null then
    select exists(
      select 1 from public.sessions where id = p_session_id and user_id = v_uid
    ) into v_owns_session;
    if not v_owns_session then
      p_session_id := null;
    end if;
  end if;

  select xp, last_attempt_at, current_streak into v_xp, v_last_attempt_at, v_old_streak
  from public.user_stats where user_id = v_uid;

  if v_last_attempt_at is not null and clock_timestamp() - v_last_attempt_at < interval '350 milliseconds' then
    return jsonb_build_object(
      'earned', '[]'::jsonb, 'xp', coalesce(v_xp, 0),
      'xpGained', 0, 'currentStreak', coalesce(v_old_streak, 0)
    );
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

  -- Current consecutive-day streak (including today, since the
  -- insert above already recorded today's activity): classic
  -- "gaps and islands" trick — d minus its row_number() is constant
  -- across a run of consecutive dates, so the island containing
  -- today's date has that many rows. Computed here (not just further
  -- down for the streak_days_* badges) so it can also drive this
  -- call's XP multiplier below.
  with days as (
    select distinct (created_at at time zone 'utc')::date as d
    from public.attempts where user_id = v_uid
  ),
  grouped as (
    select d, d - (row_number() over (order by d))::int as grp
    from days
  )
  select count(*) into v_day_streak
  from grouped
  where grp = (select grp from grouped where d = (clock_timestamp() at time zone 'utc')::date);

  -- XP: a flat 10 per correct answer, boosted by a same-day-streak
  -- multiplier (rewards showing up daily — 3+ days = 1.25x, 7+ = 1.5x),
  -- plus a flat "combo" bonus every 5th consecutive correct answer
  -- in a row (current_streak resets to 0 on any wrong answer, so this
  -- rewards a good run happening right now, on top of the daily one).
  v_new_streak := case when p_is_correct then coalesce(v_old_streak, 0) + 1 else 0 end;
  v_xp_mult := case
    when coalesce(v_day_streak, 0) >= 7 then 1.5
    when coalesce(v_day_streak, 0) >= 3 then 1.25
    else 1
  end;
  v_base_xp := case when p_is_correct then round(10 * v_xp_mult)::int else 0 end;
  v_combo_bonus := case when p_is_correct and v_new_streak > 0 and v_new_streak % 5 = 0 then 15 else 0 end;
  v_xp_gain := v_base_xp + v_combo_bonus;

  insert into public.user_stats (
    user_id, xp, total_correct, total_answers, current_streak, best_streak,
    last_attempt_at, type_correct_counts
  )
  values (
    v_uid,
    v_xp_gain,
    case when p_is_correct then 1 else 0 end,
    1,
    case when p_is_correct then 1 else 0 end,
    case when p_is_correct then 1 else 0 end,
    clock_timestamp(),
    case when p_is_correct then jsonb_build_object(p_question_type, 1) else '{}'::jsonb end
  )
  on conflict (user_id) do update set
    xp = public.user_stats.xp + v_xp_gain,
    total_correct = public.user_stats.total_correct + (case when p_is_correct then 1 else 0 end),
    total_answers = public.user_stats.total_answers + 1,
    current_streak = case when p_is_correct then public.user_stats.current_streak + 1 else 0 end,
    best_streak = greatest(
      public.user_stats.best_streak,
      case when p_is_correct then public.user_stats.current_streak + 1 else 0 end
    ),
    last_attempt_at = clock_timestamp(),
    type_correct_counts = case when p_is_correct then
        jsonb_set(
          public.user_stats.type_correct_counts,
          array[p_question_type],
          to_jsonb(coalesce((public.user_stats.type_correct_counts ->> p_question_type)::int, 0) + 1)
        )
      else public.user_stats.type_correct_counts
      end,
    updated_at = now();

  select xp, total_correct, best_streak, current_streak, type_correct_counts
    into v_xp, v_total_correct, v_best_streak, v_current_streak, v_type_counts_json
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

  -- per-question-type mastery (30 correct of this same type) — only
  -- the type just answered needs checking, not all 13.
  if p_is_correct then
    v_type_count := coalesce((v_type_counts_json ->> p_question_type)::int, 0);
    if v_type_count >= 30 then
      v_code := null;
      insert into public.user_achievements (user_id, code) values (v_uid, 'type_master_' || p_question_type)
        on conflict do nothing returning code into v_code;
      if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
    end if;
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

  -- per-juz completion — only the juz of the page just answered needs
  -- checking (a correct answer elsewhere can't complete THIS juz).
  if p_is_correct and p_page is not null then
    v_juz := public.juz_for_page(p_page);
    select range_min, range_max into v_juz_min, v_juz_max from public.juz_page_range(v_juz);

    if v_juz_min is not null and not exists (
      select 1 from generate_series(v_juz_min, v_juz_max) as pg
      where not exists (
        select 1 from public.attempts a2
        where a2.user_id = v_uid and a2.page = pg and a2.is_correct
      )
    ) then
      v_code := null;
      insert into public.user_achievements (user_id, code) values (v_uid, 'juz_complete_' || v_juz)
        on conflict do nothing returning code into v_code;
      if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
    end if;
  end if;

  if coalesce(v_day_streak, 0) >= 3 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'streak_days_3')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if coalesce(v_day_streak, 0) >= 7 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'streak_days_7')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if coalesce(v_day_streak, 0) >= 30 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'streak_days_30')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  -- time-based badges, using the caller's local hour/weekday (see the
  -- function comment above) rather than the server's UTC clock.
  if p_local_hour is not null and p_local_hour >= 0 and p_local_hour < 5 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'night_owl')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if p_local_hour is not null and p_local_hour >= 4 and p_local_hour < 7 then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'early_bird')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  if coalesce(p_is_weekend, false) then
    v_code := null;
    insert into public.user_achievements (user_id, code) values (v_uid, 'weekend_warrior')
      on conflict do nothing returning code into v_code;
    if v_code is not null then v_earned := array_append(v_earned, v_code); end if;
  end if;

  return jsonb_build_object(
    'earned', to_jsonb(v_earned), 'xp', v_xp,
    'xpGained', v_xp_gain, 'currentStreak', v_current_streak
  );
end;
$$;

grant execute on function public.record_attempt(bigint, text, int, boolean, int, int, int, boolean) to authenticated;

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
  insert into public.profiles (id, display_name, friend_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', 'مستخدم'),
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  );

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

-- 14) Lifetime page-coverage and daily-activity views, for the
--     "📈 تقدمي" heatmap/streak feature — across every session (even
--     deleted ones), same "lifetime, account-wide" spirit as levels.
--     Both are self-scoped (where user_id = auth.uid()) the same way
--     session_summary is, since the views run with owner privileges
--     and bypass RLS on the underlying attempts table.
create or replace view public.user_page_stats as
select
  user_id,
  page,
  count(*) as total_answers,
  count(*) filter (where is_correct) as total_correct
from public.attempts
where user_id = auth.uid() and page is not null
group by user_id, page;

create or replace view public.user_daily_activity as
select
  user_id,
  (created_at at time zone 'utc')::date as activity_date,
  count(*) as total_answers
from public.attempts
where user_id = auth.uid()
group by user_id, (created_at at time zone 'utc')::date;

-- 15) Friend system — replaces the earlier link-token progress
--     sharing entirely. A user shares their friend_code (see
--     profiles above) out of band; once two users accept each
--     other, either can view the other's full profile (heatmap,
--     streak, achievements, and session list) via get_friend_profile()
--     below. Clean up the old sharing objects first, in case this is
--     being re-run over an installation that had them.
drop function if exists public.get_shared_progress(uuid);
drop function if exists public.regenerate_share_token();
drop function if exists public.set_share_enabled(boolean);
drop table if exists public.progress_shares;

create table if not exists public.friend_requests (
  id bigint generated always as identity primary key,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (from_user_id <> to_user_id),
  constraint friend_requests_unique_pair unique (from_user_id, to_user_id)
);

alter table public.friend_requests enable row level security;

-- Read-only for the two people involved — every write (send, accept/
-- decline, remove) goes through a security-definer RPC below instead,
-- so there's no insert/update/delete policy at all.
drop policy if exists "Users view requests involving them" on public.friend_requests;
create policy "Users view requests involving them"
  on public.friend_requests for select
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

-- Looks up the target by friend_code and creates a pending request —
-- or, if the target already sent *us* a pending request, accepts it
-- immediately instead (mutual add = instant friend). Retrying after a
-- decline re-opens that same request rather than erroring forever.
create or replace function public.send_friend_request(p_friend_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_reverse_pending bigint;
  v_existing record;
begin
  select id into v_target from public.profiles where friend_code = upper(trim(p_friend_code));

  if v_target is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_target = v_uid then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;

  select id into v_reverse_pending from public.friend_requests
    where from_user_id = v_target and to_user_id = v_uid and status = 'pending';
  if v_reverse_pending is not null then
    update public.friend_requests set status = 'accepted', responded_at = now() where id = v_reverse_pending;
    return jsonb_build_object('ok', true, 'status', 'accepted');
  end if;

  select * into v_existing from public.friend_requests
    where from_user_id = v_uid and to_user_id = v_target;

  if found then
    if v_existing.status = 'declined' then
      update public.friend_requests set status = 'pending', created_at = now(), responded_at = null
        where id = v_existing.id;
      return jsonb_build_object('ok', true, 'status', 'pending');
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_' || v_existing.status);
  end if;

  if exists (
    select 1 from public.friend_requests
    where from_user_id = v_target and to_user_id = v_uid and status = 'accepted'
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_accepted');
  end if;

  insert into public.friend_requests (from_user_id, to_user_id) values (v_uid, v_target);
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

grant execute on function public.send_friend_request(text) to authenticated;

create or replace function public.respond_friend_request(p_request_id bigint, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friend_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = p_request_id and to_user_id = auth.uid() and status = 'pending';

  return found;
end;
$$;

grant execute on function public.respond_friend_request(bigint, boolean) to authenticated;

create or replace function public.remove_friend(p_other_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friend_requests
  where status = 'accepted'
    and ((from_user_id = auth.uid() and to_user_id = p_other_user_id)
      or (from_user_id = p_other_user_id and to_user_id = auth.uid()));
  return found;
end;
$$;

grant execute on function public.remove_friend(uuid) to authenticated;

-- Self-scoped views (same "runs with owner privileges, so the
-- auth.uid() filter has to be explicit" pattern as session_summary).
create or replace view public.my_incoming_friend_requests as
select fr.id, fr.from_user_id, p.display_name as from_display_name, fr.created_at
from public.friend_requests fr
join public.profiles p on p.id = fr.from_user_id
where fr.to_user_id = auth.uid() and fr.status = 'pending';

create or replace view public.my_outgoing_friend_requests as
select fr.id, fr.to_user_id, p.display_name as to_display_name, fr.created_at
from public.friend_requests fr
join public.profiles p on p.id = fr.to_user_id
where fr.from_user_id = auth.uid() and fr.status = 'pending';

create or replace view public.my_friends as
select
  case when fr.from_user_id = auth.uid() then fr.to_user_id else fr.from_user_id end as friend_user_id,
  p.display_name as friend_display_name,
  fr.responded_at as friends_since
from public.friend_requests fr
join public.profiles p
  on p.id = (case when fr.from_user_id = auth.uid() then fr.to_user_id else fr.from_user_id end)
where fr.status = 'accepted' and (fr.from_user_id = auth.uid() or fr.to_user_id = auth.uid());

-- The full profile bundle — heatmap data, daily activity, earned
-- achievement codes, and the friend's session list (title, range,
-- totals; NOT limited to publicly-leaderboarded sessions, since an
-- accepted friend is a trusted viewer, unlike the old anonymous link).
-- Returns null if the caller and p_user_id aren't actually friends —
-- checked explicitly since this is security definer and bypasses RLS.
create or replace function public.get_friend_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_friend boolean;
  v_display_name text;
  v_xp int;
  v_page_stats jsonb;
  v_daily jsonb;
  v_sessions jsonb;
  v_earned jsonb;
begin
  if v_uid is null or p_user_id is null then
    return null;
  end if;

  select exists(
    select 1 from public.friend_requests
    where status = 'accepted'
      and ((from_user_id = v_uid and to_user_id = p_user_id)
        or (from_user_id = p_user_id and to_user_id = v_uid))
  ) into v_is_friend;

  if not v_is_friend then
    return null;
  end if;

  select display_name into v_display_name from public.profiles where id = p_user_id;
  select xp into v_xp from public.user_stats where user_id = p_user_id;

  select coalesce(jsonb_agg(jsonb_build_object('page', page, 'total', total_answers, 'correct', total_correct)), '[]'::jsonb)
    into v_page_stats
  from (
    select page, count(*) as total_answers, count(*) filter (where is_correct) as total_correct
    from public.attempts
    where user_id = p_user_id and page is not null
    group by page
  ) p;

  select coalesce(jsonb_agg(jsonb_build_object('date', activity_date, 'total', total_answers) order by activity_date), '[]'::jsonb)
    into v_daily
  from (
    select (created_at at time zone 'utc')::date as activity_date, count(*) as total_answers
    from public.attempts
    where user_id = p_user_id
    group by (created_at at time zone 'utc')::date
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
      'title', s.title, 'range_min', s.range_min, 'range_max', s.range_max,
      'is_public', s.is_public, 'created_at', s.created_at,
      'total_answers', coalesce(a.total_answers, 0), 'total_correct', coalesce(a.total_correct, 0)
    ) order by s.created_at desc), '[]'::jsonb)
    into v_sessions
  from public.sessions s
  left join (
    select session_id, count(*) as total_answers, count(*) filter (where is_correct) as total_correct
    from public.attempts
    where session_id is not null
    group by session_id
  ) a on a.session_id = s.id
  where s.user_id = p_user_id;

  select coalesce(jsonb_agg(ua.code), '[]'::jsonb) into v_earned
  from public.user_achievements ua where ua.user_id = p_user_id;

  return jsonb_build_object(
    'display_name', coalesce(v_display_name, 'مستخدم'),
    'xp', coalesce(v_xp, 0),
    'page_stats', v_page_stats,
    'daily_activity', v_daily,
    'sessions', v_sessions,
    'earned_achievements', v_earned
  );
end;
$$;

grant execute on function public.get_friend_profile(uuid) to authenticated;

-- ============================================================
-- Done. Next steps:
-- 1. Project Settings → API → copy "Project URL" and "anon public" key
-- 2. Paste them into config.js in the app (SUPABASE_URL must be just
--    the bare project URL, nothing appended after .supabase.co)
-- 3. Authentication → Providers → make sure Email is enabled
--    (Authentication → URL Configuration → add your site URL,
--    e.g. https://yourname.github.io/quran-flashcards, to Redirect URLs)
-- ============================================================
