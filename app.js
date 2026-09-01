const API_BASE = "https://api.alquran.cloud/v1/";
const EDITION = "quran-uthmani";

const QURAN_MIN_PAGE = 1;
const QURAN_MAX_PAGE = 604;

// Standard Madinah Mushaf juz start pages (juz N starts at
// JUZ_START_PAGE[N-1] and runs up to the page before the next juz's
// start, or to 604 for juz 30). Used to compute which juz numbers a
// page range actually covers — no API call needed since this is a
// fixed, well-known mapping.
const JUZ_START_PAGE = [
  1, 22, 42, 62, 82, 102, 121, 142, 162, 182,
  201, 222, 242, 262, 282, 302, 322, 342, 362, 382,
  402, 422, 442, 462, 482, 502, 522, 542, 562, 582,
];

// Below this many valid answers, a question type is hidden from the
// dropdown (and generation is blocked as a safety net). Applies to
// "pageNumber", "surah", and "juz" — the three types whose whole
// point is telling several distinct values apart.
const MIN_MCQ_ANSWERS = 5;

function juzForPage(page) {
  let juz = 1;
  for (let i = 0; i < JUZ_START_PAGE.length; i++) {
    if (page >= JUZ_START_PAGE[i]) juz = i + 1;
    else break;
  }
  return juz;
}

function juzsInRange(minP, maxP) {
  const start = juzForPage(minP);
  const end = juzForPage(maxP);
  const list = [];
  for (let j = start; j <= end; j++) list.push(j);
  return list;
}

// DOM
const flashcard = document.getElementById("flashcard");
const generateBtn = document.getElementById("generateBtn");
const qText = document.getElementById("qText");
const mcqChoicesEl = document.getElementById("mcqChoices");
const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressWrap = document.querySelector(".progress-wrap");

const qTypeSelect = document.getElementById("qTypeSelect");
const timerSelect = document.getElementById("timerSelect");

// Guest-only range picker (signed-in users' range comes from their
// active session instead — see sessionRangeRow/sessionRangeDisplay).
const guestRangeRow = document.getElementById("guestRangeRow");
const rangeSelect = document.getElementById("rangeSelect");
const customRangeRow = document.getElementById("customRangeRow");
const customMinEl = document.getElementById("customMin");
const customMaxEl = document.getElementById("customMax");

const topbarSessionName = document.getElementById("topbarSessionName");

// Signed-in-only fixed range display
const sessionRangeRow = document.getElementById("sessionRangeRow");
const sessionRangeDisplay = document.getElementById("sessionRangeDisplay");

const mistakeReviewRow = document.getElementById("mistakeReviewRow");
const mistakeReviewToggle = document.getElementById("mistakeReviewToggle");
const mistakeReviewHint = document.getElementById("mistakeReviewHint");

const scoreBox = document.getElementById("scoreBox");
const comboBox = document.getElementById("comboBox");
const cardHelp = document.getElementById("cardHelp");
const playAudioBtn = document.getElementById("playAudioBtn");

// -------- MCQ config --------
const MCQ_CHOICE_COUNT = 6;

// Client-side mirror of the achievements catalog in supabase-schema.sql
// (icon + title only) so a toast can be shown immediately without an
// extra round trip. Keep in sync with that file's insert statement.
const ACHIEVEMENT_INFO = {
  first_correct: { icon: "🌱", title: "أول إجابة صحيحة" },
  correct_100: { icon: "💯", title: "100 إجابة صحيحة" },
  correct_500: { icon: "🥉", title: "500 إجابة صحيحة" },
  correct_1000: { icon: "🥇", title: "1000 إجابة صحيحة" },
  streak_10: { icon: "🔥", title: "سلسلة 10 متتالية" },
  streak_25: { icon: "⚡", title: "سلسلة 25 متتالية" },
  perfect_session: { icon: "🏆", title: "جلسة مثالية" },
  wide_coverage_500: { icon: "🗺️", title: "مسافر في القرآن" },
  streak_days_3: { icon: "📅", title: "نشاط 3 أيام متتالية" },
  streak_days_7: { icon: "🗓️", title: "أسبوع كامل" },
  streak_days_30: { icon: "🌙", title: "شهر كامل" },
};

// -------- levels (lifetime, account-wide) --------
// level = floor(sqrt(xp / 25)) + 1 → 25 XP for lvl 2, 100 for lvl 3,
// 225 for lvl 4, 400 for lvl 5 ... (10 XP per correct answer)
function levelFromXp(xp) {
  const n = Math.max(0, xp || 0);
  return Math.floor(Math.sqrt(n / 25)) + 1;
}
function xpForLevel(level) {
  return Math.pow(Math.max(1, level) - 1, 2) * 25;
}

// Cosmetic rank name shown alongside the level number (topbar badge,
// achievements view, leaderboard). Purely client-side — derived from
// the same level number everything else already uses, so it never
// needs its own XP thresholds to stay in sync.
const LEVEL_TITLES = [
  { min: 1, title: "مبتدئ" },
  { min: 2, title: "طالب علم" },
  { min: 5, title: "مثابر" },
  { min: 8, title: "حافظ صغير" },
  { min: 12, title: "متقن" },
  { min: 17, title: "بارع" },
  { min: 23, title: "خبير المراجعة" },
  { min: 31, title: "أستاذ" },
  { min: 41, title: "أسطورة الحفظ" },
];
function levelTitle(level) {
  let title = LEVEL_TITLES[0].title;
  for (const tier of LEVEL_TITLES) {
    if (level >= tier.min) title = tier.title;
  }
  return title;
}

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
let currentCorrectIndex = -1;

// -------- combo / fire indicator --------
// Purely a client-side, in-browser-session counter — consecutive
// correct answers *right now*, reset by any wrong answer or a page
// reload. Distinct from user_stats.current_streak in the DB (which is
// lifetime and drives the streak_10/streak_25 badges) — this one is
// just for the live "you're on fire" feedback while playing, so it
// works identically for guests and signed-in users.
let sessionCombo = 0;

function updateComboBox() {
  if (sessionCombo < 3) {
    comboBox.style.display = "none";
    return;
  }
  const flames = sessionCombo >= 15 ? "🔥🔥🔥" : sessionCombo >= 8 ? "🔥🔥" : "🔥";
  comboBox.textContent = `${flames} سلسلة ${sessionCombo}`;
  comboBox.style.display = "inline-flex";
  comboBox.classList.remove("pulse");
  void comboBox.offsetWidth;
  comboBox.classList.add("pulse");
}

// Small floating "+N XP" popup near the score box, shown when a
// signed-in user's answer earns XP (base 10 × the daily-streak
// multiplier, plus a combo bonus every 5th correct in a row — see
// record_attempt() in supabase-schema.sql).
function showXpPopup(amount) {
  if (!amount) return;
  const el = document.createElement("div");
  el.className = "xp-popup";
  el.textContent = `+${amount} XP`;
  scoreBox.insertAdjacentElement("afterend", el);
  requestAnimationFrame(() => el.classList.add("rise"));
  setTimeout(() => el.remove(), 1100);
}

// Current question context (used for syncing attempts to Supabase)
let currentQuestionType = null;
let currentPage = null;
let currentRangeMin = null;
let currentRangeMax = null;
let currentQAyahNumber = null;
let currentAudioEl = null;

// Active session (signed-in users only) — always the user's last
// (most recently created) session, and the ONLY session new attempts
// get attached to. Browsing other sessions in the stats modal never
// changes this.
//
// activeSessionRangeMin/Max is the page range this session was
// created with — chosen once, in the "create session" modal, and
// permanent from then on (enforced by a DB trigger too — see
// supabase-schema.sql). Exposed to auth-ui.js via the getter/setter
// below.
let activeSessionId = null;
let activeSessionRangeMin = null;
let activeSessionRangeMax = null;
let activeSessionTitle = null;
function getActiveSessionId() { return activeSessionId; }
function syncActiveSessionId(id, rangeMin, rangeMax, title) {
  activeSessionId = id;
  activeSessionRangeMin = rangeMin ?? null;
  activeSessionRangeMax = rangeMax ?? null;
  activeSessionTitle = title ?? null;
  setTopbarSessionName(activeSessionTitle);
  resetMistakeReview();
}

// Called whenever the active session's own title changes (renaming it
// from the stats modal) so the topbar reflects it immediately.
function setActiveSessionTitleIfMatches(sessionId, title) {
  if (sessionId !== activeSessionId) return;
  activeSessionTitle = title;
  setTopbarSessionName(title);
}

// Mistake-review mode (signed-in users only) — when active, new
// questions draw their page only from mistakeReviewPages (the pages
// with a wrong answer in the CURRENT session) instead of the full
// session range. Distractors still use the full range (see
// buildChoices()), so answer quality doesn't degrade. Resets whenever
// the active session changes (see syncActiveSessionId() above).
let mistakeReviewActive = false;
let mistakeReviewPages = [];

function resetMistakeReview() {
  mistakeReviewActive = false;
  mistakeReviewPages = [];
  mistakeReviewToggle.checked = false;
  mistakeReviewRow.classList.remove("active");
  mistakeReviewHint.textContent = "سيتم اختيار الأسئلة من الصفحات التي أخطأت فيها فقط، وتُزال الصفحة تلقائيًا بعد إتقانها.";
}

// Which of the given pages are actually usable for this question
// type — the adjacent-page types need room on the correct side (same
// boundary safety as generateCard()'s normal page selection).
function filterPagesForType(pages, type, minP, maxP) {
  if (type === "nextPageFirst" || type === "pageEndToNextFirst") return pages.filter((p) => p < maxP);
  if (type === "prevPageFirst" || type === "pageStartToPrevLast") return pages.filter((p) => p > minP);
  return pages;
}

// Timer state
let timerInterval = null;
let timerStart = 0;
let timerDurationMs = 0;

// Caches
const pageCache = new Map();
let surahCatalogPromise = null;

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
  sessionCombo = 0;
  updateComboBox();
  updateScore();
  saveGuestScore();
}

function lockGenerate() { generateBtn.disabled = true; }
function unlockGenerate() { generateBtn.disabled = false; }

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clean(s) { return (s || "").toString().trim(); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// -------- achievement toast --------
function showAchievementToast(info) {
  const el = document.createElement("div");
  el.className = "achievement-toast";
  el.innerHTML =
    `<span class="achievement-toast-icon">${info.icon || "🏅"}</span>` +
    `<div><div class="achievement-toast-title">إنجاز جديد!</div>` +
    `<div class="achievement-toast-name">${(info.title || "").toString()}</div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function showAchievementToasts(codes) {
  (codes || []).forEach((code, i) => {
    const info = ACHIEVEMENT_INFO[code] || { icon: "🏅", title: "إنجاز جديد" };
    setTimeout(() => showAchievementToast(info), i * 450);
  });
}

// -------- range resolution --------
// Pure mapping from a range key (+ custom bounds) to {minP, maxP}.
// Shared between the guest picker in the main panel and the "create
// session" modal's own picker (see auth-ui.js).
function resolveRangeBounds(rangeKey, customMinRaw, customMaxRaw) {
  if (rangeKey === "custom") {
    let minP = parseInt(customMinRaw, 10);
    let maxP = parseInt(customMaxRaw, 10);
    if (Number.isNaN(minP)) minP = 1;
    if (Number.isNaN(maxP)) maxP = 604;

    minP = clamp(minP, 1, 604);
    maxP = clamp(maxP, 1, 604);
    if (minP > maxP) [minP, maxP] = [maxP, minP];

    return { minP, maxP };
  }

  switch (rangeKey) {
    case "first100": return { minP: 1, maxP: 100 };
    case "sabatawal": return { minP: 2, maxP: 207 };
    case "juz1": return { minP: 1, maxP: 21 };
    case "juz27": return { minP: 522, maxP: 541 };
    case "juz28": return { minP: 542, maxP: 561 };
    case "juz29": return { minP: 562, maxP: 581 };
    case "juz30": return { minP: 582, maxP: 604 };
    case "baqarah": return { minP: 2, maxP: 49 };
    case "imran": return { minP: 50, maxP: 76 };
    case "nisa": return { minP: 77, maxP: 106 };
    case "maidah": return { minP: 106, maxP: 127 };
    case "anam": return { minP: 128, maxP: 150 };
    case "anfal": return { minP: 177, maxP: 186 };
    case "tawbah": return { minP: 187, maxP: 207 };
    case "zahrawain": return { minP: 2, maxP: 76 };
    default: return { minP: 1, maxP: 604 };
  }
}

function showHideCustomRange() {
  customRangeRow.style.display = (rangeSelect.value === "custom") ? "flex" : "none";
}
rangeSelect.addEventListener("change", showHideCustomRange);
showHideCustomRange();

function getGuestRangeFromSelect() {
  const bounds = resolveRangeBounds(rangeSelect.value, customMinEl.value, customMaxEl.value);
  if (rangeSelect.value === "custom") {
    customMinEl.value = bounds.minP;
    customMaxEl.value = bounds.maxP;
  }
  return bounds;
}

// The range actually in effect right now: the active session's fixed
// range when signed in (null if that session somehow has none — an
// old session from before ranges were required), or the guest
// picker's current value otherwise.
function getActiveRange() {
  if (currentUser) {
    if (activeSessionId && activeSessionRangeMin != null && activeSessionRangeMax != null) {
      return { minP: activeSessionRangeMin, maxP: activeSessionRangeMax };
    }
    return null;
  }
  return getGuestRangeFromSelect();
}

function setActiveRangeDisplay(minP, maxP) {
  sessionRangeDisplay.textContent = (minP != null && maxP != null) ? `${minP}–${maxP}` : "—";
}

function setTopbarSessionName(title) {
  topbarSessionName.textContent = title || "";
}

function showGuestRangeUI() {
  guestRangeRow.style.display = "flex";
  showHideCustomRange();
  sessionRangeRow.style.display = "none";
  mistakeReviewRow.style.display = "none";
  resetMistakeReview();
  setTopbarSessionName("");
}

function showSessionRangeUI(minP, maxP) {
  guestRangeRow.style.display = "none";
  customRangeRow.style.display = "none";
  sessionRangeRow.style.display = "flex";
  mistakeReviewRow.style.display = "flex";
  setActiveRangeDisplay(minP, maxP);
}

// -------- generation gating --------
const ADJACENT_TYPES = new Set(["nextPageFirst", "prevPageFirst", "pageEndToNextFirst", "pageStartToPrevLast"]);

function rangeTooNarrowMessage(typeLabel, count, singularUnit, pluralUnit) {
  const countText = count === 1 ? `${singularUnit} واحدة فقط` : `${count} ${pluralUnit} فقط`;
  return `النطاق المحدد يغطي ${countText}، ويلزم ${MIN_MCQ_ANSWERS} على الأقل لإنشاء سؤال "${typeLabel}". وسّع نطاق الصفحات أو اختر نوع سؤال آخر.`;
}

// Central "can we generate a question of this type, in this range,
// right now?" check. Returns a message to show when blocked, or null
// when it's fine to proceed.
async function checkGenerationBlock(type, minP, maxP) {
  if (ADJACENT_TYPES.has(type) && maxP <= minP) {
    return "يلزم نطاق يشمل أكثر من صفحة واحدة لإنشاء هذا النوع من الأسئلة. وسّع نطاق الصفحات أو اختر نوع سؤال آخر.";
  }

  if (mistakeReviewActive) {
    const pages = filterPagesForType(mistakeReviewPages, type, minP, maxP);
    if (pages.length === 0) {
      return "لا توجد صفحات أخطاء مناسبة لهذا النوع من الأسئلة ضمن وضع المراجعة. جرّب نوعًا آخر أو أوقف وضع المراجعة.";
    }
  }

  if (type === "juz") {
    const available = juzsInRange(minP, maxP);
    if (available.length < MIN_MCQ_ANSWERS) {
      return rangeTooNarrowMessage("خمن الجزء", available.length, "جزء", "أجزاء");
    }
  }

  if (type === "pageNumber") {
    const available = maxP - minP + 1;
    if (available < MIN_MCQ_ANSWERS) {
      return rangeTooNarrowMessage("خمن رقم الصفحة", available, "صفحة", "صفحات");
    }
  }

  if (type === "surah") {
    const available = await surahsInRange(minP, maxP);
    if (available.length < MIN_MCQ_ANSWERS) {
      return rangeTooNarrowMessage("خمن السورة", available.length, "سورة", "سور");
    }
  }

  return null;
}

// Wraps range resolution + checkGenerationBlock() together — the one
// function both generateCard() and the reactive UI checks need.
async function getBlockMessageForCurrentState(type) {
  const range = getActiveRange();
  if (!range) {
    if (currentUser) {
      return "هذه الجلسة ليس لها نطاق صفحات محدد. أنشئ جلسة جديدة من «📊 إحصائياتي» ← «+ جلسة جديدة» للمتابعة.";
    }
    return "الرجاء اختيار نطاق صفحات صالح.";
  }
  return await checkGenerationBlock(type, range.minP, range.maxP);
}

// Reflects getBlockMessageForCurrentState() in the UI immediately on
// every relevant change, not just when generating fails.
async function refreshGenerationAvailability() {
  const type = qTypeSelect.value;
  const msg = await getBlockMessageForCurrentState(type);

  if (msg) {
    generateBtn.disabled = true;
    setStatus(msg);
  } else if (!hasActiveCard) {
    generateBtn.disabled = false;
    setStatus("");
  }
}

function setOptionAvailability(value, available) {
  const opt = qTypeSelect.querySelector(`option[value="${value}"]`);
  if (!opt) return;
  opt.disabled = !available;
  opt.hidden = !available;
}

// Hides/disables question-type options that can't produce enough
// valid answers in the current range (pageNumber/surah/juz need
// MIN_MCQ_ANSWERS distinct values; the adjacent-page types need more
// than one page). Falls back the selection to "first" if the
// currently-chosen type just became unavailable.
async function refreshQuestionTypeAvailability() {
  const range = getActiveRange();
  if (!range) {
    await refreshGenerationAvailability();
    return;
  }
  const { minP, maxP } = range;

  const pageCount = maxP - minP + 1;
  const juzCount = juzsInRange(minP, maxP).length;
  let surahCount = 0;
  try {
    surahCount = (await surahsInRange(minP, maxP)).length;
  } catch (e) { /* leave at 0 → hides the option safely */ }

  setOptionAvailability("pageNumber", pageCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("surah", surahCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("juz", juzCount >= MIN_MCQ_ANSWERS);

  const multiPage = maxP > minP;
  ADJACENT_TYPES.forEach((t) => setOptionAvailability(t, multiPage));

  const selectedOption = qTypeSelect.querySelector(`option[value="${qTypeSelect.value}"]`);
  if (selectedOption && selectedOption.disabled) {
    qTypeSelect.value = "first";
    cardHelp.textContent = `النوع: ${getTypeLabel("first")} — ${getTypeDescription("first")}`;
  }

  await refreshGenerationAvailability();
}

// -------- timer --------
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

      if (!hasActiveCard || answeredThisCard) return;

      lockGenerate();
      revealChoices(-1); // -1 = no selection made, just reveal the correct one
      setStatus("⏱️ انتهى الوقت.");
      finishQuestion(false);
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

// Fetches the full 114-surah list once (number + name), cached
// forever — used to translate a surah-number range into real names
// without ever hardcoding page boundaries (which would risk being
// wrong for Quranic content).
function fetchSurahCatalog() {
  if (surahCatalogPromise) return surahCatalogPromise;
  surahCatalogPromise = fetch(`${API_BASE}surah`, { cache: "no-store" })
    .then((res) => { if (!res.ok) throw new Error("HTTP error"); return res.json(); })
    .then((json) => json?.data || [])
    .catch((e) => { surahCatalogPromise = null; throw e; });
  return surahCatalogPromise;
}

// Exact list of surah names whose pages overlap [minP, maxP]. Surahs
// never interleave (surah numbers only increase with page number), so
// the surah at minP's first ayah and the surah at maxP's last ayah
// bound the whole set — everything in between the two numbers is
// covered too.
async function surahsInRange(minP, maxP) {
  try {
    const [minAyahs, maxAyahs, catalog] = await Promise.all([
      fetchPageAyahs(minP),
      fetchPageAyahs(maxP),
      fetchSurahCatalog(),
    ]);
    const lowSurah = minAyahs?.[0]?.surah?.number;
    const highSurah = maxAyahs?.[maxAyahs.length - 1]?.surah?.number;
    if (lowSurah == null || highSurah == null || !catalog.length) return [];

    const list = [];
    for (let n = lowSurah; n <= highSurah; n++) {
      const entry = catalog.find((s) => s.number === n);
      if (entry) list.push(clean(entry.name));
    }
    return list;
  } catch (e) {
    return [];
  }
}

function getSurahName(ayah) {
  const s = ayah?.surah || {};
  return clean(s.name) || "غير معروف";
}

// -------- recitation audio --------
// Looked up on demand (only when the person taps "استماع"), via the
// ayah's global number (1–6236) — asking the API for the URL rather
// than guessing a CDN path keeps this correct without hardcoding
// anything about Quranic content.
async function fetchAyahAudioUrl(globalAyahNumber) {
  const res = await fetch(`${API_BASE}ayah/${globalAyahNumber}/ar.alafasy`, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP error");
  const json = await res.json();
  return json?.data?.audio || json?.data?.audioSecondary?.[0] || null;
}

function stopAudio() {
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl.currentTime = 0;
    currentAudioEl = null;
  }
  playAudioBtn.textContent = "🔊 استماع";
  playAudioBtn.classList.remove("playing");
}

function hideAudioButton() {
  stopAudio();
  playAudioBtn.style.display = "none";
}

function showAudioButtonFor(qAyahNumber) {
  stopAudio();
  if (qAyahNumber) {
    playAudioBtn.style.display = "inline-flex";
  } else {
    playAudioBtn.style.display = "none";
  }
}

playAudioBtn.addEventListener("click", async () => {
  if (currentAudioEl && !currentAudioEl.paused) {
    stopAudio();
    return;
  }
  if (!currentQAyahNumber) return;

  playAudioBtn.disabled = true;
  playAudioBtn.textContent = "⏳ جارٍ التحميل...";
  try {
    const url = await fetchAyahAudioUrl(currentQAyahNumber);
    if (!url) throw new Error("no audio url");
    currentAudioEl = new Audio(url);
    currentAudioEl.addEventListener("ended", stopAudio);
    await currentAudioEl.play();
    playAudioBtn.textContent = "⏸️ إيقاف";
    playAudioBtn.classList.add("playing");
    unlockChoicesAfterListening();
  } catch (e) {
    stopAudio();
    setStatus("تعذّر تشغيل الصوت. حاول مرة أخرى.");
  } finally {
    playAudioBtn.disabled = false;
  }
});

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

function choiceFontSize(text) {
  const len = (text || "").length;
  if (len > 200) return "12px";
  if (len > 140) return "13px";
  if (len > 90) return "14px";
  return "15px";
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
    case "pageEndToNextFirst": return "السؤال هو آخر آية في الصفحة، والجواب هو أول آية في الصفحة التالية.";
    case "pageStartToPrevLast": return "السؤال هو أول آية في الصفحة، والجواب هو آخر آية في الصفحة السابقة.";
    case "juz": return "سيظهر لك آية، والمطلوب أن تحدد رقم الجزء الذي تنتمي إليه.";
    case "ayahNumber": return "سيظهر لك آية، والمطلوب أن تخمّن رقمها داخل سورتها.";
    case "listenNext": return "استمع إلى تلاوة الآية (لن يظهر نصها)، ثم اختر الآية التي تليها مباشرة في نفس الصفحة. لن تتمكن من الإجابة قبل الاستماع.";
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
    case "pageEndToNextFirst": return "من آخر آية: خمن أول آية بالصفحة التالية";
    case "pageStartToPrevLast": return "من أول آية: خمن آخر آية بالصفحة السابقة";
    case "juz": return "خمن الجزء";
    case "ayahNumber": return "خمن رقم الآية بالسورة";
    case "listenNext": return "🎧 استمع ثم خمن الآية التالية";
    default: return "—";
  }
}

// -------- QA builders --------
// Every builder returns { q, a, kind, qAyahNumber } (or null on
// failure). `kind` tells buildChoices() which distractor strategy to
// use:
//   "text"   → other ayah texts (first/last/previous/adjacent types)
//   "surah"  → other surah names (from surahsInRange)
//   "pageNumber" / "juz" → other values from the same range
//   "ayahCount" / "ayahNumber" → nearby numbers
// `qAyahNumber` is the GLOBAL ayah number (1–6236) of whichever ayah
// the question text (`q`) came from — used to fetch its recitation
// audio on demand (see fetchAyahAudioUrl()).
function pickQAFromPage(ayahs, type, page) {
  if (!ayahs || ayahs.length < 2) return null;

  const first = ayahs[0];
  const last = ayahs[ayahs.length - 1];

  if (type === "first") {
    const candidate = ayahs[randInt(1, ayahs.length - 1)];
    return { q: clean(candidate.text), a: clean(first.text), kind: "text", qAyahNumber: candidate.number };
  }

  if (type === "last") {
    const candidate = ayahs[randInt(0, ayahs.length - 2)];
    return { q: clean(candidate.text), a: clean(last.text), kind: "text", qAyahNumber: candidate.number };
  }

  if (type === "previous") {
    const idx = randInt(1, ayahs.length - 1);
    return { q: clean(ayahs[idx].text), a: clean(ayahs[idx - 1].text), kind: "text", qAyahNumber: ayahs[idx].number };
  }

  if (type === "surah") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: getSurahName(candidate), kind: "surah", qAyahNumber: candidate.number };
  }

  if (type === "pageNumber") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: String(page), kind: "pageNumber", qAyahNumber: candidate.number };
  }

  if (type === "ayahCount") {
    return { q: clean(first.text), a: String(ayahs.length), kind: "ayahCount", qAyahNumber: first.number };
  }

  if (type === "juz") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    const juz = candidate.juz;
    if (juz == null) return null;
    return { q: clean(candidate.text), a: String(juz), kind: "juz", qAyahNumber: candidate.number };
  }

  if (type === "ayahNumber") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    const num = candidate.numberInSurah;
    if (num == null) return null;
    return { q: clean(candidate.text), a: String(num), kind: "ayahNumber", qAyahNumber: candidate.number };
  }

  if (type === "listenNext") {
    // q is deliberately left empty — this type is audio-only, the
    // ayah's text must never be shown (see generateCard()'s handling
    // of qa.audioOnly). Only the answer (the next ayah) is text.
    const idx = randInt(0, ayahs.length - 2);
    const qAyah = ayahs[idx];
    const aAyah = ayahs[idx + 1];
    return { q: "", a: clean(aAyah.text), kind: "text", qAyahNumber: qAyah.number, audioOnly: true };
  }

  return null;
}

// page is guaranteed (by generateCard()) to leave room for the
// adjacent page within the selected range — nextPageFirst/
// pageEndToNextFirst never see page === the range's last page, and
// prevPageFirst/pageStartToPrevLast never see page === the range's
// first page — so these never reach outside the selected range.
async function pickAdjacentPageQA(type, page) {
  const currentAyahs = await fetchPageAyahs(page);
  if (!currentAyahs || currentAyahs.length < 1) return null;

  if (type === "nextPageFirst") {
    const qAyah = currentAyahs[0];
    const nextAyahs = await fetchPageAyahs(page + 1);
    if (!nextAyahs || nextAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(nextAyahs[0].text), kind: "text", qAyahNumber: qAyah.number };
  }

  if (type === "prevPageFirst") {
    const qAyah = currentAyahs[0];
    const prevAyahs = await fetchPageAyahs(page - 1);
    if (!prevAyahs || prevAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(prevAyahs[0].text), kind: "text", qAyahNumber: qAyah.number };
  }

  if (type === "pageEndToNextFirst") {
    const qAyah = currentAyahs[currentAyahs.length - 1];
    const nextAyahs = await fetchPageAyahs(page + 1);
    if (!nextAyahs || nextAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(nextAyahs[0].text), kind: "text", qAyahNumber: qAyah.number };
  }

  if (type === "pageStartToPrevLast") {
    const qAyah = currentAyahs[0];
    const prevAyahs = await fetchPageAyahs(page - 1);
    if (!prevAyahs || prevAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(prevAyahs[prevAyahs.length - 1].text), kind: "text", qAyahNumber: qAyah.number };
  }

  return null;
}

// -------- distractor generation --------
async function collectTextCandidates(excludeSet, low, high, count) {
  const results = [];
  const seen = new Set(excludeSet);
  let guard = 0;
  while (results.length < count && guard < count * 12) {
    guard++;
    const p = randInt(low, high);
    try {
      const ayahs = await fetchPageAyahs(p);
      if (!ayahs || !ayahs.length) continue;
      const candidate = clean(ayahs[randInt(0, ayahs.length - 1)].text);
      if (candidate && !seen.has(candidate)) {
        seen.add(candidate);
        results.push(candidate);
      }
    } catch (e) { /* skip failed page fetch */ }
  }
  return results;
}

async function pickTextDistractors(excludeSet, minP, maxP, count) {
  let results = await collectTextCandidates(excludeSet, minP, maxP, count);
  if (results.length < count) {
    // The configured range didn't have enough variety — widen to the
    // full Quran rather than return a too-small MCQ.
    const more = await collectTextCandidates(new Set([...excludeSet, ...results]), 1, 604, count - results.length);
    results = results.concat(more);
  }
  return results;
}

function pickNearbyNumberDistractors(correctNum, count, spread) {
  const pool = new Set();
  let widen = spread;
  let guard = 0;
  while (pool.size < count && widen < 200) {
    guard++;
    const offset = randInt(-widen, widen);
    const n = correctNum + offset;
    if (n >= 1 && n !== correctNum) pool.add(n);
    if (guard % (count * 10) === 0) widen += spread; // widen the net if we're struggling
  }
  return Array.from(pool).slice(0, count).map(String);
}

async function buildChoices(qa, minP, maxP) {
  const correct = qa.a;
  const want = MCQ_CHOICE_COUNT - 1;
  let distractors = [];

  if (qa.kind === "surah") {
    // Strictly from within the selected range — generateCard() already
    // refuses to reach here with fewer than MIN_MCQ_ANSWERS available.
    const available = await surahsInRange(minP, maxP);
    const pool = shuffle(available.filter((n) => n !== correct));
    const surahWant = Math.min(MCQ_CHOICE_COUNT, available.length) - 1;
    distractors = pool.slice(0, surahWant);
  } else if (qa.kind === "pageNumber") {
    const correctNum = parseInt(correct, 10);
    const pool = [];
    for (let p = minP; p <= maxP; p++) if (p !== correctNum) pool.push(p);
    const pageWant = Math.min(MCQ_CHOICE_COUNT, maxP - minP + 1) - 1;
    distractors = shuffle(pool).slice(0, pageWant).map(String);
  } else if (qa.kind === "juz") {
    const available = juzsInRange(minP, maxP);
    const correctNum = parseInt(correct, 10);
    const pool = shuffle(available.filter((j) => j !== correctNum));
    const juzWant = Math.min(MCQ_CHOICE_COUNT, available.length) - 1;
    distractors = pool.slice(0, juzWant).map(String);
  } else if (qa.kind === "ayahCount") {
    distractors = pickNearbyNumberDistractors(parseInt(correct, 10), want, 4);
  } else if (qa.kind === "ayahNumber") {
    distractors = pickNearbyNumberDistractors(parseInt(correct, 10), want, 8);
  } else {
    distractors = await pickTextDistractors(new Set([qa.q, correct]), minP, maxP, want);
  }

  const choices = shuffle([correct, ...distractors]);
  return { choices, correctIndex: choices.indexOf(correct) };
}

// -------- MCQ rendering & interaction --------
function renderChoices(choices, locked) {
  mcqChoicesEl.innerHTML = "";
  choices.forEach((choiceText, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mcq-choice" + (locked ? " locked" : "");
    btn.textContent = choiceText;
    btn.style.fontSize = choiceFontSize(choiceText);
    btn.dataset.index = String(idx);
    if (locked) btn.disabled = true;
    mcqChoicesEl.appendChild(btn);
  });
}

function unlockChoicesAfterListening() {
  const buttons = Array.from(mcqChoicesEl.querySelectorAll(".mcq-choice.locked"));
  buttons.forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove("locked");
  });
}

function revealChoices(chosenIndex) {
  const buttons = Array.from(mcqChoicesEl.querySelectorAll(".mcq-choice"));
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === currentCorrectIndex) btn.classList.add("correct");
    if (idx === chosenIndex && idx !== currentCorrectIndex) btn.classList.add("wrong");
  });
}

mcqChoicesEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".mcq-choice");
  if (!btn || btn.disabled) return;
  if (!hasActiveCard || answeredThisCard) return;

  const idx = Number(btn.dataset.index);
  const isCorrect = idx === currentCorrectIndex;

  lockGenerate();
  stopTimer();
  revealChoices(idx);
  finishQuestion(isCorrect);
});

// -------- marking --------
function finishQuestion(isCorrect) {
  if (answeredThisCard) return;
  answeredThisCard = true;

  total += 1;
  if (isCorrect) correct += 1;

  sessionCombo = isCorrect ? sessionCombo + 1 : 0;
  updateComboBox();

  updateScore();
  unlockGenerate();

  setStatus(isCorrect ? "✅ إجابة صحيحة!" : "❌ إجابة خاطئة.");

  const flashClass = isCorrect ? "flash-correct" : "flash-wrong";
  flashcard.classList.add(flashClass);
  setTimeout(() => flashcard.classList.remove(flashClass), 700);

  saveGuestScore();

  // A mistake-review page that's now answered correctly drops out of
  // the active review pool so it doesn't keep coming back up.
  if (isCorrect && mistakeReviewActive && currentPage != null) {
    mistakeReviewPages = mistakeReviewPages.filter((p) => p !== currentPage);
    mistakeReviewHint.textContent = mistakeReviewPages.length
      ? `عدد صفحات المراجعة: ${mistakeReviewPages.length}. ستُزال كل صفحة تلقائيًا فور إتقانها.`
      : "أتقنت كل صفحات المراجعة في هذه الجلسة! 🎉";
    if (!mistakeReviewPages.length) {
      mistakeReviewActive = false;
      mistakeReviewToggle.checked = false;
      mistakeReviewRow.classList.remove("active");
    }
  }

  if (typeof recordAttempt === "function" && currentQuestionType) {
    // Read from the browser's own clock (not UTC) so the
    // night_owl/early_bird/weekend_warrior badges in
    // record_attempt() reflect the person's actual local time.
    const now = new Date();
    const localHour = now.getHours();
    const isWeekend = now.getDay() === 5 || now.getDay() === 6; // Fri/Sat

    recordAttempt({
      questionType: currentQuestionType,
      page: currentPage,
      isCorrect,
      sessionId: activeSessionId,
      rangeMin: currentRangeMin,
      rangeMax: currentRangeMax,
      localHour,
      isWeekend,
    }).then((result) => {
      if (result?.ok && result.newlyEarned && result.newlyEarned.length) {
        showAchievementToasts(result.newlyEarned);
      }
      if (result?.ok && result.xpGained) {
        showXpPopup(result.xpGained);
      }
      if (result?.ok && result.xp != null && typeof updateLevelBadge === "function") {
        updateLevelBadge(result.xp);
      }
    }).catch(() => { /* non-fatal: keep app usable offline */ });
  }
}

// -------- generate --------
async function generateCard() {
  try {
    const type = qTypeSelect.value;
    const label = getTypeLabel(type);

    const blockMsg = await getBlockMessageForCurrentState(type);
    if (blockMsg) {
      generateBtn.disabled = true;
      setStatus(blockMsg);
      alert(blockMsg);
      return;
    }

    const range = getActiveRange();
    const { minP, maxP } = range; // non-null here — blockMsg would have caught it otherwise

    // show description inside card
    cardHelp.textContent = `النوع: ${label} — ${getTypeDescription(type)}`;

    // Adjacent-page types are kept strictly inside [minP, maxP] by
    // never landing on the range's own last/first page as the
    // "question" page — so their answer (on the next/previous page)
    // always stays within the selected range too. In mistake-review
    // mode, the page comes from mistakeReviewPages instead of the
    // full range (checkGenerationBlock() already guaranteed a valid
    // one exists for this type) — buildChoices() below still uses the
    // full [minP, maxP] for distractors either way.
    let page;
    if (mistakeReviewActive) {
      const pages = filterPagesForType(mistakeReviewPages, type, minP, maxP);
      page = pages[randInt(0, pages.length - 1)];
    } else if (type === "nextPageFirst" || type === "pageEndToNextFirst") {
      page = randInt(minP, maxP - 1);
    } else if (type === "prevPageFirst" || type === "pageStartToPrevLast") {
      page = randInt(minP + 1, maxP);
    } else {
      page = randInt(minP, maxP);
    }

    setStatus("جاري التحميل...");
    lockGenerate();

    // reset
    stopTimer();
    hideAudioButton();
    flashcard.classList.remove("audio-question");
    mcqChoicesEl.innerHTML = "";
    answeredThisCard = false;
    hasActiveCard = false;
    currentCorrectIndex = -1;

    let qa = null;

    if (ADJACENT_TYPES.has(type)) {
      qa = await pickAdjacentPageQA(type, page);
    } else {
      const ayahs = await fetchPageAyahs(page);
      qa = pickQAFromPage(ayahs, type, page);
    }

    if (!qa || (!qa.q && !qa.audioOnly) || !qa.a) {
      setCardText(qText, "تعذر إنشاء سؤال. حاول مرة أخرى.");
      mcqChoicesEl.innerHTML = "";
      setStatus("حصلت مشكلة. جرّب مرة ثانية.");
      unlockGenerate();
      return;
    }

    const built = await buildChoices(qa, minP, maxP);
    if (!built || built.choices.length < 2 || built.correctIndex < 0) {
      setCardText(qText, "تعذر إنشاء خيارات كافية لهذا السؤال. جرّب نطاقًا أوسع أو نوعًا آخر.");
      mcqChoicesEl.innerHTML = "";
      setStatus("حصلت مشكلة. جرّب مرة ثانية.");
      unlockGenerate();
      return;
    }

    const isAudioOnly = !!qa.audioOnly;
    flashcard.classList.toggle("audio-question", isAudioOnly);

    if (isAudioOnly) {
      setCardText(qText, "🎧 اضغط زر الاستماع لسماع الآية، ثم اختر الآية التالية لها");
    } else {
      setCardText(qText, qa.q);
    }
    renderChoices(built.choices, isAudioOnly);
    currentCorrectIndex = built.correctIndex;

    currentQuestionType = type;
    currentPage = page;
    currentRangeMin = minP;
    currentRangeMax = maxP;
    currentQAyahNumber = qa.qAyahNumber || null;
    showAudioButtonFor(currentQAyahNumber);

    hasActiveCard = true;
    answeredThisCard = false;

    const sec = getTimerSeconds();
    const timerText = (sec <= 0) ? "بدون مؤقت" : `${sec} ثانية`;

    setStatus(isAudioOnly
      ? `استمع إلى الآية أولاً ثم اختر الإجابة. | المؤقت: ${timerText}`
      : `جاهز. النوع: ${label} | المؤقت: ${timerText}`);
    unlockGenerate();

    startTimer();
  } catch (err) {
    setCardText(qText, "خطأ في الشبكة أو في الـ API.");
    mcqChoicesEl.innerHTML = "";
    setStatus("فشل التحميل. تأكد من الإنترنت وحاول مجددًا.");
    unlockGenerate();
  }
}

// ============================================================
// Offline challenge mode (⚔️ تحديات) — up to 4 players sharing one
// device, buzzer-style: the group reveals the answer together and a
// moderator (whoever's holding the phone) taps who called it out
// correctly first. Fully client-side and ephemeral — no accounts
// involved, nothing is saved anywhere, it all resets on reload.
// Reuses the same question-generation helpers as solo mode
// (fetchPageAyahs, pickQAFromPage, pickAdjacentPageQA, buildChoices)
// so a challenge question looks and behaves exactly like a normal one.
// ============================================================

const CHALLENGE_TYPES = [
  "first", "last", "previous", "surah", "pageNumber", "ayahCount",
  "nextPageFirst", "prevPageFirst", "pageEndToNextFirst", "pageStartToPrevLast",
  "juz", "ayahNumber", "listenNext",
];
const CHALLENGE_MIN_TYPES = 3;
const CHALLENGE_MIN_PLAYERS = 2;
const CHALLENGE_MAX_PLAYERS = 4;

// -------- DOM --------
const challengePlayersList = document.getElementById("challengePlayersList");
const challengeAddPlayerBtn = document.getElementById("challengeAddPlayerBtn");
const challengeRangeSelect = document.getElementById("challengeRangeSelect");
const challengeTimerSelect = document.getElementById("challengeTimerSelect");
const challengeCustomRangeRow = document.getElementById("challengeCustomRangeRow");
const challengeCustomMin = document.getElementById("challengeCustomMin");
const challengeCustomMax = document.getElementById("challengeCustomMax");
const challengeTypesGrid = document.getElementById("challengeTypesGrid");
const challengeCountSelect = document.getElementById("challengeCountSelect");
const challengeStartBtn = document.getElementById("challengeStartBtn");
const challengeSetupError = document.getElementById("challengeSetupError");

const challengeSetupSection = document.getElementById("challengeSetupSection");
const challengePlaySection = document.getElementById("challengePlaySection");
const challengeResultsSection = document.getElementById("challengeResultsSection");

const challengeProgressLabel = document.getElementById("challengeProgressLabel");
const challengeScoreboard = document.getElementById("challengeScoreboard");
const challengeProgressBar = document.getElementById("challengeProgressBar");
const challengeFlashcard = document.getElementById("challengeFlashcard");
const challengeCardHelp = document.getElementById("challengeCardHelp");
const challengeQText = document.getElementById("challengeQText");
const challengeMcqChoices = document.getElementById("challengeMcqChoices");
const challengePlayAudioBtn = document.getElementById("challengePlayAudioBtn");
const challengeRevealBtn = document.getElementById("challengeRevealBtn");
const challengeAwardSection = document.getElementById("challengeAwardSection");
const challengeAwardButtons = document.getElementById("challengeAwardButtons");

const challengeResultsBody = document.getElementById("challengeResultsBody");
const challengeNewBtn = document.getElementById("challengeNewBtn");

// -------- state --------
let challengePlayers = [];        // [{ name, score }]
let challengeQueue = [];          // remaining question types, shuffled
let challengeTotalQuestions = 0;
let challengeQuestionIndex = 0;
let challengeRangeMinP = 1;
let challengeRangeMaxP = 604;
let challengeTimerSeconds = 30;
let challengeCurrentCorrectIndex = -1;
let challengeCurrentAudioAyah = null;
let challengeAnswered = false;
let challengeTimerInterval = null;
let challengeTimerStart = 0;
let challengeTimerDurationMs = 0;
let challengeAudioEl = null;
let challengeValidationToken = 0;

function escapeChallengeHtml(str) {
  return (str || "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// -------- setup: players --------
function renderChallengePlayerRows() {
  challengePlayersList.innerHTML = "";
  challengePlayers.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "challenge-player-row";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 20;
    input.placeholder = `اسم اللاعب ${idx + 1}`;
    input.value = p.name;
    input.addEventListener("input", () => {
      challengePlayers[idx].name = input.value;
      refreshChallengeStartAvailability();
    });
    row.appendChild(input);

    if (challengePlayers.length > CHALLENGE_MIN_PLAYERS) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn small ghost danger challenge-remove-player-btn";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        challengePlayers.splice(idx, 1);
        renderChallengePlayerRows();
        refreshChallengeStartAvailability();
      });
      row.appendChild(removeBtn);
    }

    challengePlayersList.appendChild(row);
  });

  challengeAddPlayerBtn.style.display = challengePlayers.length >= CHALLENGE_MAX_PLAYERS ? "none" : "";
}

challengeAddPlayerBtn.addEventListener("click", () => {
  if (challengePlayers.length >= CHALLENGE_MAX_PLAYERS) return;
  challengePlayers.push({ name: "", score: 0 });
  renderChallengePlayerRows();
  refreshChallengeStartAvailability();
});

// -------- setup: range --------
function showHideChallengeCustomRange() {
  challengeCustomRangeRow.style.display = (challengeRangeSelect.value === "custom") ? "flex" : "none";
}
challengeRangeSelect.addEventListener("change", () => {
  showHideChallengeCustomRange();
  refreshChallengeStartAvailability();
});
[challengeCustomMin, challengeCustomMax].forEach((el) => {
  el.addEventListener("change", refreshChallengeStartAvailability);
});

// -------- setup: question types --------
function renderChallengeTypesGrid() {
  challengeTypesGrid.innerHTML = "";
  CHALLENGE_TYPES.forEach((type) => {
    const label = document.createElement("label");
    label.className = "challenge-type-chip";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = type;
    cb.addEventListener("change", () => {
      label.classList.toggle("checked", cb.checked);
      refreshChallengeStartAvailability();
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(getTypeLabel(type)));
    challengeTypesGrid.appendChild(label);
  });
}

function getSelectedChallengeTypes() {
  return Array.from(challengeTypesGrid.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
}

// -------- setup: validation --------
// A dedicated (not the solo-mode checkGenerationBlock()) validator —
// that one also factors in mistake-review mode, which is solo-session
// state that has nothing to do with a challenge. This reuses the same
// underlying range-coverage checks (ADJACENT_TYPES/juzsInRange/
// surahsInRange/MIN_MCQ_ANSWERS) without that coupling.
async function challengeTypeBlockMessage(type, minP, maxP) {
  if (ADJACENT_TYPES.has(type) && maxP <= minP) {
    return "يلزم نطاق يشمل أكثر من صفحة واحدة لهذا النوع.";
  }
  if (type === "juz") {
    const available = juzsInRange(minP, maxP);
    if (available.length < MIN_MCQ_ANSWERS) return rangeTooNarrowMessage("خمن الجزء", available.length, "جزء", "أجزاء");
  }
  if (type === "pageNumber") {
    const available = maxP - minP + 1;
    if (available < MIN_MCQ_ANSWERS) return rangeTooNarrowMessage("خمن رقم الصفحة", available, "صفحة", "صفحات");
  }
  if (type === "surah") {
    const available = await surahsInRange(minP, maxP);
    if (available.length < MIN_MCQ_ANSWERS) return rangeTooNarrowMessage("خمن السورة", available.length, "سورة", "سور");
  }
  return null;
}

async function refreshChallengeStartAvailability() {
  const myToken = ++challengeValidationToken;

  const names = challengePlayers.map((p) => p.name.trim());
  const validNames = names.length >= CHALLENGE_MIN_PLAYERS && names.every((n) => n.length > 0);
  const uniqueNames = new Set(names.map((n) => n.toLowerCase())).size === names.length;
  const selectedTypes = getSelectedChallengeTypes();
  const enoughTypes = selectedTypes.length >= CHALLENGE_MIN_TYPES;

  let msg = "";
  if (!validNames) msg = "أدخل اسمًا لكل لاعب (لاعبان على الأقل).";
  else if (!uniqueNames) msg = "الأسماء يجب أن تكون مختلفة عن بعضها.";
  else if (!enoughTypes) msg = `اختر ${CHALLENGE_MIN_TYPES} أنواع أسئلة على الأقل.`;

  if (!msg) {
    const range = resolveRangeBounds(challengeRangeSelect.value, challengeCustomMin.value, challengeCustomMax.value);
    for (const type of selectedTypes) {
      const blocked = await challengeTypeBlockMessage(type, range.minP, range.maxP);
      if (blocked) { msg = `"${getTypeLabel(type)}": ${blocked}`; break; }
    }
  }

  if (myToken !== challengeValidationToken) return; // a newer check superseded this one
  challengeSetupError.textContent = msg;
  challengeStartBtn.disabled = !!msg;
}

// -------- starting a challenge --------
function buildChallengeQueue(selectedTypes, countPerType) {
  const queue = [];
  selectedTypes.forEach((type) => {
    for (let i = 0; i < countPerType; i++) queue.push(type);
  });
  return shuffle(queue);
}

function renderChallengeScoreboard() {
  challengeScoreboard.innerHTML = challengePlayers
    .map((p) => `
      <div class="challenge-score-chip">
        <span class="challenge-score-name">${escapeChallengeHtml(p.name)}</span>
        <span class="challenge-score-points">${p.score}</span>
      </div>`)
    .join("");
}

challengeStartBtn.addEventListener("click", async () => {
  const selectedTypes = getSelectedChallengeTypes();
  const range = resolveRangeBounds(challengeRangeSelect.value, challengeCustomMin.value, challengeCustomMax.value);
  const count = parseInt(challengeCountSelect.value, 10) || 5;

  challengePlayers = challengePlayers.map((p) => ({ name: p.name.trim(), score: 0 }));
  challengeRangeMinP = range.minP;
  challengeRangeMaxP = range.maxP;
  challengeTimerSeconds = parseInt(challengeTimerSelect.value, 10) || 0;
  challengeQueue = buildChallengeQueue(selectedTypes, count);
  challengeTotalQuestions = challengeQueue.length;
  challengeQuestionIndex = 0;

  renderChallengeScoreboard();
  challengeSetupSection.style.display = "none";
  challengeResultsSection.style.display = "none";
  challengePlaySection.style.display = "block";

  await nextChallengeQuestion();
});

// -------- play (buzzer) --------
function renderChallengeChoices(choices) {
  challengeMcqChoices.innerHTML = "";
  choices.forEach((choiceText) => {
    const div = document.createElement("div");
    div.className = "mcq-choice locked";
    div.textContent = choiceText;
    div.style.fontSize = choiceFontSize(choiceText);
    challengeMcqChoices.appendChild(div);
  });
}

function revealChallengeChoices() {
  Array.from(challengeMcqChoices.children).forEach((el, idx) => {
    if (idx === challengeCurrentCorrectIndex) el.classList.add("correct");
  });
}

function stopChallengeTimer() {
  if (challengeTimerInterval) {
    clearInterval(challengeTimerInterval);
    challengeTimerInterval = null;
  }
  challengeProgressBar.style.width = "0%";
}

function startChallengeTimer() {
  stopChallengeTimer();
  if (challengeTimerSeconds <= 0) return; // "بدون مؤقت" — no auto-reveal, group paces itself

  challengeTimerDurationMs = challengeTimerSeconds * 1000;
  challengeTimerStart = Date.now();
  challengeProgressBar.style.width = "0%";

  challengeTimerInterval = setInterval(() => {
    const elapsed = Date.now() - challengeTimerStart;
    const pct = clamp((elapsed / challengeTimerDurationMs) * 100, 0, 100);
    challengeProgressBar.style.width = pct + "%";
    if (elapsed >= challengeTimerDurationMs) {
      stopChallengeTimer();
      if (!challengeAnswered) revealChallengeAnswer();
    }
  }, 100);
}

function challengeAudioStop() {
  if (challengeAudioEl) {
    challengeAudioEl.pause();
    challengeAudioEl.currentTime = 0;
    challengeAudioEl = null;
  }
  challengePlayAudioBtn.textContent = "🔊 استماع";
  challengePlayAudioBtn.classList.remove("playing");
}

challengePlayAudioBtn.addEventListener("click", async () => {
  if (challengeAudioEl && !challengeAudioEl.paused) {
    challengeAudioStop();
    return;
  }
  if (!challengeCurrentAudioAyah) return;

  challengePlayAudioBtn.disabled = true;
  challengePlayAudioBtn.textContent = "⏳ جارٍ التحميل...";
  try {
    const url = await fetchAyahAudioUrl(challengeCurrentAudioAyah);
    if (!url) throw new Error("no audio url");
    challengeAudioEl = new Audio(url);
    challengeAudioEl.addEventListener("ended", challengeAudioStop);
    await challengeAudioEl.play();
    challengePlayAudioBtn.textContent = "⏸️ إيقاف";
    challengePlayAudioBtn.classList.add("playing");
  } catch (e) {
    challengeAudioStop();
  } finally {
    challengePlayAudioBtn.disabled = false;
  }
});

// Generates the next question in the queue and shows it. Retries a
// few times on a transient generation failure (same class of failure
// solo mode can hit — e.g. a page with too few ayahs for a given
// type), and if it still can't produce one, silently skips that slot
// rather than stalling the group's game.
async function nextChallengeQuestion() {
  challengeAnswered = false;
  challengeAwardSection.style.display = "none";
  challengeRevealBtn.style.display = "";
  challengeRevealBtn.disabled = false;
  stopChallengeTimer();
  challengeAudioStop();

  if (challengeQueue.length === 0) {
    finishChallenge();
    return;
  }

  challengeQuestionIndex++;
  const type = challengeQueue.shift();
  challengeProgressLabel.textContent = `سؤال ${challengeQuestionIndex} من ${challengeTotalQuestions}`;

  let qa = null;
  let attempts = 0;
  while (!qa && attempts < 6) {
    attempts++;
    let page;
    if (type === "nextPageFirst" || type === "pageEndToNextFirst") {
      page = randInt(challengeRangeMinP, challengeRangeMaxP - 1);
    } else if (type === "prevPageFirst" || type === "pageStartToPrevLast") {
      page = randInt(challengeRangeMinP + 1, challengeRangeMaxP);
    } else {
      page = randInt(challengeRangeMinP, challengeRangeMaxP);
    }

    try {
      if (ADJACENT_TYPES.has(type)) {
        qa = await pickAdjacentPageQA(type, page);
      } else {
        const ayahs = await fetchPageAyahs(page);
        qa = pickQAFromPage(ayahs, type, page);
      }
    } catch (e) {
      qa = null;
    }
    if (qa && !qa.q && !qa.audioOnly) qa = null;
    if (qa && !qa.a) qa = null;
  }

  if (!qa) {
    challengeTotalQuestions = Math.max(challengeQuestionIndex, challengeTotalQuestions - 1);
    await nextChallengeQuestion();
    return;
  }

  const built = await buildChoices(qa, challengeRangeMinP, challengeRangeMaxP);
  if (!built || built.choices.length < 2 || built.correctIndex < 0) {
    challengeTotalQuestions = Math.max(challengeQuestionIndex, challengeTotalQuestions - 1);
    await nextChallengeQuestion();
    return;
  }

  challengeCurrentCorrectIndex = built.correctIndex;
  challengeCurrentAudioAyah = qa.qAyahNumber || null;

  const isAudioOnly = !!qa.audioOnly;
  challengeFlashcard.classList.toggle("audio-question", isAudioOnly);
  challengeCardHelp.textContent = `النوع: ${getTypeLabel(type)}`;
  setCardText(challengeQText, isAudioOnly ? "🎧 اضغط زر الاستماع لسماع الآية" : qa.q);
  renderChallengeChoices(built.choices);
  challengePlayAudioBtn.style.display = challengeCurrentAudioAyah ? "inline-flex" : "none";

  startChallengeTimer();
}

function revealChallengeAnswer() {
  if (challengeAnswered) return;
  challengeAnswered = true;
  stopChallengeTimer();
  revealChallengeChoices();
  challengeRevealBtn.style.display = "none";
  renderChallengeAwardButtons();
  challengeAwardSection.style.display = "block";
}
challengeRevealBtn.addEventListener("click", revealChallengeAnswer);

function renderChallengeAwardButtons() {
  challengeAwardButtons.innerHTML = "";
  challengePlayers.forEach((p, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small challenge-award-btn";
    btn.textContent = p.name;
    btn.addEventListener("click", () => awardChallengePoint(idx));
    challengeAwardButtons.appendChild(btn);
  });

  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "btn small ghost challenge-award-btn";
  noneBtn.textContent = "لم يُجب أحد بشكل صحيح";
  noneBtn.addEventListener("click", () => awardChallengePoint(-1));
  challengeAwardButtons.appendChild(noneBtn);
}

function awardChallengePoint(playerIdx) {
  if (playerIdx >= 0) challengePlayers[playerIdx].score += 1;
  renderChallengeScoreboard();
  challengeAwardSection.style.display = "none";
  setTimeout(() => { nextChallengeQuestion(); }, 500);
}

// -------- results --------
function finishChallenge() {
  challengePlaySection.style.display = "none";
  challengeResultsSection.style.display = "block";

  const maxScore = Math.max(...challengePlayers.map((p) => p.score));
  const winners = challengePlayers.filter((p) => p.score === maxScore);
  const ranked = [...challengePlayers].sort((a, b) => b.score - a.score);

  const rowsHtml = ranked
    .map((p, i) => {
      const isWinner = maxScore > 0 && p.score === maxScore;
      return `
        <div class="stat-row leaderboard-row challenge-result-row${isWinner ? " winner" : ""}">
          <div class="stat-row-label">${isWinner ? "🏆 " : `${i + 1}. `}${escapeChallengeHtml(p.name)}</div>
          <div class="stat-row-value">${p.score} نقطة</div>
        </div>`;
    })
    .join("");

  const headline = maxScore === 0
    ? "لم يسجّل أحد أي نقطة!"
    : winners.length > 1
      ? `تعادل بين: ${winners.map((w) => w.name).join("، ")} 🎉`
      : `الفائز: ${winners[0].name} 🏆`;

  challengeResultsBody.innerHTML = `
    <div class="stat-summary">
      <div class="stat-big" style="font-size:20px;">${escapeChallengeHtml(headline)}</div>
      <div class="stat-caption">${challengeTotalQuestions} سؤال في هذا التحدي</div>
    </div>
    <div class="stat-rows">${rowsHtml}</div>`;
}

function resetChallengeToSetup() {
  challengePlayers = [{ name: "", score: 0 }, { name: "", score: 0 }];
  renderChallengePlayerRows();
  challengeTypesGrid.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = false;
    cb.closest(".challenge-type-chip")?.classList.remove("checked");
  });
  challengeRangeSelect.value = "custom";
  challengeCustomMin.value = 1;
  challengeCustomMax.value = 604;
  showHideChallengeCustomRange();
  challengeTimerSelect.value = "30";
  challengeCountSelect.value = "5";

  challengeResultsSection.style.display = "none";
  challengePlaySection.style.display = "none";
  challengeSetupSection.style.display = "block";
  refreshChallengeStartAvailability();
}
challengeNewBtn.addEventListener("click", resetChallengeToSetup);

// -------- init --------
renderChallengeTypesGrid();
resetChallengeToSetup();

generateBtn.addEventListener("click", generateCard);

// Init
loadGuestScore();
updateScore();
setStatus("");
qText.textContent = "—";

// Update help text when changing question type (without generating)
qTypeSelect.addEventListener("change", () => {
  const type = qTypeSelect.value;
  const label = getTypeLabel(type);
  cardHelp.textContent = `النوع: ${label} — ${getTypeDescription(type)}`;
  refreshGenerationAvailability();
});

// Guest range changes affect which question types are even valid —
// recheck immediately, not just when they hit "سؤال جديد".
[rangeSelect, customMinEl, customMaxEl].forEach((el) => {
  el.addEventListener("change", () => {
    refreshQuestionTypeAvailability();
  });
});

mistakeReviewToggle.addEventListener("change", async () => {
  if (!mistakeReviewToggle.checked) {
    mistakeReviewActive = false;
    mistakeReviewHint.textContent = "سيتم اختيار الأسئلة من الصفحات التي أخطأت فيها فقط، وتُزال الصفحة تلقائيًا بعد إتقانها.";
    mistakeReviewRow.classList.remove("active");
    await refreshGenerationAvailability();
    return;
  }

  if (!activeSessionId) {
    mistakeReviewToggle.checked = false;
    return;
  }

  mistakeReviewToggle.disabled = true;
  const pages = (typeof fetchSessionWrongPages === "function") ? await fetchSessionWrongPages(activeSessionId) : [];
  mistakeReviewToggle.disabled = false;

  if (!pages.length) {
    mistakeReviewToggle.checked = false;
    alert("لا توجد إجابات خاطئة في هذه الجلسة بعد.");
    return;
  }

  mistakeReviewActive = true;
  mistakeReviewPages = pages;
  mistakeReviewHint.textContent = `عدد صفحات المراجعة: ${pages.length}. ستُزال كل صفحة تلقائيًا فور إتقانها.`;
  mistakeReviewRow.classList.add("active");
  await refreshGenerationAvailability();
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
  // No refreshQuestionTypeAvailability() call here — this can run
  // before or after the session-setup onAuthChange handler below
  // finishes resolving activeSessionId (both fire off the same auth
  // event), and that handler always calls it once the session range
  // is actually known, so calling it here too just risked a brief
  // "no range" flash if this happened to resolve first.
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
      activeSessionTitle = active?.title ?? null;
      showSessionRangeUI(activeSessionRangeMin, activeSessionRangeMax);
      setTopbarSessionName(activeSessionTitle);
    } else {
      activeSessionId = null;
      activeSessionRangeMin = null;
      activeSessionRangeMax = null;
      activeSessionTitle = null;
      showGuestRangeUI();
    }
    await refreshQuestionTypeAvailability();
  });
} else {
  settingsSyncReady = true;
}
