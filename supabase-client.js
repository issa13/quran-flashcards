// Thin wrapper around the Supabase client: auth + data helpers used
// by auth-ui.js and app.js. Falls back gracefully if config.js hasn't
// been filled in yet (app still works fully as a guest, local-only).

const isConfigured =
  typeof SUPABASE_URL === "string" &&
  typeof SUPABASE_ANON_KEY === "string" &&
  !SUPABASE_URL.includes("YOUR_SUPABASE") &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const sb = isConfigured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;
const authListeners = [];

function onAuthChange(fn) {
  authListeners.push(fn);
  fn(currentUser); // fire immediately with current state
}

function notifyAuthListeners() {
  authListeners.forEach((fn) => fn(currentUser));
}

async function initAuth() {
  if (!sb) return;

  const { data } = await sb.auth.getSession();
  currentUser = data?.session?.user || null;
  notifyAuthListeners();

  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    notifyAuthListeners();
  });
}

// signUp returns the raw { user, session } so the caller can tell
// whether email confirmation is required (session will be null).
async function signUp(email, password, displayName) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || "مستخدم" } },
  });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  if (!sb) return;
  await sb.auth.signOut();
}

// -------- settings sync --------
async function loadRemoteSettings() {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb
    .from("user_settings")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) {
    console.error("loadRemoteSettings error", error);
    return null;
  }
  return data;
}

async function saveRemoteSettings(settings) {
  if (!sb || !currentUser) return;
  const { error } = await sb.from("user_settings").upsert({
    user_id: currentUser.id,
    ...settings,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("saveRemoteSettings error", error);
}

// Partial upsert: only touches active_session_id, leaves the rest of
// the row (question type, timer, etc.) untouched.
async function setActiveSessionId(sessionId) {
  if (!sb || !currentUser) return;
  const { error } = await sb.from("user_settings").upsert(
    {
      user_id: currentUser.id,
      active_session_id: sessionId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) console.error("setActiveSessionId error", error);
}

// -------- sessions --------
// rangeMin/rangeMax are set once, here, at creation — the page range
// is now chosen when the session is created (see auth-ui.js's
// create-session modal) and is permanent afterward (enforced by the
// prevent_range_change trigger in supabase-schema.sql).
async function createSession(title, rangeMin, rangeMax) {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb
    .from("sessions")
    .insert({
      user_id: currentUser.id,
      title: title || "جلسة جديدة",
      range_min: rangeMin ?? null,
      range_max: rangeMax ?? null,
    })
    .select()
    .single();
  if (error) {
    console.error("createSession error", error);
    return null;
  }
  await setActiveSessionId(data.id);
  return data.id;
}

// Returns { id, rangeMin, rangeMax } for the session that should
// receive new attempts (rangeMin/rangeMax are set once, at creation —
// see createSession() — and are null only for an old session created
// before that was required). Verifies the previously-active session
// still exists (it may have been deleted); creates a fresh default
// one (full-Quran range) if needed.
async function ensureActiveSession() {
  if (!sb || !currentUser) return null;

  const settings = await loadRemoteSettings();
  if (settings?.active_session_id) {
    const { data } = await sb
      .from("sessions")
      .select("id, range_min, range_max")
      .eq("id", settings.active_session_id)
      .maybeSingle();
    if (data) return { id: data.id, rangeMin: data.range_min, rangeMax: data.range_max };
  }

  const newId = await createSession("الجلسة الأولى", 1, 604);
  return { id: newId, rangeMin: 1, rangeMax: 604 };
}

async function fetchMySessions() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb
    .from("session_summary")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchMySessions error", error);
    return [];
  }
  return data;
}

async function deleteSession(sessionId) {
  if (!sb || !currentUser) return;
  const { error } = await sb.from("sessions").delete().eq("id", sessionId);
  if (error) console.error("deleteSession error", error);
}

// Returns { ok: true, is_public } on a confirmed update, or { ok: false }
// if nothing was actually changed. Supabase's row-level security drops
// rows the caller isn't allowed to touch instead of raising an error,
// so a request with no `error` can still update zero rows — checking
// the returned row is the only way to know it really happened.
async function setSessionPublic(sessionId, isPublic) {
  if (!sb || !currentUser) return { ok: false };
  const { data, error } = await sb
    .from("sessions")
    .update({ is_public: isPublic })
    .eq("id", sessionId)
    .select("id, is_public");
  if (error) {
    console.error("setSessionPublic error", error);
    return { ok: false };
  }
  if (!data || data.length === 0) {
    console.error("setSessionPublic: update affected no rows (RLS blocked it?)");
    return { ok: false };
  }
  return { ok: true, is_public: data[0].is_public };
}

async function renameSession(sessionId, title) {
  if (!sb || !currentUser) return false;
  const { error } = await sb
    .from("sessions")
    .update({ title })
    .eq("id", sessionId);
  if (error) {
    console.error("renameSession error", error);
    return false;
  }
  return true;
}

// -------- attempts sync --------
// Uses the record_attempt() RPC (see supabase-schema.sql) so the
// attempt insert, widening the session's stored page range, updating
// lifetime XP/streak, and awarding any newly-earned badges all happen
// in one atomic round trip. Returns { ok, newlyEarned, xp } — ok is
// true only on confirmed success (app.js uses it to know when it's
// safe to lock in the session's page range), newlyEarned is the array
// of achievement codes granted by THIS call (usually empty), and xp
// is the user's updated lifetime XP (used to refresh the level badge
// live, without a second round trip).
async function recordAttempt({ questionType, page, isCorrect, sessionId, rangeMin, rangeMax }) {
  if (!sb || !currentUser) return { ok: false, newlyEarned: [], xp: null };
  const { data, error } = await sb.rpc("record_attempt", {
    p_session_id: sessionId || null,
    p_question_type: questionType,
    p_page: page,
    p_is_correct: isCorrect,
    p_range_min: rangeMin ?? null,
    p_range_max: rangeMax ?? null,
  });
  if (error) {
    console.error("recordAttempt error", error);
    return { ok: false, newlyEarned: [], xp: null };
  }
  return {
    ok: true,
    newlyEarned: Array.isArray(data?.earned) ? data.earned : [],
    xp: typeof data?.xp === "number" ? data.xp : null,
  };
}

// Per-type breakdown for a single session (used in the stats modal)
async function fetchSessionAttempts(sessionId) {
  if (!sb || !currentUser || !sessionId) return null;
  const { data, error } = await sb
    .from("attempts")
    .select("question_type, is_correct, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("fetchSessionAttempts error", error);
    return null;
  }
  return data;
}

// Distinct pages where this session has at least one wrong answer —
// used by app.js's mistake-review mode to restrict which pages new
// questions are drawn from.
async function fetchSessionWrongPages(sessionId) {
  if (!sb || !currentUser || !sessionId) return [];
  const { data, error } = await sb
    .from("attempts")
    .select("page")
    .eq("session_id", sessionId)
    .eq("is_correct", false)
    .not("page", "is", null)
    .limit(2000);
  if (error) {
    console.error("fetchSessionWrongPages error", error);
    return [];
  }
  return Array.from(new Set((data || []).map((r) => r.page).filter((p) => p != null)));
}

// -------- profile --------
async function fetchProfile() {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();
  if (error) {
    console.error("fetchProfile error", error);
    return null;
  }
  return data;
}

// -------- lifetime stats & achievements (levels) --------
async function fetchUserStats() {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb
    .from("user_stats")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) {
    console.error("fetchUserStats error", error);
    return null;
  }
  return data;
}

async function fetchAchievementsCatalog() {
  if (!sb) return [];
  const { data, error } = await sb
    .from("achievements")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("fetchAchievementsCatalog error", error);
    return [];
  }
  return data;
}

async function fetchMyAchievements() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb
    .from("user_achievements")
    .select("code, earned_at")
    .eq("user_id", currentUser.id);
  if (error) {
    console.error("fetchMyAchievements error", error);
    return [];
  }
  return data;
}

// -------- leaderboard (raw rows; caller ranks with Wilson score) --------
async function fetchSessionLeaderboard() {
  if (!sb) return [];
  const { data, error } = await sb
    .from("session_leaderboard")
    .select("*")
    .limit(200);
  if (error) {
    console.error("fetchSessionLeaderboard error", error);
    return [];
  }
  return data;
}