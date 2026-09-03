// UI wiring for the auth bar, auth modal, stats modal (sessions), and
// leaderboard modal. Depends on supabase-client.js being loaded first.

const guestActions = document.getElementById("guestActions");
const userActions = document.getElementById("userActions");
const userNameLabel = document.getElementById("userNameLabel");
const userLevelBadge = document.getElementById("userLevelBadge");

const authModal = document.getElementById("authModal");
const loginOpenBtn = document.getElementById("loginOpenBtn");
const authCloseBtn = document.getElementById("authCloseBtn");
const authGuestHint = document.getElementById("authGuestHint");

const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const signupNameField = document.getElementById("signupNameField");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");
const authPasswordToggle = document.getElementById("authPasswordToggle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authModalTitle = document.getElementById("authModalTitle");
const authFormFields = document.getElementById("authFormFields");
const authSuccessNotice = document.getElementById("authSuccessNotice");
const authSuccessText = document.getElementById("authSuccessText");
const authSuccessOkBtn = document.getElementById("authSuccessOkBtn");

const statsBody = document.getElementById("statsBody");
const sessionChips = document.getElementById("sessionChips");
const sessionActions = document.getElementById("sessionActions");
const sessionPublicToggle = document.getElementById("sessionPublicToggle");
const renameSessionBtn = document.getElementById("renameSessionBtn");
const deleteSessionBtn = document.getElementById("deleteSessionBtn");

const createSessionModal = document.getElementById("createSessionModal");
const openCreateSessionBtn = document.getElementById("openCreateSessionBtn");
const createSessionCloseBtn = document.getElementById("createSessionCloseBtn");
const newSessionNameInput = document.getElementById("newSessionName");
const newSessionRangeSelect = document.getElementById("newSessionRangeSelect");
const newSessionCustomRangeRow = document.getElementById("newSessionCustomRangeRow");
const newSessionCustomMin = document.getElementById("newSessionCustomMin");
const newSessionCustomMax = document.getElementById("newSessionCustomMax");
const createSessionSubmitBtn = document.getElementById("createSessionSubmitBtn");

const leaderboardBody = document.getElementById("leaderboardBody");
const achievementsBody = document.getElementById("achievementsBody");
const progressBody = document.getElementById("progressBody");

const logoutBtn = document.getElementById("logoutBtn");

// -------- dark mode --------
// The inline script in index.html's <head> already applies the
// initial theme (from localStorage or system preference) before
// first paint — this just wires the toggle button to flip it.
const themeToggleBtn = document.getElementById("themeToggleBtn");

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function setThemeButtonLabel() {
  themeToggleBtn.textContent = currentTheme() === "dark" ? "☀️ فاتح" : "🌙 داكن";
}

themeToggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  if (next === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  try { localStorage.setItem("qf_theme", next); } catch (e) { /* ignore */ }
  setThemeButtonLabel();
});

setThemeButtonLabel();

// -------- bottom nav (replaces the old side-menu drawer) --------
// Tapping a tab swaps which #view-* element is visible — no popups.
// Each tab (other than "home") lazily loads its data the moment it
// becomes visible, same as the old modals did on open.
const bottomNav = document.getElementById("bottomNav");
const bottomNavButtons = Array.from(bottomNav.querySelectorAll(".bottom-nav-btn"));
const appViews = {
  home: document.getElementById("view-home"),
  stats: document.getElementById("view-stats"),
  achievements: document.getElementById("view-achievements"),
  progress: document.getElementById("view-progress"),
  friends: document.getElementById("view-friends"),
  leaderboard: document.getElementById("view-leaderboard"),
  challenge: document.getElementById("view-challenge"),
};

function switchView(name) {
  if (!appViews[name]) return;

  Object.entries(appViews).forEach(([key, el]) => el.classList.toggle("active", key === name));
  bottomNavButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === name));

  if (name === "stats") refreshSessionsAndShow(null); // null = default to active session
  else if (name === "achievements") loadAchievementsView();
  else if (name === "progress") loadProgressView();
  else if (name === "friends") { showFriendsListSection(); loadFriendsModal(); }
  else if (name === "leaderboard") loadLeaderboardView();
}

bottomNavButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

let authMode = "login"; // or "signup"
let mySessions = [];          // cached list from session_summary
let selectedSessionId = null; // which session is shown in the stats view

function showModal(el) { el.style.display = "flex"; }
function hideModal(el) { el.style.display = "none"; }

// -------- auth modal --------
function resetAuthModalView() {
  authFormFields.style.display = "block";
  authSuccessNotice.style.display = "none";
  authError.style.display = "none";
  authPassword.type = "password";
  authPasswordToggle.textContent = "👁️";
  authPasswordToggle.setAttribute("aria-label", "إظهار كلمة المرور");
}

authPasswordToggle.addEventListener("click", () => {
  const showing = authPassword.type === "text";
  authPassword.type = showing ? "password" : "text";
  authPasswordToggle.textContent = showing ? "👁️" : "🙈";
  authPasswordToggle.setAttribute("aria-label", showing ? "إظهار كلمة المرور" : "إخفاء كلمة المرور");
});

function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  signupNameField.style.display = mode === "signup" ? "flex" : "none";
  authModalTitle.textContent = mode === "login" ? "تسجيل الدخول" : "حساب جديد";
  authSubmitBtn.textContent = mode === "login" ? "دخول" : "إنشاء الحساب";
  resetAuthModalView();
}

tabLogin.addEventListener("click", () => setAuthMode("login"));
tabSignup.addEventListener("click", () => setAuthMode("signup"));

loginOpenBtn.addEventListener("click", () => {
  resetAuthModalView();
  if (!isConfigured) {
    authError.textContent =
      "الحسابات غير مفعّلة بعد على هذا الموقع (يحتاج إعداد Supabase من صاحب الموقع). التطبيق يعمل كضيف بدون حساب.";
    authError.style.display = "block";
  }
  setAuthMode("login");
  showModal(authModal);
});

authCloseBtn.addEventListener("click", () => hideModal(authModal));
authModal.addEventListener("click", (e) => { if (e.target === authModal) hideModal(authModal); });

authSuccessOkBtn.addEventListener("click", () => {
  setAuthMode("login");
  authEmail.value = authEmail.value; // keep email prefilled for convenience
  authPassword.value = "";
});

authSubmitBtn.addEventListener("click", async () => {
  if (!isConfigured) return;

  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    authError.textContent = "الرجاء إدخال البريد الإلكتروني وكلمة المرور.";
    authError.style.display = "block";
    return;
  }

  authSubmitBtn.disabled = true;
  authError.style.display = "none";

  try {
    if (authMode === "signup") {
      const result = await signUp(email, password, authName.value.trim());

      if (result && result.session) {
        // Email confirmation is off — user is already signed in.
        hideModal(authModal);
        authEmail.value = "";
        authPassword.value = "";
        authName.value = "";
      } else {
        // Email confirmation required — tell them clearly what to do next.
        authFormFields.style.display = "none";
        authSuccessNotice.style.display = "block";
        authSuccessText.textContent =
          `تم إنشاء حسابك بنجاح! أرسلنا رابط تفعيل إلى ${email}. ` +
          `افتح بريدك الإلكتروني واضغط على الرابط لتفعيل الحساب، ثم عد إلى هنا وسجّل الدخول.`;
      }
    } else {
      await signIn(email, password);
      hideModal(authModal);
      authEmail.value = "";
      authPassword.value = "";
    }
  } catch (err) {
    authError.textContent = translateAuthError(err.message);
    authError.style.display = "block";
  } finally {
    authSubmitBtn.disabled = false;
  }
});

function translateAuthError(msg) {
  if (!msg) return "حدث خطأ. حاول مرة أخرى.";
  if (msg.includes("already registered")) return "هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول.";
  if (msg.includes("Email not confirmed")) return "لم يتم تفعيل البريد الإلكتروني بعد. تحقق من صندوق الوارد لديك.";
  if (msg.includes("Invalid login")) return "بيانات الدخول غير صحيحة.";
  if (msg.includes("Password should be")) return "كلمة المرور يجب أن تكون 6 أحرف على الأقل.";
  return msg;
}

logoutBtn.addEventListener("click", async () => {
  await signOut();
});

// -------- react to auth state --------
let lastKnownLevel = null;

// Shared so app.js can call this after every answer (using the xp
// returned by record_attempt) to keep the badge live — without this,
// the badge only reflected xp as of the last login/page load.
function updateLevelBadge(xp) {
  if (!currentUser) return;
  const level = (typeof levelFromXp === "function") ? levelFromXp(xp || 0) : null;
  if (level == null) return;

  const title = (typeof levelTitle === "function") ? levelTitle(level) : "";
  userLevelBadge.textContent = title ? `🎖️ المستوى ${level} · ${title}` : `🎖️ المستوى ${level}`;
  userLevelBadge.style.display = "inline-flex";

  if (lastKnownLevel != null && level > lastKnownLevel) {
    showLevelUpCelebration(level, title);
  }
  lastKnownLevel = level;
}

// Full-screen (but brief, non-blocking, self-dismissing) flourish for
// leveling up — bigger moment than the small achievement toast, since
// a level-up is rarer and represents sustained progress, not a single
// milestone. Not a modal: no close button, nothing to interact with,
// it just plays and fades.
const levelUpOverlay = document.getElementById("levelUpOverlay");
const levelUpText = document.getElementById("levelUpText");
const levelUpTitleEl = document.getElementById("levelUpTitle");
let levelUpTimer = null;

function showLevelUpCelebration(level, title) {
  if (!levelUpOverlay) return;
  levelUpText.textContent = `🎖️ المستوى ${level}`;
  levelUpTitleEl.textContent = title || "";

  clearTimeout(levelUpTimer);
  levelUpOverlay.classList.remove("show"); // restart the animation if one is already mid-flight
  void levelUpOverlay.offsetWidth;
  levelUpOverlay.classList.add("show");

  levelUpTimer = setTimeout(() => levelUpOverlay.classList.remove("show"), 2200);
}

// -------- global incoming-duel-invite banner --------
// Not a modal — a slide-down banner the person can act on or ignore
// without losing their place, appearing wherever they are in the app
// (see subscribeToIncomingDuelInvites() in supabase-client.js, kicked
// off from onAuthChange below). Handles two shapes of "invite":
// a genuine friend challenge (status 'pending', needs accept/decline)
// and an already-paired quick match (status 'accepted' — see
// join_quick_match_queue()'s comment on why the waiting side always
// ends up as opponent_id — just needs a tap to join).
const duelInviteBanner = document.getElementById("duelInviteBanner");
const duelInviteBannerTitle = document.getElementById("duelInviteBannerTitle");
const duelInviteBannerDesc = document.getElementById("duelInviteBannerDesc");
const duelInviteBannerActions = document.getElementById("duelInviteBannerActions");

function hideDuelInviteBanner() {
  if (duelInviteBanner) duelInviteBanner.style.display = "none";
}

// Summarizes a duel's settings (range/timer/types/count) so the
// recipient of an invite — or someone about to join an already-
// matched quick match — knows exactly what they're accepting instead
// of finding out only after the first question appears.
function describeDuelConfig(cfg) {
  if (cfg.range_min == null || cfg.range_max == null) return "";
  const typeCount = (cfg.question_types || []).length;
  const totalQ = typeCount * (cfg.count_per_type || 0);
  return `📖 الصفحات ${cfg.range_min}–${cfg.range_max} · ⏱️ ${cfg.timer_seconds} ث · ${totalQ} سؤال (${typeCount} أنواع)`;
}

function renderDuelInviteBanner(invite) {
  if (!duelInviteBanner) return;
  duelInviteBannerActions.innerHTML = "";
  const configLine = describeDuelConfig(invite);

  if (invite.status === "pending") {
    duelInviteBannerTitle.textContent = `⚔️ ${invite.from_display_name || "لاعب"} يتحداك!`;
    duelInviteBannerDesc.textContent = configLine || "تحدٍّ مباشر — هل تقبل؟";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn small";
    acceptBtn.textContent = "قبول";
    acceptBtn.addEventListener("click", async () => {
      hideDuelInviteBanner();
      const result = await respondDuelInvite(invite.id, true);
      if (result?.ok && typeof onDuelInviteAccepted === "function") {
        await onDuelInviteAccepted(invite.id);
      }
    });

    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "btn small ghost";
    declineBtn.textContent = "رفض";
    declineBtn.addEventListener("click", async () => {
      hideDuelInviteBanner();
      await respondDuelInvite(invite.id, false);
    });

    duelInviteBannerActions.appendChild(acceptBtn);
    duelInviteBannerActions.appendChild(declineBtn);
  } else if (invite.status === "accepted") {
    duelInviteBannerTitle.textContent = "⚔️ تم إيجاد خصم!";
    duelInviteBannerDesc.textContent = configLine || "اضغط للانضمام إلى المبارزة.";

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "btn small";
    joinBtn.textContent = "انضمام";
    joinBtn.addEventListener("click", async () => {
      hideDuelInviteBanner();
      if (typeof onDuelInviteAccepted === "function") await onDuelInviteAccepted(invite.id);
    });
    duelInviteBannerActions.appendChild(joinBtn);
  } else {
    return; // nothing actionable to show for other statuses
  }

  duelInviteBanner.style.display = "flex";
}

// Normalizes a raw realtime INSERT payload into the same shape
// renderDuelInviteBanner() expects from the pull-based fallback view
// (my_incoming_duel_invites) — the raw row already carries every
// config column, just no joined display name.
async function handleIncomingDuelRow(row) {
  const fromName = (typeof fetchDisplayName === "function") ? await fetchDisplayName(row.created_by) : null;
  renderDuelInviteBanner({
    id: row.id,
    created_by: row.created_by,
    from_display_name: fromName || "لاعب",
    status: row.status,
    is_quick_match: row.is_quick_match,
    range_min: row.range_min,
    range_max: row.range_max,
    timer_seconds: row.timer_seconds,
    question_types: row.question_types,
    count_per_type: row.count_per_type,
  });
}

onAuthChange(async (user) => {
  if (user) {
    guestActions.style.display = "none";
    userActions.style.display = "flex";
    const profile = await fetchProfile();
    userNameLabel.textContent = profile?.display_name ? `مرحباً، ${profile.display_name}` : "مرحباً";

    const stats = await fetchUserStats();
    updateLevelBadge(stats?.xp || 0);

    if (typeof subscribeToIncomingDuelInvites === "function") {
      subscribeToIncomingDuelInvites((row) => handleIncomingDuelRow(row));
    }
  } else {
    guestActions.style.display = "flex";
    userActions.style.display = "none";
    userLevelBadge.style.display = "none";
    lastKnownLevel = null;
    mySessions = [];
    selectedSessionId = null;

    if (typeof unsubscribeFromIncomingDuelInvites === "function") unsubscribeFromIncomingDuelInvites();
    hideDuelInviteBanner();
  }
});

// -------- stats view (sessions) --------
// Opening is handled by switchView("stats") in the bottom-nav wiring
// above, which calls refreshSessionsAndShow(null) itself.

// -------- create session modal (name + fixed page range, together) --------
function showHideNewSessionCustomRange() {
  newSessionCustomRangeRow.style.display = (newSessionRangeSelect.value === "custom") ? "flex" : "none";
}
newSessionRangeSelect.addEventListener("change", showHideNewSessionCustomRange);

function refreshCreateSessionSubmitState() {
  createSessionSubmitBtn.disabled = !newSessionNameInput.value.trim();
}
newSessionNameInput.addEventListener("input", refreshCreateSessionSubmitState);

newSessionNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !createSessionSubmitBtn.disabled) createSessionSubmitBtn.click();
});

openCreateSessionBtn.addEventListener("click", () => {
  newSessionNameInput.value = "";
  newSessionRangeSelect.value = "all";
  newSessionCustomMin.value = 1;
  newSessionCustomMax.value = 604;
  showHideNewSessionCustomRange();
  refreshCreateSessionSubmitState();
  showModal(createSessionModal);
});

createSessionCloseBtn.addEventListener("click", () => hideModal(createSessionModal));
createSessionModal.addEventListener("click", (e) => { if (e.target === createSessionModal) hideModal(createSessionModal); });

createSessionSubmitBtn.addEventListener("click", async () => {
  const name = newSessionNameInput.value.trim();
  if (!name) return;

  const range = (typeof resolveRangeBounds === "function")
    ? resolveRangeBounds(newSessionRangeSelect.value, newSessionCustomMin.value, newSessionCustomMax.value)
    : { minP: 1, maxP: 604 };

  createSessionSubmitBtn.disabled = true;
  const newId = await createSession(name, range.minP, range.maxP);
  createSessionSubmitBtn.disabled = false;

  if (!newId) {
    alert("تعذّر إنشاء الجلسة. حاول مرة أخرى.");
    return;
  }

  // The new session becomes the one and only session new attempts
  // are recorded against, its range is fixed from now on, and the
  // panel score starts fresh for it.
  if (typeof syncActiveSessionId === "function") syncActiveSessionId(newId, range.minP, range.maxP, name);
  if (typeof resetScore === "function") resetScore();
  if (typeof showSessionRangeUI === "function") showSessionRangeUI(range.minP, range.maxP);
  if (typeof refreshQuestionTypeAvailability === "function") await refreshQuestionTypeAvailability();

  hideModal(createSessionModal);
  await refreshSessionsAndShow(newId);
});

// Toggling a session's leaderboard visibility. Only one session per
// user may be public at a time — turning this one on while another
// is already public bumps the other one off (after confirmation).
// Supabase's row-level security silently drops rows we're not
// allowed to touch instead of raising an error, so a successful-
// looking update can still affect zero rows — .select() after the
// update lets us tell the difference and avoid quietly showing a
// "public" session that never actually made it into the leaderboard.
sessionPublicToggle.addEventListener("change", async () => {
  if (!selectedSessionId) return;

  const wanted = sessionPublicToggle.checked;

  if (wanted) {
    const other = mySessions.find((s) => s.session_id !== selectedSessionId && s.is_public);
    if (other) {
      const ok = confirm(
        `يمكن إضافة جلسة واحدة فقط إلى لوحة الصدارة. بإضافة هذه الجلسة ستتم إزالة "${other.title}" من لوحة الصدارة. هل تريد المتابعة؟`
      );
      if (!ok) {
        sessionPublicToggle.checked = false;
        return;
      }

      sessionPublicToggle.disabled = true;
      const removeResult = await setSessionPublic(other.session_id, false);
      sessionPublicToggle.disabled = false;

      if (!removeResult || !removeResult.ok) {
        sessionPublicToggle.checked = false;
        alert("تعذّر تحديث حالة الصدارة. حاول مرة أخرى.");
        return;
      }
      other.is_public = false;
    }
  }

  sessionPublicToggle.disabled = true;
  const result = await setSessionPublic(selectedSessionId, wanted);
  sessionPublicToggle.disabled = false;

  if (!result || !result.ok) {
    sessionPublicToggle.checked = !wanted; // revert — the update didn't actually take
    alert("تعذّر تحديث حالة الصدارة لهذه الجلسة. حاول مرة أخرى.");
    return;
  }

  const s = mySessions.find((x) => x.session_id === selectedSessionId);
  if (s) s.is_public = result.is_public;
  renderSessionChips(); // show/hide the 🏆 badge in the table immediately
});

renameSessionBtn.addEventListener("click", async () => {
  if (!selectedSessionId) return;
  const session = mySessions.find((s) => s.session_id === selectedSessionId);
  const currentName = session ? session.title : "";

  const newName = prompt("اسم الجلسة الجديد:", currentName);
  if (newName === null) return; // cancelled
  const trimmed = newName.trim();
  if (!trimmed || trimmed === currentName) return;

  renameSessionBtn.disabled = true;
  const ok = await renameSession(selectedSessionId, trimmed);
  renameSessionBtn.disabled = false;

  if (!ok) {
    alert("تعذّر إعادة تسمية الجلسة. حاول مرة أخرى.");
    return;
  }

  if (session) session.title = trimmed;
  if (typeof setActiveSessionTitleIfMatches === "function") setActiveSessionTitleIfMatches(selectedSessionId, trimmed);
  renderSessionChips();
  await renderSelectedSession();
});

deleteSessionBtn.addEventListener("click", async () => {
  if (!selectedSessionId) return;

  const activeId = (typeof getActiveSessionId === "function") ? getActiveSessionId() : null;
  if (activeId != null && activeId === selectedSessionId) return; // the last/active session can't be deleted

  const ok = confirm("هل تريد حذف هذه الجلسة؟ سيتم حذف كل إحصائياتها ولا يمكن التراجع.");
  if (!ok) return;

  deleteSessionBtn.disabled = true;
  await deleteSession(selectedSessionId);
  deleteSessionBtn.disabled = false;

  await refreshSessionsAndShow(null);
});


async function refreshSessionsAndShow(preferSessionId) {
  statsBody.innerHTML = '<div class="status">جاري التحميل...</div>';
  sessionActions.style.display = "none";

  mySessions = await fetchMySessions();

  if (mySessions.length === 0) {
    // No account-level session yet (e.g. Supabase not configured, or
    // a brand new user before their first attempt synced).
    sessionChips.innerHTML = "";
    statsBody.innerHTML =
      '<div class="status">لا توجد جلسات بعد. أجب على بعض الأسئلة وسجّل الدخول لتبدأ أول جلسة تلقائياً.</div>';
    return;
  }

  const activeId = (typeof getActiveSessionId === "function") ? getActiveSessionId() : null;
  selectedSessionId = preferSessionId || activeId || mySessions[0].session_id;
  if (!mySessions.some((s) => s.session_id === selectedSessionId)) {
    selectedSessionId = mySessions[0].session_id;
  }

  renderSessionChips();
  await renderSelectedSession();
}

function renderSessionChips() {
  sessionChips.innerHTML = mySessions
    .map((s) => {
      const active = s.session_id === selectedSessionId;
      const pubBadge = s.is_public ? "🏆" : "";
      const answers = s.total_answers || 0;
      const acc = answers ? `${Math.round((100 * (s.total_correct || 0)) / answers)}%` : "—";
      const rangeLabel = pageRangeLabel(s) || "—";
      return `
        <tr class="session-row${active ? " active" : ""}" data-id="${s.session_id}">
          <td class="session-row-title">${escapeHtml(s.title)}</td>
          <td>${rangeLabel}</td>
          <td>${answers}</td>
          <td>${acc}</td>
          <td class="session-row-badge">${pubBadge}</td>
        </tr>`;
    })
    .join("");

  // Selecting a row only changes which session's stats are shown
  // below — it never changes which session new attempts are
  // recorded against (that's always the last/most recent session).
  sessionChips.querySelectorAll(".session-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const id = Number(row.dataset.id);
      if (id === selectedSessionId) return;
      selectedSessionId = id;
      renderSessionChips();
      await renderSelectedSession();
    });
  });
}

async function renderSelectedSession() {
  const session = mySessions.find((s) => s.session_id === selectedSessionId);
  if (!session) return;

  statsBody.innerHTML = '<div class="status">جاري التحميل...</div>';
  const attempts = await fetchSessionAttempts(selectedSessionId);
  statsBody.innerHTML = renderStatsHtml(attempts, session);

  sessionActions.style.display = "flex";
  sessionPublicToggle.checked = !!session.is_public;

  // The last (currently recording) session can't be deleted — hide
  // the button entirely rather than let the user hit an error.
  const activeId = (typeof getActiveSessionId === "function") ? getActiveSessionId() : null;
  const isActiveSession = activeId != null && activeId === selectedSessionId;
  deleteSessionBtn.style.display = isActiveSession ? "none" : "";
}

function renderStatsHtml(attempts, session) {
  const total = session?.total_answers || 0;
  const correct = session?.total_correct || 0;

  if (!attempts || total === 0) {
    return `
      <div class="stat-summary">
        <div class="stat-big">—</div>
        <div class="stat-caption">${escapeHtml(session?.title || "")} — لا توجد إجابات بعد في هذه الجلسة.</div>
      </div>`;
  }

  const pct = Math.round((correct / total) * 100);

  const byType = {};
  attempts.forEach((a) => {
    byType[a.question_type] = byType[a.question_type] || { total: 0, correct: 0 };
    byType[a.question_type].total += 1;
    if (a.is_correct) byType[a.question_type].correct += 1;
  });

  const rows = Object.entries(byType)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([type, s]) => {
      const p = Math.round((s.correct / s.total) * 100);
      return `
        <div class="stat-row">
          <div class="stat-row-label">${getTypeLabel(type)}</div>
          <div class="stat-row-bar"><div class="stat-row-fill" style="width:${p}%"></div></div>
          <div class="stat-row-value">${s.correct}/${s.total} (${p}%)</div>
        </div>`;
    })
    .join("");

  return `
    <div class="stat-summary">
      <div class="stat-big">${pct}%</div>
      <div class="stat-caption">${escapeHtml(session.title)} — ${correct} صحيحة من أصل ${total} محاولة${pageRangeLabel(session) ? ` — النطاق: ${pageRangeLabel(session)}` : ""}</div>
    </div>
    <div class="stat-rows">${rows}</div>
  `;
}

// -------- leaderboard modal (fair, per-session ranking) --------
// Ranking blends three things:
//  1. Accuracy — via a Wilson score lower bound, so a tiny sample
//     like 3/3 (100%) can't outrank a large, reliable one like
//     74/75 (98.7%).
//  2. Number of questions answered — baked into that same bound
//     (more attempts narrow the confidence interval).
//  3. Page range breadth — a session quizzed across a wide span of
//     the Mushaf is more impressive than one that stuck to a
//     handful of pages, so it earns up to a 35% boost on top of
//     its accuracy score.
const QURAN_TOTAL_PAGES = 604;

function wilsonLowerBound(correct, total, z = 1.96) {
  if (!total) return 0;
  const phat = correct / total;
  const denom = 1 + (z * z) / total;
  const centre = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return (centre - margin) / denom;
}

function pageRangeSpan(row) {
  if (row.range_min != null && row.range_max != null) return row.range_max - row.range_min + 1;
  if (row.min_page != null && row.max_page != null) return row.max_page - row.min_page + 1;
  return 0;
}

// Human-readable "من X إلى Y" style label — prefers the session's
// stored configured range (set by record_attempt() in the DB) and
// falls back to the span of pages actually asked, for sessions
// recorded before that column existed.
function pageRangeLabel(row) {
  if (row.range_min != null && row.range_max != null) return `${row.range_min}–${row.range_max}`;
  if (row.min_page != null && row.max_page != null) return `${row.min_page}–${row.max_page}`;
  return null;
}

function fairScore(row) {
  const accuracyScore = wilsonLowerBound(row.total_correct, row.total_answers);
  const rangeFactor = Math.min(1, pageRangeSpan(row) / QURAN_TOTAL_PAGES);
  return accuracyScore * (0.65 + 0.35 * rangeFactor);
}

// Called by switchView("leaderboard") when that tab is opened.
async function loadLeaderboardView() {
  leaderboardBody.innerHTML = '<div class="status">جاري التحميل...</div>';
  const rows = await fetchSessionLeaderboard();
  leaderboardBody.innerHTML = renderLeaderboardHtml(rows);
}

function renderLeaderboardHtml(rows) {
  if (!rows || rows.length === 0) {
    return '<div class="status">لا توجد جلسات في لوحة الصدارة بعد. افتح إحصائياتك واختر "أضف هذه الجلسة إلى لوحة الصدارة" لتكون أول من ينضم.</div>';
  }

  const ranked = rows
    .map((r) => ({ ...r, fairScore: fairScore(r) }))
    .sort((a, b) => b.fairScore - a.fairScore)
    .slice(0, 15);

  return ranked
    .map((r, i) => {
      const label = pageRangeLabel(r);
      const rangeLabel = label ? ` — ${label}` : "";
      const levelLabel = (typeof levelFromXp === "function" && r.owner_xp != null)
        ? ` <span class="lb-level">(المستوى ${levelFromXp(r.owner_xp)}${typeof levelTitle === "function" ? ` · ${levelTitle(levelFromXp(r.owner_xp))}` : ""})</span>`
        : "";
      return `
      <div class="stat-row leaderboard-row">
        <div class="stat-row-label">${i + 1}. ${escapeHtml(r.display_name)}${levelLabel} — ${escapeHtml(r.title)}</div>
        <div class="stat-row-value">${r.total_correct}/${r.total_answers} (${r.accuracy_pct}%)${rangeLabel}</div>
      </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  return (str || "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// -------- achievements view (lifetime level + badges) --------
function clampPct(n) { return Math.max(0, Math.min(100, n)); }

// The full rank ladder (all named tiers, not just the current one) —
// shows what's already been passed, which tier the person is in right
// now, and how much XP stands between them and the next one, so
// leveling up has a visible "next milestone" to chase instead of just
// a number ticking up.
function buildRankLadderHtml(level, xp) {
  const tiers = (typeof levelTierList === "function") ? levelTierList() : [];
  if (!tiers.length) return "";

  let currentIdx = 0;
  tiers.forEach((tier, i) => { if (level >= tier.minLevel) currentIdx = i; });

  const rows = tiers
    .map((tier, i) => {
      const nextTier = tiers[i + 1];
      const rangeLabel = nextTier
        ? `المستوى ${tier.minLevel}–${nextTier.minLevel - 1}`
        : `المستوى ${tier.minLevel}+`;

      let statusClass = "locked";
      let icon = "🔒";
      let tag = "";

      if (i < currentIdx) {
        statusClass = "passed";
        icon = "✅";
      } else if (i === currentIdx) {
        statusClass = "current";
        icon = "⭐";
        tag = '<span class="rank-ladder-tag">أنت هنا</span>';
      } else if (i === currentIdx + 1) {
        const xpNeeded = Math.max(0, tier.minXp - xp);
        tag = `<span class="rank-ladder-tag rank-ladder-tag-muted">${xpNeeded} XP للوصول</span>`;
      }

      return `
        <div class="rank-ladder-row ${statusClass}">
          <div class="rank-ladder-icon">${icon}</div>
          <div class="rank-ladder-info">
            <div class="rank-ladder-title">${escapeHtml(tier.title)}</div>
            <div class="rank-ladder-range">${rangeLabel}</div>
          </div>
          ${tag}
        </div>`;
    })
    .join("");

  return `
    <div class="section-label">سلّم الرتب</div>
    <div class="rank-ladder">${rows}</div>`;
}

// Called by switchView("achievements") when that tab is opened.
async function loadAchievementsView() {
  achievementsBody.innerHTML = '<div class="status">جاري التحميل...</div>';

  const [stats, catalog, earned] = await Promise.all([
    fetchUserStats(),
    fetchAchievementsCatalog(),
    fetchMyAchievements(),
  ]);

  const xp = stats?.xp || 0;
  const level = levelFromXp(xp);
  const thisLevelStart = xpForLevel(level);
  const nextLevelStart = xpForLevel(level + 1);
  const pct = nextLevelStart > thisLevelStart
    ? clampPct(((xp - thisLevelStart) / (nextLevelStart - thisLevelStart)) * 100)
    : 100;

  const earnedCodes = new Set((earned || []).map((e) => e.code));
  const title = (typeof levelTitle === "function") ? levelTitle(level) : "";

  const summaryHtml = `
    <div class="level-summary">
      <div class="level-summary-badge">🎖️ المستوى ${level}${title ? ` · ${escapeHtml(title)}` : ""}</div>
      <div class="level-summary-xp">${xp} XP</div>
      <div class="level-progress-bar"><div class="level-progress-fill" style="width:${pct}%"></div></div>
      <div class="level-progress-caption">${Math.max(0, nextLevelStart - xp)} XP للمستوى التالي</div>
    </div>`;

  achievementsBody.innerHTML =
    summaryHtml +
    buildRankLadderHtml(level, xp) +
    '<div class="section-label">الإنجازات</div>' +
    buildBadgesGridHtml(catalog, earnedCodes);
}

// Shared by the achievements view and the friend-profile view.
function buildBadgesGridHtml(catalog, earnedCodes) {
  const badgesHtml = (catalog || [])
    .map((b) => {
      const isEarned = earnedCodes.has(b.code);
      return `
        <div class="badge-item${isEarned ? " earned" : " locked"}">
          <div class="badge-icon">${b.icon || "🏅"}</div>
          <div class="badge-title">${escapeHtml(b.title)}</div>
          <div class="badge-desc">${escapeHtml(b.description)}</div>
        </div>`;
    })
    .join("");
  return badgesHtml ? `<div class="badges-grid">${badgesHtml}</div>` : "";
}

// -------- progress: heatmap + daily streak (shared by the "📈 تقدمي"
// modal and the standalone shared-view page below) --------
function heatColorForAccuracy(pct) {
  const hue = Math.max(0, Math.min(120, (pct / 100) * 120)); // 0=red, 120=green
  return `hsl(${hue}, 60%, 45%)`;
}

function renderHeatmapInto(containerEl, pageStats) {
  const map = new Map((pageStats || []).map((r) => [r.page, r]));
  let html = "";
  for (let p = 1; p <= 604; p++) {
    const s = map.get(p);
    if (s && s.total > 0) {
      const pct = Math.round((100 * s.correct) / s.total);
      html += `<div class="heatmap-cell" style="background:${heatColorForAccuracy(pct)}" title="صفحة ${p}: ${s.correct}/${s.total} (${pct}%)"></div>`;
    } else {
      html += `<div class="heatmap-cell" title="صفحة ${p}: لم تُدرَس بعد"></div>`;
    }
  }
  containerEl.innerHTML = html;
}

function computeStreaks(dailyActivity) {
  const daySet = new Set((dailyActivity || []).map((d) => d.date));
  let current = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!daySet.has(key)) break;
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  let longest = 0;
  let run = 0;
  let prevDate = null;
  Array.from(daySet).sort().forEach((d) => {
    const dt = new Date(d + "T00:00:00Z");
    run = (prevDate && Math.round((dt - prevDate) / 86400000) === 1) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevDate = dt;
  });

  return { current, longest: Math.max(longest, current) };
}

function renderStreakInto(stripEl, numbersEl, dailyActivity) {
  const dayMap = new Map((dailyActivity || []).map((r) => [r.date, r.total]));
  const today = new Date();
  let html = "";
  for (let i = 0; i <= 29; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const total = dayMap.get(key);
    const active = total != null;
    html += `<div class="streak-day${active ? " active" : ""}" title="${key}${active ? ` — ${total} سؤال` : ""}"></div>`;
  }
  stripEl.innerHTML = html;

  const streaks = computeStreaks(dailyActivity);
  numbersEl.textContent = `🔥 التتابع الحالي: ${streaks.current} يوم — الأطول: ${streaks.longest} يوم`;
}

function progressSummaryHtml(pageStats, extra) {
  const touched = pageStats.length;
  const totalAnswers = pageStats.reduce((sum, r) => sum + r.total, 0);
  const totalCorrect = pageStats.reduce((sum, r) => sum + r.correct, 0);
  const pct = totalAnswers ? Math.round((100 * totalCorrect) / totalAnswers) : 0;
  return `
    <div class="progress-summary">
      <div class="stat-big">${touched}/604</div>
      <div class="stat-caption">صفحة تمت مراجعتها — دقة إجمالية ${pct}%${extra || ""}</div>
    </div>`;
}

// -------- progress view (own account) --------
function buildProgressBodyHtml() {
  return `
    <div id="progressSummary"></div>
    <div class="section-label">خريطة تغطية الصفحات (604 صفحة)</div>
    <div id="myHeatmap" class="heatmap-grid"></div>
    <div class="section-label">النشاط اليومي (آخر 30 يومًا)</div>
    <div id="myStreakStrip" class="streak-strip"></div>
    <div id="myStreakNumbers" class="streak-numbers"></div>`;
}

// Called by switchView("progress") when that tab is opened.
async function loadProgressView() {
  progressBody.innerHTML = '<div class="status">جاري التحميل...</div>';

  const [pageStats, dailyActivity] = await Promise.all([
    fetchMyPageStats(),
    fetchMyDailyActivity(),
  ]);

  progressBody.innerHTML = buildProgressBodyHtml();
  document.getElementById("progressSummary").innerHTML = progressSummaryHtml(pageStats, "");
  renderHeatmapInto(document.getElementById("myHeatmap"), pageStats);
  renderStreakInto(document.getElementById("myStreakStrip"), document.getElementById("myStreakNumbers"), dailyActivity);
}

// -------- friends view: my code, add a friend, requests, friend list --------
const friendsBody = document.getElementById("friendsBody");
const friendsListSection = document.getElementById("friendsListSection");
const friendProfileSection = document.getElementById("friendProfileSection");
const friendProfileBackBtn = document.getElementById("friendProfileBackBtn");

// Shows the friend list "page" of the friends tab (as opposed to a
// single friend's profile "page" — see openFriendProfile() below).
function showFriendsListSection() {
  friendProfileSection.style.display = "none";
  friendsListSection.style.display = "block";
}

friendProfileBackBtn.addEventListener("click", showFriendsListSection);

function friendRequestErrorMessage(err) {
  switch (err) {
    case "not_found": return "لا يوجد مستخدم بهذا المعرّف.";
    case "self": return "هذا معرّفك أنت.";
    case "already_pending": return "طلب الصداقة قيد الانتظار بالفعل.";
    case "already_accepted": return "أنتما صديقان بالفعل.";
    case "already_declined": return "تم رفض هذا الطلب سابقًا.";
    default: return "تعذّر إرسال الطلب. حاول مرة أخرى.";
  }
}

function buildFriendsBodyHtml() {
  return `
    <div class="section-label">معرّفك</div>
    <div class="friend-code-row">
      <input id="myFriendCodeInput" type="text" readonly>
      <button id="copyFriendCodeBtn" type="button" class="btn small ghost">نسخ</button>
    </div>
    <div class="hint">شارك هذا المعرّف مع صديق أو ولي أمر ليضيفك من «إضافة صديق».</div>

    <div class="section-label">إضافة صديق</div>
    <div class="friend-add-row">
      <input id="addFriendCodeInput" type="text" placeholder="أدخل معرّف صديقك" maxlength="12">
      <button id="addFriendBtn" type="button" class="btn small ghost">إرسال طلب</button>
    </div>

    <div id="incomingRequestsSection" style="display:none;">
      <div class="section-label">طلبات واردة</div>
      <div id="incomingRequestsList" class="friend-list"></div>
    </div>

    <div id="outgoingRequestsSection" style="display:none;">
      <div class="section-label">طلبات مرسلة (قيد الانتظار)</div>
      <div id="outgoingRequestsList" class="friend-list"></div>
    </div>

    <div class="section-label">أصدقائي</div>
    <div id="friendsListBody" class="friend-list"></div>`;
}

async function loadFriendsModal() {
  friendsBody.innerHTML = '<div class="status">جاري التحميل...</div>';

  const [code, incoming, outgoing, friends] = await Promise.all([
    fetchMyFriendCode(),
    fetchIncomingFriendRequests(),
    fetchOutgoingFriendRequests(),
    fetchMyFriends(),
  ]);

  friendsBody.innerHTML = buildFriendsBodyHtml();

  const myCodeInput = document.getElementById("myFriendCodeInput");
  const copyCodeBtn = document.getElementById("copyFriendCodeBtn");
  const addCodeInput = document.getElementById("addFriendCodeInput");
  const addBtn = document.getElementById("addFriendBtn");
  const incomingSection = document.getElementById("incomingRequestsSection");
  const incomingList = document.getElementById("incomingRequestsList");
  const outgoingSection = document.getElementById("outgoingRequestsSection");
  const outgoingList = document.getElementById("outgoingRequestsList");
  const friendsListBody = document.getElementById("friendsListBody");

  myCodeInput.value = code || "—";

  copyCodeBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(myCodeInput.value);
      copyCodeBtn.textContent = "تم النسخ ✓";
      setTimeout(() => { copyCodeBtn.textContent = "نسخ"; }, 1500);
    } catch (e) {
      alert("انسخ المعرّف يدويًا: " + myCodeInput.value);
    }
  });

  addBtn.addEventListener("click", async () => {
    const value = addCodeInput.value.trim();
    if (!value) return;
    addBtn.disabled = true;
    const result = await sendFriendRequest(value);
    addBtn.disabled = false;
    if (!result || !result.ok) {
      alert(friendRequestErrorMessage(result && result.error));
      return;
    }
    addCodeInput.value = "";
    alert(result.status === "accepted" ? "أصبحتما صديقين!" : "تم إرسال طلب الصداقة.");
    await loadFriendsModal();
  });

  if (incoming.length) {
    incomingSection.style.display = "block";
    incomingList.innerHTML = incoming
      .map((r) => `
        <div class="friend-list-row" data-request-id="${r.id}">
          <span class="friend-list-name">${escapeHtml(r.from_display_name)}</span>
          <span class="friend-list-actions">
            <button type="button" class="btn small ghost accept-request-btn">قبول</button>
            <button type="button" class="btn small ghost danger decline-request-btn">رفض</button>
          </span>
        </div>`)
      .join("");

    incomingList.querySelectorAll(".accept-request-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.closest(".friend-list-row").dataset.requestId);
        btn.disabled = true;
        const ok = await respondFriendRequest(id, true);
        if (!ok) { alert("تعذّرت الموافقة على الطلب."); btn.disabled = false; return; }
        await loadFriendsModal();
      });
    });
    incomingList.querySelectorAll(".decline-request-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.closest(".friend-list-row").dataset.requestId);
        btn.disabled = true;
        const ok = await respondFriendRequest(id, false);
        if (!ok) { alert("تعذّر رفض الطلب."); btn.disabled = false; return; }
        await loadFriendsModal();
      });
    });
  }

  if (outgoing.length) {
    outgoingSection.style.display = "block";
    outgoingList.innerHTML = outgoing
      .map((r) => `
        <div class="friend-list-row">
          <span class="friend-list-name">${escapeHtml(r.to_display_name)}</span>
          <span class="friend-list-status">قيد الانتظار</span>
        </div>`)
      .join("");
  }

  if (!friends.length) {
    friendsListBody.innerHTML = '<div class="status">لا يوجد أصدقاء بعد.</div>';
  } else {
    friendsListBody.innerHTML = friends
      .map((f) => `
        <div class="friend-list-row" data-user-id="${f.friend_user_id}">
          <span class="friend-list-name">${escapeHtml(f.friend_display_name)}</span>
          <span class="friend-list-actions">
            <button type="button" class="btn small ghost view-friend-btn">عرض الملف</button>
            <button type="button" class="btn small ghost danger remove-friend-btn">إزالة</button>
          </span>
        </div>`)
      .join("");

    friendsListBody.querySelectorAll(".view-friend-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.closest(".friend-list-row").dataset.userId;
        openFriendProfile(uid);
      });
    });
    friendsListBody.querySelectorAll(".remove-friend-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".friend-list-row");
        const uid = row.dataset.userId;
        const name = row.querySelector(".friend-list-name").textContent;
        const ok = confirm(`إزالة "${name}" من الأصدقاء؟`);
        if (!ok) return;
        btn.disabled = true;
        const removed = await removeFriend(uid);
        if (!removed) { alert("تعذّرت إزالة الصديق."); btn.disabled = false; return; }
        await loadFriendsModal();
      });
    });
  }
}

// Opening the friends tab itself is handled by switchView("friends")
// in the bottom-nav wiring above.

// -------- friend profile "page" (was its own modal; now a second
// page within the friends tab — see friendProfileSection) --------
const friendProfileTitle = document.getElementById("friendProfileTitle");
const friendProfileBody = document.getElementById("friendProfileBody");

async function openFriendProfile(friendUserId) {
  friendsListSection.style.display = "none";
  friendProfileSection.style.display = "block";
  friendProfileTitle.textContent = "الملف الشخصي";
  friendProfileBody.innerHTML = '<div class="status">جاري التحميل...</div>';

  const [data, catalog] = await Promise.all([
    fetchFriendProfile(friendUserId),
    fetchAchievementsCatalog(),
  ]);

  if (!data) {
    friendProfileBody.innerHTML = '<div class="status">تعذّر عرض هذا الملف — تأكد أنكما ما زلتما صديقين.</div>';
    return;
  }

  friendProfileTitle.textContent = data.display_name || "مستخدم";
  const level = (typeof levelFromXp === "function") ? levelFromXp(data.xp || 0) : null;
  const pageStats = (data.page_stats || []).map((r) => ({ page: r.page, total: r.total, correct: r.correct }));
  const dailyActivity = data.daily_activity || [];
  const earnedCodes = new Set(data.earned_achievements || []);
  const sessions = data.sessions || [];

  const sessionsHtml = sessions.length
    ? sessions.map((s) => {
        const pct = s.total_answers ? Math.round((100 * s.total_correct) / s.total_answers) : 0;
        const range = (s.range_min != null && s.range_max != null) ? `${s.range_min}–${s.range_max}` : "—";
        return `
          <div class="stat-row leaderboard-row">
            <div class="stat-row-label">${escapeHtml(s.title)}${s.is_public ? " 🏆" : ""} — ${range}</div>
            <div class="stat-row-value">${s.total_correct}/${s.total_answers} (${pct}%)</div>
          </div>`;
      }).join("")
    : '<div class="status">لا توجد جلسات بعد.</div>';

  friendProfileBody.innerHTML = `
    ${progressSummaryHtml(pageStats, level != null ? ` — المستوى ${level}${typeof levelTitle === "function" ? ` · ${escapeHtml(levelTitle(level))}` : ""}` : "")}
    <div class="section-label">خريطة تغطية الصفحات</div>
    <div id="friendHeatmap" class="heatmap-grid"></div>
    <div class="section-label">النشاط اليومي (آخر 30 يومًا)</div>
    <div id="friendStreakStrip" class="streak-strip"></div>
    <div id="friendStreakNumbers" class="streak-numbers"></div>
    ${level != null ? buildRankLadderHtml(level, data.xp || 0) : ""}
    <div class="section-label">الإنجازات</div>
    ${buildBadgesGridHtml(catalog, earnedCodes)}
    <div class="section-label">الجلسات</div>
    ${sessionsHtml}`;

  renderHeatmapInto(document.getElementById("friendHeatmap"), pageStats);
  renderStreakInto(document.getElementById("friendStreakStrip"), document.getElementById("friendStreakNumbers"), dailyActivity);
}

// Kick off auth
initAuth();
