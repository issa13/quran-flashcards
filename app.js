const API_BASE = "https://api.alquran.cloud/v1/";
const EDITION = "quran-uthmani";

const QURAN_MIN_PAGE = 1;
const QURAN_MAX_PAGE = 604;

// DOM
const flashcard = document.getElementById("flashcard");
const generateBtn = document.getElementById("generateBtn");
const qText = document.getElementById("qText");
const aText = document.getElementById("aText");
const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressWrap = document.querySelector(".progress-wrap");

const qTypeSelect = document.getElementById("qTypeSelect");
const timerSelect = document.getElementById("timerSelect");
const rangeSelect = document.getElementById("rangeSelect");

const customRangeRow = document.getElementById("customRangeRow");
const customMinEl = document.getElementById("customMin");
const customMaxEl = document.getElementById("customMax");

const btnRight = document.getElementById("btnRight");
const btnWrong = document.getElementById("btnWrong");
const scoreBox = document.getElementById("scoreBox");

const cardHelp = document.getElementById("cardHelp");

// Score
const GUEST_SCORE_KEY = "qf_guest_score";
let total = 0;
let correct = 0;

function loadGuestScore() {
  try {
    const raw = localStorage.getItem(GUEST_SCORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Number.isFinite(saved.total) && Number.isFinite(saved.correct)) {
      total = saved.total;
      correct = saved.correct;
    }
  } catch (e) { /* ignore corrupt storage */ }
}

function saveGuestScore() {
  try {
    localStorage.setItem(GUEST_SCORE_KEY, JSON.stringify({ total, correct }));
  } catch (e) { /* storage unavailable, ignore */ }
}

// Card state
let hasActiveCard = false;
let answeredThisCard = false;

// Current question context (used for syncing attempts to Supabase)
let currentQuestionType = null;
let currentPage = null;
let currentRangeMin = null;
let currentRangeMax = null;

// Active session (signed-in users only) — always the user's last
// (most recently created) session, and the ONLY session new attempts
// get attached to. Browsing other sessions in the stats modal never
// changes this. Exposed to auth-ui.js via the getter/setter below.
//
// activeSessionRangeMin/Max is the page range this session is LOCKED
// to (null until its first answered question). A session may only
// ever be quizzed on one range — see activeSessionHasRangeConflict()
// below — so changing the range mid-session requires a new session
// rather than silently widening this one's stored range.
let activeSessionId = null;
let activeSessionRangeMin = null;
let activeSessionRangeMax = null;
function getActiveSessionId() { return activeSessionId; }
function syncActiveSessionId(id) {
  activeSessionId = id;
  activeSessionRangeMin = null;
  activeSessionRangeMax = null;
}

// True when the given range differs from the range this session is
// already locked to. Guests and brand-new sessions (no locked range
// yet) never conflict.
function activeSessionHasRangeConflict(minP, maxP) {
  if (!currentUser || !activeSessionId) return false;
  if (activeSessionRangeMin == null || activeSessionRangeMax == null) return false;
  return minP !== activeSessionRangeMin || maxP !== activeSessionRangeMax;
}

// Timer state
let timerInterval = null;
let timerStart = 0;
let timerDurationMs = 0;

// Cache
const pageCache = new Map();

function setStatus(msg) { statusEl.textContent = msg || ""; }

function updateScore() {
  scoreBox.textContent = `النتيجة: ${correct} / ${total}`;
  scoreBox.classList.remove("pulse");
  // restart animation
  void scoreBox.offsetWidth;
  scoreBox.classList.add("pulse");
}

// Called whenever a new session is created (see auth-ui.js) so the
// score shown on the panel reflects the fresh session, not carried
// over totals from whatever was played before it.
function resetScore() {
  total = 0;
  correct = 0;
  updateScore();
  saveGuestScore();
}

function setFlipped(flipped) { flashcard.classList.toggle("is-flipped", flipped); }
function isFlipped() { return flashcard.classList.contains("is-flipped"); }

function lockGenerate() { generateBtn.disabled = true; }
function unlockGenerate() { generateBtn.disabled = false; }

function lockMarkButtons() { btnRight.disabled = true; btnWrong.disabled = true; }
function enableMarkButtons() {
  const can = hasActiveCard && !answeredThisCard;
  btnRight.disabled = !can;
  btnWrong.disabled = !can;
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clean(s) { return (s || "").toString().trim(); }

// -------- range select + custom --------
function showHideCustomRange() {
  const { minP, maxP } = getRangeFromSelect();

  if (activeSessionHasRangeConflict(minP, maxP)) {
    const rangeText = `${activeSessionRangeMin}–${activeSessionRangeMax}`;
    setStatus(`لا يمكن الجمع بين نطاقين في نفس الجلسة (النطاق الحالي: ${rangeText}). أنشئ جلسة جديدة من «📊 إحصائياتي» لتستخدم النطاق الجديد.`);
    alert(`هذه الجلسة بدأت بنطاق صفحات مختلف (${rangeText}). لتغيير النطاق يجب إنشاء جلسة جديدة أولاً من «📊 إحصائياتي».`);
    return;
  }
  customRangeRow.style.display = (rangeSelect.value === "custom") ? "flex" : "none";
}
rangeSelect.addEventListener("change", showHideCustomRange);
showHideCustomRange();

function getRangeFromSelect() {
  if (rangeSelect.value === "custom") {
    let minP = parseInt(customMinEl.value, 10);
    let maxP = parseInt(customMaxEl.value, 10);
    if (Number.isNaN(minP)) minP = 1;
    if (Number.isNaN(maxP)) maxP = 604;

    minP = clamp(minP, 1, 604);
    maxP = clamp(maxP, 1, 604);
    if (minP > maxP) [minP, maxP] = [maxP, minP];

    customMinEl.value = minP;
    customMaxEl.value = maxP;
    return { minP, maxP };
  }

  switch (rangeSelect.value) {
    case "first100": return { minP: 1, maxP: 100 };
    case "juz1": return { minP: 1, maxP: 21 };
    case "juz30": return { minP: 582, maxP: 604 };
    case "baqarah": return { minP: 2, maxP: 49 };
    case "imran": return { minP: 50, maxP: 76 };
    case "zahrawain": return { minP: 2, maxP: 76 };
    default: return { minP: 1, maxP: 604 };
  }
}

// -------- timer (no effect on current progress unless Generate) --------
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  progressBar.style.width = "0%";
  progressWrap.classList.remove("low-time");
}

function getTimerSeconds() {
  const sec = parseInt(timerSelect.value, 10);
  return Number.isNaN(sec) ? 0 : sec;
}

function startTimer() {
  const sec = getTimerSeconds();
  if (sec <= 0) {
    stopTimer();
    return;
  }

  stopTimer();
  timerDurationMs = sec * 1000;
  timerStart = Date.now();
  progressBar.style.width = "0%";

  timerInterval = setInterval(() => {
    const elapsed = Date.now() - timerStart;
    const pct = clamp((elapsed / timerDurationMs) * 100, 0, 100);
    progressBar.style.width = pct + "%";
    progressWrap.classList.toggle("low-time", pct >= 70);

    if (elapsed >= timerDurationMs) {
      stopTimer();

      if (!hasActiveCard) return;

      if (!isFlipped()) setFlipped(true);

      lockGenerate();
      enableMarkButtons();
      setStatus("انتهى الوقت — اختر ✅ صحيح أو ❌ خطأ للمتابعة.");
    }
  }, 100);
}

// -------- API with cache --------
async function fetchPageAyahs(page) {
  if (pageCache.has(page)) return pageCache.get(page);

  const res = await fetch(`${API_BASE}page/${page}/${EDITION}`, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP error");
  const json = await res.json();
  const ayahs = json?.data?.ayahs || [];
  pageCache.set(page, ayahs);
  return ayahs;
}

function getSurahName(ayah) {
  const s = ayah?.surah || {};
  return clean(s.name) || "غير معروف";
}

// Shrink text for long ayahs so they fit the card without needing to scroll
function setCardText(el, text) {
  el.textContent = text;
  const len = (text || "").length;
  let size = 19;
  if (len > 260) size = 13;
  else if (len > 200) size = 14;
  else if (len > 150) size = 15;
  else if (len > 100) size = 16;
  else if (len > 60) size = 17;
  el.style.fontSize = size + "px";
}

// -------- descriptions inside card --------
function getTypeDescription(type) {
  switch (type) {
    case "first": return "سيظهر لك آية من نفس الصفحة، والمطلوب أن تتذكر الآية الأولى في هذه الصفحة.";
    case "last": return "سيظهر لك آية من نفس الصفحة، والمطلوب أن تتذكر الآية الأخيرة في هذه الصفحة.";
    case "previous": return "سيظهر لك آية، والمطلوب أن تتذكر الآية التي تسبقها في نفس الصفحة.";
    case "surah": return "سيظهر لك آية، والمطلوب أن تحدد اسم السورة التي تنتمي لها.";
    case "pageNumber": return "سيظهر لك آية، والمطلوب أن تخمّن رقم الصفحة.";
    case "ayahCount": return "السؤال هو أول آية في الصفحة، والمطلوب أن تخمّن عدد آيات الصفحة.";
    case "nextPageFirst": return "السؤال هو أول آية في الصفحة، والجواب هو أول آية في الصفحة التالية.";
    case "prevPageFirst": return "السؤال هو أول آية في الصفحة، والجواب هو أول آية في الصفحة السابقة.";
    default: return "اختر نوع السؤال ثم اضغط سؤال جديد.";
  }
}

function getTypeLabel(type) {
  switch (type) {
    case "first": return "خمن الآية الأولى بالصفحة";
    case "last": return "خمن الآية الأخيرة بالصفحة";
    case "previous": return "خمن الآية السابقة";
    case "surah": return "خمن السورة";
    case "pageNumber": return "خمن رقم الصفحة";
    case "ayahCount": return "خمن كم عدد آيات الصفحة؟";
    case "nextPageFirst": return "خمن أول آية بالصفحة التالية";
    case "prevPageFirst": return "خمن أول آية بالصفحة السابقة";
    default: return "—";
  }
}

// -------- QA builders --------
function pickQAFromPage(ayahs, type, page) {
  if (!ayahs || ayahs.length < 2) return null;

  const first = ayahs[0];
  const last = ayahs[ayahs.length - 1];

  if (type === "first") {
    const candidate = ayahs[randInt(1, ayahs.length - 1)];
    return { q: clean(candidate.text), a: clean(first.text) };
  }

  if (type === "last") {
    const candidate = ayahs[randInt(0, ayahs.length - 2)];
    return { q: clean(candidate.text), a: clean(last.text) };
  }

  if (type === "previous") {
    const idx = randInt(1, ayahs.length - 1);
    return { q: clean(ayahs[idx].text), a: clean(ayahs[idx - 1].text) };
  }

  if (type === "surah") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: getSurahName(candidate) };
  }

  if (type === "pageNumber") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: String(page) };
  }

  if (type === "ayahCount") {
    return { q: clean(first.text), a: String(ayahs.length) };
  }

  return null;
}

async function pickAdjacentPageQA(type, page) {
  const currentAyahs = await fetchPageAyahs(page);
  if (!currentAyahs || currentAyahs.length < 1) return null;

  const q = clean(currentAyahs[0].text);

  if (type === "nextPageFirst") {
    const nextAyahs = await fetchPageAyahs(page + 1);
    if (!nextAyahs || nextAyahs.length < 1) return null;
    return { q, a: clean(nextAyahs[0].text) };
  }

  if (type === "prevPageFirst") {
    const prevAyahs = await fetchPageAyahs(page - 1);
    if (!prevAyahs || prevAyahs.length < 1) return null;
    return { q, a: clean(prevAyahs[0].text) };
  }

  return null;
}

// -------- marking --------
function markAnswer(isCorrect) {
  if (!hasActiveCard || answeredThisCard) return;

  answeredThisCard = true;
  total += 1;
  if (isCorrect) correct += 1;

  updateScore();
  lockMarkButtons();
  unlockGenerate();

  setStatus(isCorrect ? "تم التسجيل: ✅ صحيح" : "تم التسجيل: ❌ خطأ");

  const flashClass = isCorrect ? "flash-correct" : "flash-wrong";
  flashcard.classList.add(flashClass);
  setTimeout(() => flashcard.classList.remove(flashClass), 700);

  saveGuestScore();

  if (typeof recordAttempt === "function" && currentQuestionType) {
    recordAttempt({
      questionType: currentQuestionType,
      page: currentPage,
      isCorrect,
      sessionId: activeSessionId,
      rangeMin: currentRangeMin,
      rangeMax: currentRangeMax,
    }).then((ok) => {
      // First successfully-recorded attempt in a fresh session locks
      // its range going forward (see activeSessionHasRangeConflict()).
      if (ok && activeSessionId && activeSessionRangeMin == null && activeSessionRangeMax == null) {
        activeSessionRangeMin = currentRangeMin;
        activeSessionRangeMax = currentRangeMax;
      }
    }).catch(() => { /* non-fatal: keep app usable offline */ });
  }
}

btnRight.addEventListener("click", (e) => {
  e.stopPropagation();
  markAnswer(true);
});

btnWrong.addEventListener("click", (e) => {
  e.stopPropagation();
  markAnswer(false);
});

// -------- flip handling --------
function handleFlip() {
  if (!hasActiveCard) return;

  flashcard.classList.toggle("is-flipped");

  if (isFlipped()) {
    stopTimer();
    lockGenerate();
    enableMarkButtons();
    setStatus('اختر ✅/❌ لفتح زر "سؤال جديد".');
  }
}

flashcard.addEventListener("click", handleFlip);
flashcard.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    handleFlip();
  }
});

// -------- generate --------
async function generateCard() {
  try {
    const type = qTypeSelect.value;
    const label = getTypeLabel(type);

    const { minP, maxP } = getRangeFromSelect();
    
    if (activeSessionHasRangeConflict(minP, maxP)) {
      const rangeText = `${activeSessionRangeMin}–${activeSessionRangeMax}`;
      setStatus(`لا يمكن الجمع بين نطاقين في نفس الجلسة (النطاق الحالي: ${rangeText}). أنشئ جلسة جديدة من «📊 إحصائياتي» لتستخدم النطاق الجديد.`);
      alert(`هذه الجلسة بدأت بنطاق صفحات مختلف (${rangeText}). لتغيير النطاق يجب إنشاء جلسة جديدة أولاً من «📊 إحصائياتي».`);
      return;
    }
    // show description inside card (front)
    cardHelp.textContent = `النوع: ${label} — ${getTypeDescription(type)}`;

    let page = randInt(minP, maxP);

    // boundary safety for adjacent types
    if (type === "nextPageFirst") page = clamp(page, QURAN_MIN_PAGE, QURAN_MAX_PAGE - 1);
    if (type === "prevPageFirst") page = clamp(page, QURAN_MIN_PAGE + 1, QURAN_MAX_PAGE);

    setStatus("جاري التحميل...");
    lockGenerate();

    // reset
    stopTimer();
    setFlipped(false);
    lockMarkButtons();
    answeredThisCard = false;
    hasActiveCard = false;

    let qa = null;

    if (type === "nextPageFirst" || type === "prevPageFirst") {
      qa = await pickAdjacentPageQA(type, page);
    } else {
      const ayahs = await fetchPageAyahs(page);
      qa = pickQAFromPage(ayahs, type, page);
    }

    if (!qa || !qa.q || !qa.a) {
      setCardText(qText, "تعذر إنشاء سؤال. حاول مرة أخرى.");
      setCardText(aText, "—");
      setStatus("حصلت مشكلة. جرّب مرة ثانية.");
      unlockGenerate();
      return;
    }

    setCardText(qText, qa.q);
    setCardText(aText, qa.a);

    currentQuestionType = type;
    currentPage = page;
    currentRangeMin = minP;
    currentRangeMax = maxP;

    hasActiveCard = true;
    answeredThisCard = false;

    const sec = getTimerSeconds();
    const timerText = (sec <= 0) ? "بدون مؤقت" : `${sec} ثانية`;

    setStatus(`جاهز. النوع: ${label} | المؤقت: ${timerText}`);
    unlockGenerate();

    startTimer();
  } catch (err) {
    setCardText(qText, "خطأ في الشبكة أو في الـ API.");
    setCardText(aText, "—");
    setStatus("فشل التحميل. تأكد من الإنترنت وحاول مجددًا.");
    unlockGenerate();
  }
}

generateBtn.addEventListener("click", generateCard);

// Init
loadGuestScore();
updateScore();
lockMarkButtons();
setStatus("");
qText.textContent = "—";
aText.textContent = "—";

// Update help text when changing question type (without generating)
qTypeSelect.addEventListener("change", () => {
  const type = qTypeSelect.value;
  const label = getTypeLabel(type);
  cardHelp.textContent = `النوع: ${label} — ${getTypeDescription(type)}`;
});

// -------- settings sync (signed-in users only) --------
let settingsSyncReady = false; // avoid feedback loop while applying remote settings

function currentSettingsPayload() {
  return {
    question_type: qTypeSelect.value,
    timer_seconds: getTimerSeconds(),
    range_key: rangeSelect.value,
    custom_min: parseInt(customMinEl.value, 10) || 1,
    custom_max: parseInt(customMaxEl.value, 10) || 604,
  };
}

function applyRemoteSettings(settings) {
  if (!settings) return;
  settingsSyncReady = false;
  if (settings.question_type) qTypeSelect.value = settings.question_type;
  if (settings.timer_seconds != null) timerSelect.value = String(settings.timer_seconds);
  if (settings.range_key) rangeSelect.value = settings.range_key;
  if (settings.custom_min != null) customMinEl.value = settings.custom_min;
  if (settings.custom_max != null) customMaxEl.value = settings.custom_max;
  showHideCustomRange();
  settingsSyncReady = true;
}

[qTypeSelect, timerSelect, rangeSelect, customMinEl, customMaxEl].forEach((el) => {
  el.addEventListener("change", () => {
    if (!settingsSyncReady) return;
    if (typeof saveRemoteSettings === "function") {
      saveRemoteSettings(currentSettingsPayload()).catch(() => {});
    }
  });
});

if (typeof onAuthChange === "function") {
  onAuthChange(async (user) => {
    if (user && typeof loadRemoteSettings === "function") {
      const remote = await loadRemoteSettings();
      if (remote) {
        applyRemoteSettings(remote);
      } else {
        settingsSyncReady = true;
        saveRemoteSettings(currentSettingsPayload()).catch(() => {});
      }
    } else {
      settingsSyncReady = true;
    }
  });

  onAuthChange(async (user) => {
    if (user && typeof ensureActiveSession === "function") {
      const active = await ensureActiveSession();
      activeSessionId = active?.id ?? null;
      activeSessionRangeMin = active?.rangeMin ?? null;
      activeSessionRangeMax = active?.rangeMax ?? null;
    } else {
      activeSessionId = null;
      activeSessionRangeMin = null;
      activeSessionRangeMax = null;
    }
  });
} else {
  settingsSyncReady = true;
}
