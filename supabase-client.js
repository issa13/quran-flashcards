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
async function createSession(title) {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb
    .from("sessions")
    .insert({ user_id: currentUser.id, title: title || "جلسة جديدة" })
    .select()
    .single();
  if (error) {
    console.error("createSession error", error);
    return null;
  }
  await setActiveSessionId(data.id);
  return data.id;
}

// Returns the id of the session that should receive new attempts.
// Verifies the previously-active session still exists (it may have
// been deleted); creates a fresh default one if needed.
async function ensureActiveSession() {
  if (!sb || !currentUser) return null;

  const settings = await loadRemoteSettings();
  if (settings?.active_session_id) {
    const { data } = await sb
      .from("sessions")
      .select("id")
      .eq("id", settings.active_session_id)
      .maybeSingle();
    if (data) return data.id;
  }

  return await createSession("الجلسة الأولى");
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
  if (!sb || !currentUser) return;
  const { error } = await sb
    .from("sessions")
    .update({ title })
    .eq("id", sessionId);
  if (error) console.error("renameSession error", error);
}

// -------- attempts sync --------
async function recordAttempt({ questionType, page, isCorrect, sessionId }) {
  if (!sb || !currentUser) return;
  const { error } = await sb.from("attempts").insert({
    user_id: currentUser.id,
    session_id: sessionId || null,
    question_type: questionType,
    page,
    is_correct: isCorrect,
  });
  if (error) console.error("recordAttempt error", error);
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