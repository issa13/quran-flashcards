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

const statsModal = document.getElementById("statsModal");
const statsOpenBtn = document.getElementById("statsOpenBtn");
const statsCloseBtn = document.getElementById("statsCloseBtn");
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

const leaderboardModal = document.getElementById("leaderboardModal");
const leaderboardOpenBtn = document.getElementById("leaderboardOpenBtn");
const leaderboardCloseBtn = document.getElementById("leaderboardCloseBtn");
const leaderboardBody = document.getElementById("leaderboardBody");

const achievementsModal = document.getElementById("achievementsModal");
const achievementsOpenBtn = document.getElementById("achievementsOpenBtn");
const achievementsCloseBtn = document.getElementById("achievementsCloseBtn");
const achievementsBody = document.getElementById("achievementsBody");

const progressModal = document.getElementById("progressModal");
const progressOpenBtn = document.getElementById("progressOpenBtn");
const progressCloseBtn = document.getElementById("progressCloseBtn");
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

// -------- side menu (drawer) --------
const menuToggleBtn = document.getElementById("menuToggleBtn");
const sideMenu = document.getElementById("sideMenu");
const sideMenuOverlay = document.getElementById("sideMenuOverlay");
const sideMenuCloseBtn = document.getElementById("sideMenuCloseBtn");

function openSideMenu() {
  sideMenu.classList.add("open");
  sideMenuOverlay.classList.add("open");
}
function closeSideMenu() {
  sideMenu.classList.remove("open");
  sideMenuOverlay.classList.remove("open");
}

menuToggleBtn.addEventListener("click", openSideMenu);
sideMenuCloseBtn.addEventListener("click", closeSideMenu);
sideMenuOverlay.addEventListener("click", closeSideMenu);

// Any button inside the drawer (stats/achievements/progress/leaderboard/
// login/logout) closes the drawer too, so picking an action doesn't
// leave it hanging open behind the modal it just opened.
sideMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn && btn.id !== "sideMenuCloseBtn") closeSideMenu();
});

let authMode = "login"; // or "signup"
let mySessions = [];          // cached list from session_summary
let selectedSessionId = null; // which session is shown in the stats modal

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

  userLevelBadge.textContent = `🎖️ المستوى ${level}`;
  userLevelBadge.style.display = "inline-flex";

  if (lastKnownLevel != null && level > lastKnownLevel && typeof showAchievementToast === "function") {
    showAchievementToast({ icon: "🎖️", title: `وصلت إلى المستوى ${level}!` });
  }
  lastKnownLevel = level;
}

onAuthChange(async (user) => {
  if (user) {
    guestActions.style.display = "none";
    userActions.style.display = "flex";
    const profile = await fetchProfile();
    userNameLabel.textContent = profile?.display_name ? `مرحباً، ${profile.display_name}` : "مرحباً";

    const stats = await fetchUserStats();
    updateLevelBadge(stats?.xp || 0);
  } else {
    guestActions.style.display = "flex";
    userActions.style.display = "none";
    userLevelBadge.style.display = "none";
    lastKnownLevel = null;
    mySessions = [];
    selectedSessionId = null;
  }
});

// -------- stats modal (sessions) --------
statsOpenBtn.addEventListener("click", async () => {
  showModal(statsModal);
  await refreshSessionsAndShow(null); // null = default to active session
});

statsCloseBtn.addEventListener("click", () => hideModal(statsModal));
statsModal.addEventListener("click", (e) => { if (e.target === statsModal) hideModal(statsModal); });

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
  if (typeof syncActiveSessionId === "function") syncActiveSessionId(newId, range.minP, range.maxP);
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

leaderboardOpenBtn.addEventListener("click", async () => {
  showModal(leaderboardModal);
  leaderboardBody.innerHTML = '<div class="status">جاري التحميل...</div>';
  const rows = await fetchSessionLeaderboard();
  leaderboardBody.innerHTML = renderLeaderboardHtml(rows);
});

leaderboardCloseBtn.addEventListener("click", () => hideModal(leaderboardModal));
leaderboardModal.addEventListener("click", (e) => { if (e.target === leaderboardModal) hideModal(leaderboardModal); });

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
        ? ` <span class="lb-level">(المستوى ${levelFromXp(r.owner_xp)})</span>`
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

// -------- achievements modal (lifetime level + badges) --------
function clampPct(n) { return Math.max(0, Math.min(100, n)); }

achievementsOpenBtn.addEventListener("click", async () => {
  showModal(achievementsModal);
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

  const summaryHtml = `
    <div class="level-summary">
      <div class="level-summary-badge">🎖️ المستوى ${level}</div>
      <div class="level-summary-xp">${xp} XP</div>
      <div class="level-progress-bar"><div class="level-progress-fill" style="width:${pct}%"></div></div>
      <div class="level-progress-caption">${Math.max(0, nextLevelStart - xp)} XP للمستوى التالي</div>
    </div>`;

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

  achievementsBody.innerHTML = summaryHtml + (badgesHtml ? `<div class="badges-grid">${badgesHtml}</div>` : "");
});

achievementsCloseBtn.addEventListener("click", () => hideModal(achievementsModal));
achievementsModal.addEventListener("click", (e) => { if (e.target === achievementsModal) hideModal(achievementsModal); });

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
  for (let i = 29; i >= 0; i--) {
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

// -------- progress modal (own account) --------
function buildProgressBodyHtml() {
  return `
    <div id="progressSummary"></div>
    <div class="section-label">خريطة تغطية الصفحات (604 صفحة)</div>
    <div id="myHeatmap" class="heatmap-grid"></div>
    <div class="section-label">النشاط اليومي (آخر 30 يومًا)</div>
    <div id="myStreakStrip" class="streak-strip"></div>
    <div id="myStreakNumbers" class="streak-numbers"></div>
    <div class="share-section">
      <label class="toggle-row">
        <input type="checkbox" id="shareProgressToggle">
        🔗 مشاركة تقدمي عبر رابط للقراءة فقط (بدون حساب)
      </label>
      <div id="shareLinkRow" class="share-link-row" style="display:none;">
        <input id="shareLinkInput" type="text" readonly>
        <button id="copyShareLinkBtn" type="button" class="btn small ghost">نسخ</button>
        <button id="regenerateShareLinkBtn" type="button" class="btn small ghost">تجديد</button>
      </div>
      <div class="hint">تجديد الرابط يُبطل أي رابط قديم تمت مشاركته.</div>
    </div>`;
}

function shareUrlFor(token) {
  return `${location.origin}${location.pathname}?share=${token}`;
}

progressOpenBtn.addEventListener("click", async () => {
  showModal(progressModal);
  progressBody.innerHTML = '<div class="status">جاري التحميل...</div>';

  const [pageStats, dailyActivity, shareSettings] = await Promise.all([
    fetchMyPageStats(),
    fetchMyDailyActivity(),
    fetchMyShareSettings(),
  ]);

  progressBody.innerHTML = buildProgressBodyHtml();
  document.getElementById("progressSummary").innerHTML = progressSummaryHtml(pageStats, "");
  renderHeatmapInto(document.getElementById("myHeatmap"), pageStats);
  renderStreakInto(document.getElementById("myStreakStrip"), document.getElementById("myStreakNumbers"), dailyActivity);

  const shareToggle = document.getElementById("shareProgressToggle");
  const shareLinkRow = document.getElementById("shareLinkRow");
  const shareLinkInput = document.getElementById("shareLinkInput");
  const copyBtn = document.getElementById("copyShareLinkBtn");
  const regenBtn = document.getElementById("regenerateShareLinkBtn");

  function applyShareSettings(settings) {
    const enabled = !!(settings && settings.enabled);
    shareToggle.checked = enabled;
    shareLinkRow.style.display = (enabled && settings.token) ? "flex" : "none";
    if (enabled && settings.token) shareLinkInput.value = shareUrlFor(settings.token);
  }
  applyShareSettings(shareSettings);

  shareToggle.addEventListener("change", async () => {
    const wanted = shareToggle.checked;
    shareToggle.disabled = true;
    const updated = await setShareEnabled(wanted);
    shareToggle.disabled = false;
    if (!updated) {
      alert("تعذّر تحديث إعدادات المشاركة. حاول مرة أخرى.");
      shareToggle.checked = !wanted;
      return;
    }
    applyShareSettings(updated);
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareLinkInput.value);
      copyBtn.textContent = "تم النسخ ✓";
      setTimeout(() => { copyBtn.textContent = "نسخ"; }, 1500);
    } catch (e) {
      alert("انسخ الرابط يدويًا: " + shareLinkInput.value);
    }
  });

  regenBtn.addEventListener("click", async () => {
    const ok = confirm("سيتم إبطال أي رابط قديم تمت مشاركته. هل تريد المتابعة؟");
    if (!ok) return;
    regenBtn.disabled = true;
    const token = await regenerateShareToken();
    regenBtn.disabled = false;
    if (!token) {
      alert("تعذّر تجديد الرابط. حاول مرة أخرى.");
      return;
    }
    shareLinkInput.value = shareUrlFor(token);
    shareLinkRow.style.display = "flex";
  });
});

progressCloseBtn.addEventListener("click", () => hideModal(progressModal));
progressModal.addEventListener("click", (e) => { if (e.target === progressModal) hideModal(progressModal); });

// -------- standalone shared-view page (?share=<token>) --------
// Replaces the whole app UI with a read-only progress view — no
// account or login needed to see it. Runs once at load; if there's
// no ?share= param this is a no-op and the normal app behaves as usual.
async function initSharedViewIfPresent() {
  const token = new URLSearchParams(location.search).get("share");
  if (!token) return;

  const appWrap = document.querySelector("body > .wrap");
  if (appWrap) appWrap.style.display = "none";

  const sharedViewSection = document.getElementById("sharedViewSection");
  const sharedViewName = document.getElementById("sharedViewName");
  const sharedViewBody = document.getElementById("sharedViewBody");
  const sharedViewError = document.getElementById("sharedViewError");

  sharedViewSection.style.display = "block";
  sharedViewBody.innerHTML = '<div class="status">جاري التحميل...</div>';

  const data = (typeof fetchSharedProgress === "function") ? await fetchSharedProgress(token) : null;

  if (!data) {
    sharedViewBody.innerHTML = "";
    sharedViewError.style.display = "block";
    sharedViewError.textContent = "هذا الرابط غير صالح أو تم إيقاف المشاركة من صاحبه.";
    return;
  }

  sharedViewName.textContent = data.display_name || "مستخدم";
  const level = (typeof levelFromXp === "function") ? levelFromXp(data.xp || 0) : null;
  const pageStats = (data.page_stats || []).map((r) => ({ page: r.page, total: r.total, correct: r.correct }));
  const dailyActivity = data.daily_activity || [];

  sharedViewBody.innerHTML = `
    <div class="panel">${progressSummaryHtml(pageStats, level != null ? ` — المستوى ${level}` : "")}</div>
    <div class="panel">
      <div class="title">خريطة تغطية الصفحات</div>
      <div id="sharedHeatmap" class="heatmap-grid"></div>
    </div>
    <div class="panel">
      <div class="title">النشاط اليومي (آخر 30 يومًا)</div>
      <div id="sharedStreakStrip" class="streak-strip"></div>
      <div id="sharedStreakNumbers" class="streak-numbers"></div>
    </div>`;

  renderHeatmapInto(document.getElementById("sharedHeatmap"), pageStats);
  renderStreakInto(document.getElementById("sharedStreakStrip"), document.getElementById("sharedStreakNumbers"), dailyActivity);
}

initSharedViewIfPresent();

// Kick off auth
initAuth();
