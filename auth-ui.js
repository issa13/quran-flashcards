// UI wiring for the auth bar, auth modal, stats modal (sessions), and
// leaderboard modal. Depends on supabase-client.js being loaded first.

const guestActions = document.getElementById("guestActions");
const userActions = document.getElementById("userActions");
const userNameLabel = document.getElementById("userNameLabel");

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
const newSessionBtn = document.getElementById("newSessionBtn");
const sessionActions = document.getElementById("sessionActions");
const sessionPublicToggle = document.getElementById("sessionPublicToggle");
const deleteSessionBtn = document.getElementById("deleteSessionBtn");

const leaderboardModal = document.getElementById("leaderboardModal");
const leaderboardOpenBtn = document.getElementById("leaderboardOpenBtn");
const leaderboardCloseBtn = document.getElementById("leaderboardCloseBtn");
const leaderboardBody = document.getElementById("leaderboardBody");

const logoutBtn = document.getElementById("logoutBtn");

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
}

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
onAuthChange(async (user) => {
  if (user) {
    guestActions.style.display = "none";
    userActions.style.display = "flex";
    const profile = await fetchProfile();
    userNameLabel.textContent = profile?.display_name ? `مرحباً، ${profile.display_name}` : "مرحباً";
  } else {
    guestActions.style.display = "flex";
    userActions.style.display = "none";
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

newSessionBtn.addEventListener("click", async () => {
  newSessionBtn.disabled = true;
  const label = `جلسة ${mySessions.length + 1}`;
  const newId = await createSession(label);
  newSessionBtn.disabled = false;
  if (newId) await refreshSessionsAndShow(newId);
});

sessionPublicToggle.addEventListener("change", async () => {
  if (!selectedSessionId) return;
  await setSessionPublic(selectedSessionId, sessionPublicToggle.checked);
  const s = mySessions.find((x) => x.session_id === selectedSessionId);
  if (s) s.is_public = sessionPublicToggle.checked;
});

deleteSessionBtn.addEventListener("click", async () => {
  if (!selectedSessionId) return;
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
      const pubBadge = s.is_public ? " 🏆" : "";
      return `<button class="session-chip${active ? " active" : ""}" data-id="${s.session_id}">${escapeHtml(s.title)}${pubBadge}</button>`;
    })
    .join("");

  sessionChips.querySelectorAll(".session-chip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      if (id === selectedSessionId) return;
      selectedSessionId = id;
      if (typeof setActiveSessionId === "function") await setActiveSessionId(id);
      if (typeof syncActiveSessionId === "function") syncActiveSessionId(id);
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
      <div class="stat-caption">${escapeHtml(session.title)} — ${correct} صحيحة من أصل ${total} محاولة</div>
    </div>
    <div class="stat-rows">${rows}</div>
  `;
}

// -------- leaderboard modal (fair, per-session ranking) --------
// Wilson score lower bound: balances accuracy against sample size so
// a tiny 100% session can't outrank a large, reliably-accurate one.
function wilsonLowerBound(correct, total, z = 1.96) {
  if (!total) return 0;
  const phat = correct / total;
  const denom = 1 + (z * z) / total;
  const centre = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return (centre - margin) / denom;
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
    .map((r) => ({ ...r, fairScore: wilsonLowerBound(r.total_correct, r.total_answers) }))
    .sort((a, b) => b.fairScore - a.fairScore);

  return ranked
    .map(
      (r, i) => `
      <div class="stat-row leaderboard-row">
        <div class="stat-row-label">${i + 1}. ${escapeHtml(r.display_name)} — ${escapeHtml(r.title)}</div>
        <div class="stat-row-value">${r.total_correct}/${r.total_answers} (${r.accuracy_pct}%)</div>
      </div>`
    )
    .join("");
}

function escapeHtml(str) {
  return (str || "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Kick off auth
initAuth();