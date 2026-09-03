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
      .select("id, title, range_min, range_max")
      .eq("id", settings.active_session_id)
      .maybeSingle();
    if (data) return { id: data.id, title: data.title, rangeMin: data.range_min, rangeMax: data.range_max };
  }

  const newId = await createSession("الجلسة الأولى", 1, 604);
  return { id: newId, title: "الجلسة الأولى", rangeMin: 1, rangeMax: 604 };
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
// lifetime XP/streak (with a daily-streak XP multiplier + in-session
// combo bonus baked in), and awarding any newly-earned badges
// (including per-type mastery, per-juz completion, and time-of-day
// badges) all happen in one atomic round trip. Returns
// { ok, newlyEarned, xp, xpGained, currentStreak } — ok is true only
// on confirmed success, newlyEarned is the array of achievement codes
// granted by THIS call (usually empty), xp is the user's updated
// lifetime XP, xpGained is how much XP THIS call awarded (for the
// "+N XP" popup), and currentStreak is the live consecutive-correct
// count (for the combo/fire indicator) — all without a second round
// trip. p_local_hour/p_is_weekend are read from the browser's own
// clock (see app.js), not the server's UTC one, so the night_owl/
// early_bird/weekend_warrior badges reflect the person's actual time.
async function recordAttempt({ questionType, page, isCorrect, sessionId, rangeMin, rangeMax, localHour, isWeekend }) {
  if (!sb || !currentUser) return { ok: false, newlyEarned: [], xp: null, xpGained: 0, currentStreak: 0 };
  const { data, error } = await sb.rpc("record_attempt", {
    p_session_id: sessionId || null,
    p_question_type: questionType,
    p_page: page,
    p_is_correct: isCorrect,
    p_range_min: rangeMin ?? null,
    p_range_max: rangeMax ?? null,
    p_local_hour: localHour ?? null,
    p_is_weekend: isWeekend ?? null,
  });
  if (error) {
    console.error("recordAttempt error", error);
    return { ok: false, newlyEarned: [], xp: null, xpGained: 0, currentStreak: 0 };
  }
  return {
    ok: true,
    newlyEarned: Array.isArray(data?.earned) ? data.earned : [],
    xp: typeof data?.xp === "number" ? data.xp : null,
    xpGained: typeof data?.xpGained === "number" ? data.xpGained : 0,
    currentStreak: typeof data?.currentStreak === "number" ? data.currentStreak : 0,
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

// Any signed-in user's display name (profiles is public-read) — used
// to resolve an online-duel opponent's name from just their user id,
// e.g. right after a quick match where the client only has an id.
async function fetchDisplayName(userId) {
  if (!sb || !userId) return null;
  const { data, error } = await sb.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  if (error) {
    console.error("fetchDisplayName error", error);
    return null;
  }
  return data?.display_name || null;
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

// -------- progress (page coverage, daily activity) --------
async function fetchMyPageStats() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb.from("user_page_stats").select("*");
  if (error) {
    console.error("fetchMyPageStats error", error);
    return [];
  }
  return (data || []).map((r) => ({ page: r.page, total: r.total_answers, correct: r.total_correct }));
}

async function fetchMyDailyActivity() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb.from("user_daily_activity").select("*");
  if (error) {
    console.error("fetchMyDailyActivity error", error);
    return [];
  }
  return (data || []).map((r) => ({ date: r.activity_date, total: r.total_answers }));
}

// -------- friends --------
async function fetchMyFriendCode() {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb.from("profiles").select("friend_code").eq("id", currentUser.id).maybeSingle();
  if (error) {
    console.error("fetchMyFriendCode error", error);
    return null;
  }
  return data?.friend_code || null;
}

async function sendFriendRequest(friendCode) {
  if (!sb || !currentUser) return { ok: false, error: "not_signed_in" };
  const { data, error } = await sb.rpc("send_friend_request", { p_friend_code: friendCode });
  if (error) {
    console.error("sendFriendRequest error", error);
    return { ok: false, error: "request_failed" };
  }
  return data || { ok: false, error: "request_failed" };
}

// Same as sendFriendRequest, but for adding someone straight from the
// online duel lobby/play screen, where their user id is already known
// directly and asking them to share a friend_code would be redundant.
async function sendFriendRequestByUserId(userId) {
  if (!sb || !currentUser) return { ok: false, error: "not_signed_in" };
  const { data, error } = await sb.rpc("send_friend_request_by_user_id", { p_target_user_id: userId });
  if (error) {
    console.error("sendFriendRequestByUserId error", error);
    return { ok: false, error: "request_failed" };
  }
  return data || { ok: false, error: "request_failed" };
}

async function respondFriendRequest(requestId, accept) {
  if (!sb || !currentUser) return false;
  const { data, error } = await sb.rpc("respond_friend_request", { p_request_id: requestId, p_accept: accept });
  if (error) {
    console.error("respondFriendRequest error", error);
    return false;
  }
  return !!data;
}

async function removeFriend(otherUserId) {
  if (!sb || !currentUser) return false;
  const { data, error } = await sb.rpc("remove_friend", { p_other_user_id: otherUserId });
  if (error) {
    console.error("removeFriend error", error);
    return false;
  }
  return !!data;
}

async function fetchIncomingFriendRequests() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb.from("my_incoming_friend_requests").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("fetchIncomingFriendRequests error", error);
    return [];
  }
  return data || [];
}

async function fetchOutgoingFriendRequests() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb.from("my_outgoing_friend_requests").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("fetchOutgoingFriendRequests error", error);
    return [];
  }
  return data || [];
}

async function fetchMyFriends() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb.from("my_friends").select("*").order("friend_display_name", { ascending: true });
  if (error) {
    console.error("fetchMyFriends error", error);
    return [];
  }
  return data || [];
}

// Full profile bundle for an accepted friend — null if not actually
// friends (see get_friend_profile() in supabase-schema.sql).
async function fetchFriendProfile(friendUserId) {
  if (!sb || !currentUser || !friendUserId) return null;
  const { data, error } = await sb.rpc("get_friend_profile", { p_user_id: friendUserId });
  if (error) {
    console.error("fetchFriendProfile error", error);
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

// ============================================================
// Online duels (⚔️ تحديات → مباشر) — 1v1 live challenges, either
// against a friend or a random matched opponent. See supabase-schema
// .sql sections 16–29 for the tables/RPCs this wraps, and
// supabase/functions/generate-duel-questions for how the shared
// question set gets created without either player's browser seeing
// the answers first.
// ============================================================

// -------- create / respond / cancel --------
async function createFriendDuel(opponentId, rangeMin, rangeMax, timerSeconds, questionTypes, countPerType) {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb.rpc("create_friend_duel", {
    p_opponent_id: opponentId,
    p_range_min: rangeMin,
    p_range_max: rangeMax,
    p_timer_seconds: timerSeconds,
    p_question_types: questionTypes,
    p_count_per_type: countPerType,
  });
  if (error) {
    console.error("createFriendDuel error", error);
    return null;
  }
  return data; // new duel id
}

// Same as createFriendDuel but for challenging someone off the
// "online now" presence list who isn't necessarily an added friend —
// see create_direct_duel() in supabase-schema.sql.
async function createDirectDuel(opponentId, rangeMin, rangeMax, timerSeconds, questionTypes, countPerType) {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb.rpc("create_direct_duel", {
    p_opponent_id: opponentId,
    p_range_min: rangeMin,
    p_range_max: rangeMax,
    p_timer_seconds: timerSeconds,
    p_question_types: questionTypes,
    p_count_per_type: countPerType,
  });
  if (error) {
    console.error("createDirectDuel error", error);
    return null;
  }
  return data;
}

async function respondDuelInvite(duelId, accept) {
  if (!sb || !currentUser) return { ok: false };
  const { data, error } = await sb.rpc("respond_duel_invite", { p_duel_id: duelId, p_accept: accept });
  if (error) {
    console.error("respondDuelInvite error", error);
    return { ok: false };
  }
  return data || { ok: false };
}

async function cancelDuel(duelId) {
  if (!sb || !currentUser) return false;
  const { data, error } = await sb.rpc("cancel_duel", { p_duel_id: duelId });
  if (error) {
    console.error("cancelDuel error", error);
    return false;
  }
  return !!data;
}

// -------- quick match queue --------
async function joinQuickMatchQueue(rangeMin, rangeMax, timerSeconds, questionTypes, countPerType) {
  if (!sb || !currentUser) return { matched: false };
  const { data, error } = await sb.rpc("join_quick_match_queue", {
    p_range_min: rangeMin,
    p_range_max: rangeMax,
    p_timer_seconds: timerSeconds,
    p_question_types: questionTypes,
    p_count_per_type: countPerType,
  });
  if (error) {
    console.error("joinQuickMatchQueue error", error);
    return { matched: false };
  }
  return data || { matched: false };
}

async function leaveQuickMatchQueue() {
  if (!sb || !currentUser) return;
  const { error } = await sb.rpc("leave_quick_match_queue");
  if (error) console.error("leaveQuickMatchQueue error", error);
}

// -------- generating the shared question set (host only) --------
// Calls the Edge Function rather than writing duel_questions directly
// — see the function's own header comment for why this specifically
// can't be a client-side insert.
async function generateDuelQuestions(duelId) {
  if (!sb || !currentUser) return { ok: false };
  try {
    const { data, error } = await sb.functions.invoke("generate-duel-questions", {
      body: { duelId },
    });
    if (error) {
      console.error("generateDuelQuestions error", error);
      return { ok: false, error: "function_error" };
    }
    return data || { ok: false };
  } catch (e) {
    console.error("generateDuelQuestions exception", e);
    return { ok: false, error: "network" };
  }
}

// -------- reading duel state --------
async function fetchDuelState(duelId) {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb.from("duels").select("*").eq("id", duelId).maybeSingle();
  if (error) {
    console.error("fetchDuelState error", error);
    return null;
  }
  return data;
}

async function fetchDuelQuestion(duelId, questionIndex) {
  if (!sb || !currentUser) return null;
  const { data, error } = await sb
    .from("duel_questions_public")
    .select("*")
    .eq("duel_id", duelId)
    .eq("question_index", questionIndex)
    .maybeSingle();
  if (error) {
    console.error("fetchDuelQuestion error", error);
    return null;
  }
  return data;
}

// Pull-based fallbacks (checked when the ⚔️ تحديات tab opens) so an
// invite or an in-progress duel is never missed just because the
// realtime channel wasn't connected at the moment it happened.
async function fetchMyIncomingDuelInvites() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb
    .from("my_incoming_duel_invites")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchMyIncomingDuelInvites error", error);
    return [];
  }
  return data || [];
}

async function fetchMyActiveDuels() {
  if (!sb || !currentUser) return [];
  const { data, error } = await sb
    .from("my_active_duels")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchMyActiveDuels error", error);
    return [];
  }
  return data || [];
}

async function fetchDuelStats(userId) {
  if (!sb) return null;
  const { data, error } = await sb.from("duel_stats").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("fetchDuelStats error", error);
    return null;
  }
  return data;
}

// -------- playing --------
async function submitDuelAnswer(duelId, questionIndex, choiceIndex) {
  if (!sb || !currentUser) return { ok: false };
  const { data, error } = await sb.rpc("submit_duel_answer", {
    p_duel_id: duelId,
    p_question_index: questionIndex,
    p_choice_index: choiceIndex,
  });
  if (error) {
    console.error("submitDuelAnswer error", error);
    return { ok: false };
  }
  return data || { ok: false };
}

async function advanceDuelQuestion(duelId, questionIndex) {
  if (!sb || !currentUser) return { ok: false };
  const { data, error } = await sb.rpc("advance_duel_question", {
    p_duel_id: duelId,
    p_question_index: questionIndex,
  });
  if (error) {
    console.error("advanceDuelQuestion error", error);
    return { ok: false };
  }
  return data || { ok: false };
}

async function forfeitDuel(duelId) {
  if (!sb || !currentUser) return { ok: false };
  const { data, error } = await sb.rpc("forfeit_duel", { p_duel_id: duelId });
  if (error) {
    console.error("forfeitDuel error", error);
    return { ok: false };
  }
  return data || { ok: false };
}

async function claimOpponentForfeit(duelId) {
  if (!sb || !currentUser) return { ok: false };
  const { data, error } = await sb.rpc("claim_opponent_forfeit", { p_duel_id: duelId });
  if (error) {
    console.error("claimOpponentForfeit error", error);
    return { ok: false };
  }
  return data || { ok: false };
}

// -------- realtime: incoming invites (global) --------
// One long-lived subscription for the whole session (started once
// after sign-in — see auth-ui.js) so a challenge shows up as a live
// banner no matter which tab the person is currently looking at.
// Fires on both a genuine friend invite (status 'pending') and a
// quick-match pairing (status already 'accepted', no response needed
// — see join_quick_match_queue()'s comment on why the waiting side
// always ends up as opponent_id).
let duelInviteChannel = null;

function subscribeToIncomingDuelInvites(onInvite) {
  if (!sb || !currentUser) return;
  unsubscribeFromIncomingDuelInvites();
  duelInviteChannel = sb
    .channel(`duel-invites-${currentUser.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "duels", filter: `opponent_id=eq.${currentUser.id}` },
      (payload) => onInvite(payload.new)
    )
    .subscribe();
}

function unsubscribeFromIncomingDuelInvites() {
  if (duelInviteChannel) {
    sb.removeChannel(duelInviteChannel);
    duelInviteChannel = null;
  }
}

// -------- realtime: a specific duel's live state (while playing) --------
// Watches the duels row itself (score, current_question_index,
// status) — both players stay in lockstep by reacting to whichever of
// them last called submit_duel_answer()/advance_duel_question(),
// rather than polling.
function subscribeToDuelState(duelId, onChange) {
  if (!sb) return null;
  const channel = sb
    .channel(`duel-state-${duelId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "duels", filter: `id=eq.${duelId}` },
      (payload) => onChange(payload.new)
    )
    .subscribe();
  return channel;
}

function unsubscribeFromDuelState(channel) {
  if (channel) sb.removeChannel(channel);
}

// -------- presence: "who's online right now" lobby --------
// Pure Realtime Presence — nothing written to the database. Anyone
// with the ⚔️ تحديات → مباشر hub open tracks themselves on this shared
// channel; everyone else on it sees the live list to challenge
// directly. Leaving the hub (or closing the tab) untracks
// automatically.
let onlineLobbyChannel = null;

function joinOnlineLobby(displayName, onUpdate) {
  if (!sb || !currentUser) return;
  leaveOnlineLobby();

  onlineLobbyChannel = sb.channel("duel-online-lobby", {
    config: { presence: { key: currentUser.id } },
  });

  onlineLobbyChannel.on("presence", { event: "sync" }, () => {
    const state = onlineLobbyChannel.presenceState();
    const people = Object.entries(state)
      .map(([userId, entries]) => ({ userId, ...(entries[0] || {}) }))
      .filter((p) => p.userId !== currentUser.id);
    onUpdate(people);
  });

  onlineLobbyChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await onlineLobbyChannel.track({ display_name: displayName || "لاعب" });
    }
  });
}

function leaveOnlineLobby() {
  if (onlineLobbyChannel) {
    sb.removeChannel(onlineLobbyChannel);
    onlineLobbyChannel = null;
  }
}