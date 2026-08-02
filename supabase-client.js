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

// -------- attempts sync --------
async function recordAttempt({ questionType, page, isCorrect }) {
  if (!sb || !currentUser) return;
  const { error } = await sb.from("attempts").insert({
    user_id: currentUser.id,
    question_type: questionType,
    page,
    is_correct: isCorrect,
  });
  if (error) console.error("recordAttempt error", error);
}

async function fetchStats() {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb
    .from("attempts")
    .select("question_type, is_correct, created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("fetchStats error", error);
    return null;
  }
  return data;
}

// -------- profile / leaderboard --------
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

async function updateProfile(fields) {
  if (!sb || !currentUser) return;
  const { error } = await sb
    .from("profiles")
    .update(fields)
    .eq("id", currentUser.id);
  if (error) console.error("updateProfile error", error);
}

async function fetchLeaderboard() {
  if (!sb) return [];
  const { data, error } = await sb
    .from("leaderboard")
    .select("*")
    .order("total_correct", { ascending: false })
    .limit(20);
  if (error) {
    console.error("fetchLeaderboard error", error);
    return [];
  }
  return data;
}
