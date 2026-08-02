// UI wiring for the auth bar, auth modal, stats modal, and leaderboard modal.
// Depends on supabase-client.js being loaded first.

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

const statsModal = document.getElementById("statsModal");
const statsOpenBtn = document.getElementById("statsOpenBtn");
const statsCloseBtn = document.getElementById("statsCloseBtn");
const statsBody = document.getElementById("statsBody");
const leaderboardOptIn = document.getElementById("leaderboardOptIn");

const leaderboardModal = document.getElementById("leaderboardModal");
const leaderboardOpenBtn = document.getElementById("leaderboardOpenBtn");
const leaderboardCloseBtn = document.getElementById("leaderboardCloseBtn");
const leaderboardBody = document.getElementById("leaderboardBody");

const logoutBtn = document.getElementById("logoutBtn");

let authMode = "login"; // or "signup"

function showModal(el) { el.style.display = "flex"; }
function hideModal(el) { el.style.display = "none"; }

function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  signupNameField.style.display = mode === "signup" ? "flex" : "none";
  authModalTitle.textContent = mode === "login" ? "تسجيل الدخول" : "حساب جديد";
  authSubmitBtn.textContent = mode === "login" ? "دخول" : "إنشاء الحساب";
  authError.style.display = "none";
}

tabLogin.addEventListener("click", () => setAuthMode("login"));
tabSignup.addEventListener("click", () => setAuthMode("signup"));

loginOpenBtn.addEventListener("click", () => {
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
      await signUp(email, password, authName.value.trim());
    } else {
      await signIn(email, password);
    }
    hideModal(authModal);
    authEmail.value = "";
    authPassword.value = "";
    authName.value = "";
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
    if (profile) leaderboardOptIn.checked = !!profile.show_on_leaderboard;
  } else {
    guestActions.style.display = "flex";
    userActions.style.display = "none";
  }
});

// -------- stats modal --------
statsOpenBtn.addEventListener("click", async () => {
  showModal(statsModal);
  statsBody.innerHTML = '<div class="status">جاري التحميل...</div>';
  const attempts = await fetchStats();
  statsBody.innerHTML = renderStatsHtml(attempts);
});

statsCloseBtn.addEventListener("click", () => hideModal(statsModal));
statsModal.addEventListener("click", (e) => { if (e.target === statsModal) hideModal(statsModal); });

leaderboardOptIn.addEventListener("change", async () => {
  await updateProfile({ show_on_leaderboard: leaderboardOptIn.checked });
});

function renderStatsHtml(attempts) {
  if (!attempts || attempts.length === 0) {
    return '<div class="status">لا توجد بيانات بعد. أجب على بعض الأسئلة وسجّل الدخول لرؤية تقدّمك هنا.</div>';
  }

  const total = attempts.length;
  const correct = attempts.filter((a) => a.is_correct).length;
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
      <div class="stat-caption">${correct} صحيحة من أصل ${total} محاولة</div>
    </div>
    <div class="stat-rows">${rows}</div>
  `;
}

// -------- leaderboard modal --------
leaderboardOpenBtn.addEventListener("click", async () => {
  showModal(leaderboardModal);
  leaderboardBody.innerHTML = '<div class="status">جاري التحميل...</div>';
  const rows = await fetchLeaderboard();
  leaderboardBody.innerHTML = renderLeaderboardHtml(rows);
});

leaderboardCloseBtn.addEventListener("click", () => hideModal(leaderboardModal));
leaderboardModal.addEventListener("click", (e) => { if (e.target === leaderboardModal) hideModal(leaderboardModal); });

function renderLeaderboardHtml(rows) {
  if (!rows || rows.length === 0) {
    return '<div class="status">لا يوجد أحد بعد في لوحة الصدارة. فعّل "إظهار اسمي" من إحصائياتك لتكون أول من ينضم.</div>';
  }
  return rows
    .map(
      (r, i) => `
      <div class="stat-row">
        <div class="stat-row-label">${i + 1}. ${r.display_name}</div>
        <div class="stat-row-value">${r.total_correct}/${r.total_answers} (${r.accuracy_pct}%)</div>
      </div>`
    )
    .join("");
}

// Kick off auth
initAuth();
