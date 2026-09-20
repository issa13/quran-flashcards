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
// "pageNumber", "surah", "juz", "first", "last", "previous", and
// "listenNext" — types whose whole point is telling several distinct
// values/ayahs apart.
const MIN_MCQ_ANSWERS = 5;

// "ayahNumber" needs a bit more headroom than the default above: its
// distractors are nearby numbers within the surah's own ayah range
// (see pickNearbyNumberDistractors), so a very short surah doesn't
// leave enough plausible distinct numbers to ask this fairly.
const MIN_AYAHNUMBER_ANSWERS = 6;

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
const homeFlashcardWrap = document.getElementById("homeFlashcardWrap");
const generateBtn = document.getElementById("generateBtn");
const qText = document.getElementById("qText");
const mcqChoicesEl = document.getElementById("mcqChoices");
const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressWrap = document.querySelector(".progress-wrap");
const homeRangeChip = document.getElementById("homeRangeChip");
const settingsToggleBtn = document.getElementById("settingsToggleBtn");
const settingsAccordionBody = document.getElementById("settingsAccordionBody");
const viewPageInQuranBtn = document.getElementById("viewPageInQuranBtn");

const qTypeSelect = document.getElementById("qTypeSelect");
const timerSelect = document.getElementById("timerSelect");

// Range picker — same for everyone now (guests and signed-in users
// alike). Session-backed quizzes live under ⚔️ التحديات → ذاتي.
const guestRangeRow = document.getElementById("guestRangeRow");
const rangeSelect = document.getElementById("rangeSelect");
const customRangeRow = document.getElementById("customRangeRow");
const customMinEl = document.getElementById("customMin");
const customMaxEl = document.getElementById("customMax");

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
  night_owl: { icon: "🦉", title: "بومة الليل" },
  early_bird: { icon: "🐦", title: "الطائر المبكر" },
  weekend_warrior: { icon: "🎯", title: "محارب العطلة" },
  duel_first_win: { icon: "⚔️", title: "أول انتصار مباشر" },
  duel_wins_10: { icon: "🛡️", title: "مبارز محترف" },
};

// Catalog-backed fallback for the 43 achievements generated in a SQL
// loop (30× juz_complete_N, 13× type_master_<type> — see
// supabase-schema.sql section 5d/5e) which aren't worth hand-listing
// above one by one. Fetched once and cached, rather than on every
// toast, since the catalog itself never changes during a session.
let achievementCatalogCache = null;
async function getAchievementInfo(code) {
  if (ACHIEVEMENT_INFO[code]) return ACHIEVEMENT_INFO[code];
  if (!achievementCatalogCache) {
    const catalog = (typeof fetchAchievementsCatalog === "function") ? await fetchAchievementsCatalog() : [];
    achievementCatalogCache = {};
    catalog.forEach((a) => { achievementCatalogCache[a.code] = { icon: a.icon, title: a.title }; });
  }
  return achievementCatalogCache[code] || { icon: "🏅", title: "إنجاز جديد" };
}

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

// Returns the full rank ladder for display (achievements view) — each
// tier's title, the level it starts at, and the XP that level
// requires (via xpForLevel, so it can never drift out of sync with
// the actual level curve). auth-ui.js calls this to render "you are
// here" against the full list, not just the current rank name.
function levelTierList() {
  return LEVEL_TITLES.map((tier) => ({
    title: tier.title,
    minLevel: tier.min,
    minXp: xpForLevel(tier.min),
  }));
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
// True while an audio-only (listenNext) card is up and its timer is
// deliberately withheld until playback actually starts — see
// generateCard()'s ending and playAudioBtn's click handler below.
let audioGateTimerPending = false;

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

// (Session tracking and mistake-review mode used to live here for the
// Tests screen — they now belong exclusively to ⚔️ التحديات → ذاتي;
// see the self-challenge section below for getActiveSessionId()/
// syncActiveSessionId().)

// Timer state
let timerInterval = null;
let timerStart = 0;
let timerDurationMs = 0;

// Caches
const pageCache = new Map();
let surahCatalogPromise = null;

// Locally-derived Quran text index (see derive-quran-index.js and
// download-mushaf-layout.sh) — replaces alquran.cloud entirely for
// ayah/surah text. Loaded once and cached forever in-memory; the
// shared asset version invalidates stale browser cache entries after deploys.
let quranSurahIndexPromise = null;
function fetchLocalSurahIndex() {
  if (quranSurahIndexPromise) return quranSurahIndexPromise;
  const version = encodeURIComponent(window.QF_ASSET_VERSION || "dev");
  quranSurahIndexPromise = fetch(`quran-index/surahs.json?v=${version}`, { cache: "no-cache" })
    .then((res) => { if (!res.ok) throw new Error("HTTP error"); return res.json(); })
    .catch((e) => { quranSurahIndexPromise = null; throw e; });
  return quranSurahIndexPromise;
}

let quranAyahIndexPromise = null;
function fetchLocalAyahIndex() {
  if (quranAyahIndexPromise) return quranAyahIndexPromise;
  const version = encodeURIComponent(window.QF_ASSET_VERSION || "dev");
  quranAyahIndexPromise = fetch(`quran-index/ayahs.json?v=${version}`, { cache: "no-cache" })
    .then((res) => { if (!res.ok) throw new Error("HTTP error"); return res.json(); })
    .catch((e) => { quranAyahIndexPromise = null; throw e; });
  return quranAyahIndexPromise;
}

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

async function showAchievementToasts(codes) {
  const list = codes || [];
  for (let i = 0; i < list.length; i++) {
    const info = await getAchievementInfo(list[i]);
    setTimeout(() => showAchievementToast(info), i * 450);
  }
}

// Called once on sign-in (see auth-ui.js's onAuthChange) to capture a
// baseline of achievements the person already has — without this,
// the very first duel win after signing in would misread every
// achievement they've EVER earned as "new" and toast all of them.
async function initKnownAchievementCache() {
  if (!currentUser) { knownAchievementCodesCache = null; return; }
  const earned = (typeof fetchMyAchievements === "function") ? await fetchMyAchievements() : [];
  knownAchievementCodesCache = new Set(earned.map((e) => e.code));
}

// See showDuelResults()'s comment on why this diff-based approach
// (rather than trusting any single RPC response) is the reliable way
// to show the duel-win achievement toast.
async function checkForNewDuelAchievements() {
  if (!knownAchievementCodesCache) await initKnownAchievementCache();
  if (!knownAchievementCodesCache) return; // still no session — nothing to check

  const nowEarned = (typeof fetchMyAchievements === "function") ? await fetchMyAchievements() : [];
  const newly = nowEarned
    .map((e) => e.code)
    .filter((code) => !knownAchievementCodesCache.has(code));

  knownAchievementCodesCache = new Set(nowEarned.map((e) => e.code));
  if (newly.length) showAchievementToasts(newly);
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

// The range actually in effect right now on the Tests screen — always
// the guest picker's current value. The Tests screen no longer has
// any session concept (signed-in and guest users share the exact
// same experience here); session-backed quizzes now live entirely
// under ⚔️ التحديات → ذاتي (see the self-challenge section below).
function getActiveRange() {
  return getGuestRangeFromSelect();
}

// -------- generation gating --------
const ADJACENT_TYPES = new Set(["nextPageFirst", "prevPageFirst", "pageEndToNextFirst", "pageStartToPrevLast"]);

function rangeTooNarrowMessage(typeLabel, count, singularUnit, pluralUnit, required = MIN_MCQ_ANSWERS) {
  const countText = count === 1 ? `${singularUnit} واحدة فقط` : `${count} ${pluralUnit} فقط`;
  return `النطاق المحدد يغطي ${countText}، ويلزم ${required} على الأقل لإنشاء سؤال "${typeLabel}". وسّع نطاق الصفحات أو اختر نوع سؤال آخر.`;
}

// Central "can we generate a question of this type, in this range,
// right now?" check. Returns a message to show when blocked, or null
// when it's fine to proceed.
async function checkGenerationBlock(type, minP, maxP) {
  if (ADJACENT_TYPES.has(type) && maxP <= minP) {
    return "يلزم نطاق يشمل أكثر من صفحة واحدة لإنشاء هذا النوع من الأسئلة. وسّع نطاق الصفحات أو اختر نوع سؤال آخر.";
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

  // "first"/"last" each draw their one correct answer per page (the
  // page's first/last ayah), so the page count IS the valid-answer count.
  if (type === "first" || type === "last") {
    const available = maxP - minP + 1;
    if (available < MIN_MCQ_ANSWERS) {
      const label = type === "first" ? "خمن الآية الأولى بالصفحة" : "خمن الآية الأخيرة بالصفحة";
      return rangeTooNarrowMessage(label, available, "صفحة", "صفحات");
    }
  }

  // Needs strictly MORE than MIN_MCQ_ANSWERS pages (not just >=), per
  // the requested gating for this specific type.
  if (type === "ayahCount") {
    const available = maxP - minP + 1;
    if (available <= MIN_MCQ_ANSWERS) {
      return rangeTooNarrowMessage("خمن كم عدد آيات الصفحة", available, "صفحة", "صفحات", MIN_MCQ_ANSWERS + 1);
    }
  }

  // "previous"/"next"/"listenNext" pick any ayah in range as the
  // question, so the total ayah count in range is the meaningful pool
  // size here.
  if (type === "previous" || type === "next" || type === "listenNext") {
    const available = await ayahsCountInRange(minP, maxP);
    if (available < MIN_MCQ_ANSWERS) {
      return rangeTooNarrowMessage(getTypeLabel(type), available, "آية", "آيات");
    }
  }

  // Needs strictly more than MIN_AYAHNUMBER_ANSWERS ayahs in range —
  // see the constant's own comment for why this type gets extra headroom.
  if (type === "ayahNumber") {
    const available = await ayahsCountInRange(minP, maxP);
    if (available <= MIN_AYAHNUMBER_ANSWERS) {
      return rangeTooNarrowMessage("خمن رقم الآية بالسورة", available, "آية", "آيات", MIN_AYAHNUMBER_ANSWERS + 1);
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
      return "هذه الجلسة ليس لها نطاق صفحات محدد. اضغط «+ جلسة جديدة» ضمن ⚙️ الإعدادات أدناه للمتابعة.";
    }
    return "الرجاء اختيار نطاق صفحات صالح.";
  }
  return await checkGenerationBlock(type, range.minP, range.maxP);
}

// Reflects getBlockMessageForCurrentState() in the UI immediately on
// every relevant change, not just when generating fails.
async function refreshGenerationAvailability() {
  updateHomeRangeChip();

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

// Read-only glance at the active range shown near the top of the home
// page (see homeRangeChip in index.html) — the full picker lives in
// the ⚙️ الإعدادات section below. Kept in sync from
// refreshGenerationAvailability(), which already runs on every event
// that could change the active range (guest picker, session sync).
function updateHomeRangeChip() {
  const range = getActiveRange();
  homeRangeChip.textContent = range ? `📖 ${range.minP}–${range.maxP}` : "📖 —";
}

function setOptionAvailability(value, available) {
  const opt = qTypeSelect.querySelector(`option[value="${value}"]`);
  if (!opt) return;
  opt.disabled = !available;
  opt.hidden = !available;
}

// Hides/disables question-type options that can't produce enough
// valid answers in the current range: pageNumber/surah/juz/first/last
// need MIN_MCQ_ANSWERS distinct values; ayahCount needs strictly more
// than that many pages; previous/next/listenNext need MIN_MCQ_ANSWERS
// ayahs in range; ayahNumber needs strictly more than
// MIN_AYAHNUMBER_ANSWERS ayahs in range; the adjacent-page types need
// more than one page. Falls back the selection to whichever option is
// still available if the currently-chosen type just became unavailable.
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
  let ayahCount = 0;
  try {
    surahCount = (await surahsInRange(minP, maxP)).length;
  } catch (e) { /* leave at 0 → hides the option safely */ }
  try {
    ayahCount = await ayahsCountInRange(minP, maxP);
  } catch (e) { /* leave at 0 → hides the option safely */ }

  setOptionAvailability("pageNumber", pageCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("surah", surahCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("juz", juzCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("first", pageCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("last", pageCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("ayahCount", pageCount > MIN_MCQ_ANSWERS);
  setOptionAvailability("previous", ayahCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("next", ayahCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("listenNext", ayahCount >= MIN_MCQ_ANSWERS);
  setOptionAvailability("ayahNumber", ayahCount > MIN_AYAHNUMBER_ANSWERS);

  const multiPage = maxP > minP;
  ADJACENT_TYPES.forEach((t) => setOptionAvailability(t, multiPage));

  const selectedOption = qTypeSelect.querySelector(`option[value="${qTypeSelect.value}"]`);
  if (selectedOption && selectedOption.disabled) {
    const fallback = Array.from(qTypeSelect.options).find((o) => !o.disabled);
    if (fallback) {
      qTypeSelect.value = fallback.value;
      cardHelp.textContent = `النوع: ${getTypeLabel(fallback.value)} — ${getTypeDescription(fallback.value)}`;
    }
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

// -------- Quran text (locally derived, see fetchLocalAyahIndex above) --------
// Same return shape as before (ayah.text/.numberInSurah/.juz/.page/
// .surah.number/.surah.name) so every caller — solo generation, offline
// challenge mode, surahsInRange() — needed zero changes. The one thing
// that changed under the hood: ayah.number now holds a "surah:ayah"
// reference string instead of alquran.cloud's global integer, since
// nothing actually did arithmetic on it — every caller just passes it
// straight through to fetchAyahAudioUrl().
async function fetchPageAyahs(page) {
  if (pageCache.has(page)) return pageCache.get(page);

  const allAyahs = await fetchLocalAyahIndex();
  const juz = juzForPage(page);
  const ayahs = allAyahs
    .filter((a) => a.page === page)
    .map((a) => ({
      number: `${a.surah}:${a.ayah}`,
      text: a.text,
      numberInSurah: a.ayah,
      juz,
      page,
      surah: { number: a.surah, name: a.surahName },
    }));

  pageCache.set(page, ayahs);
  return ayahs;
}

// Fetches the full 114-surah list once (number + name + ayah count +
// start page), from our own derived index — cached forever.
function fetchSurahCatalog() {
  if (surahCatalogPromise) return surahCatalogPromise;
  surahCatalogPromise = fetchLocalSurahIndex();
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

// Total ayahs across every page in [minP, maxP] — a cheap, purely
// in-memory measure (one filter over the already-loaded local index,
// no network call) used to gate "previous", "listenNext", and
// "ayahNumber", whose answer pools aren't a fixed per-page/per-surah
// count the way pageNumber/surah/juz are.
async function ayahsCountInRange(minP, maxP) {
  try {
    const all = await fetchLocalAyahIndex();
    let count = 0;
    for (const a of all) if (a.page >= minP && a.page <= maxP) count++;
    return count;
  } catch (e) {
    return 0;
  }
}

// -------- recitation audio --------
// A direct static-file URL — no API call needed. everyayah.com serves
// every reciter's audio as plain files named {surah:03d}{ayah:03d}.mp3
// (verified directly against their file listing). Accepts either:
//   - a "surah:ayahInSurah" reference (solo/offline modes now use
//     this, via fetchPageAyahs()'s ayah.number), or
//   - a legacy global ayah number 1–6236 (duel mode still uses this,
//     since its server-side question generation — the Edge Function —
//     intentionally still uses alquran.cloud; see project notes on
//     why that one wasn't migrated). Resolved to surah:ayah via our
//     own local index, which is built in the same canonical
//     (surah, ayah) order as the universal global numbering, so
//     index [globalNumber - 1] is a free, exact lookup.
async function fetchAyahAudioUrl(reference) {
  let surah, ayah;
  const str = String(reference);
  if (str.includes(":")) {
    [surah, ayah] = str.split(":").map((n) => parseInt(n, 10));
  } else {
    const globalNumber = parseInt(str, 10);
    if (!globalNumber) return null;
    const allAyahs = await fetchLocalAyahIndex();
    const entry = allAyahs[globalNumber - 1];
    if (!entry) return null;
    surah = entry.surah;
    ayah = entry.ayah;
  }
  if (!surah || !ayah) return null;
  const surahPadded = String(surah).padStart(3, "0");
  const ayahPadded = String(ayah).padStart(3, "0");
  return `https://everyayah.com/data/Alafasy_128kbps/${surahPadded}${ayahPadded}.mp3`;
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
    if (audioGateTimerPending) {
      audioGateTimerPending = false;
      startTimer();
    }
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
    case "next": return "سيظهر لك آية، والمطلوب أن تتذكر الآية التي تليها مباشرة في نفس الصفحة.";
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
    case "next": return "خمن الآية التالية";
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
//   "text"     → other ayah texts (previous/listenNext/adjacent types)
//   "firstAyah"/"lastAyah" → other ayah texts too, but specifically
//                the first/last ayah of OTHER pages in range (see
//                buildChoices()'s comment on why these get their own
//                kind instead of sharing plain "text")
//   "surah"    → other surah names (from surahsInRange)
//   "pageNumber" / "juz" → other values from the same range
//   "ayahCount" / "ayahNumber" → nearby numbers
// `qAyahNumber` is a "surah:ayahInSurah" reference (e.g. "2:255") for
// whichever ayah the question text (`q`) came from — used to fetch
// its recitation audio on demand (see fetchAyahAudioUrl()). Nothing
// ever does arithmetic on this value, only passes it through, so its
// exact format doesn't matter beyond that fetchAyahAudioUrl() understands it.
function pickQAFromPage(ayahs, type, page, forcedIdx) {
  if (!ayahs || ayahs.length < 2) return null;

  const first = ayahs[0];
  const last = ayahs[ayahs.length - 1];

  // forcedIdx (optional) pins WHICH ayah of the page the question is
  // built from — used by the no-repeat pools below (see
  // generateUniqueQuestion) so a question can be chosen deliberately
  // instead of at random. Without it (or if it falls outside the
  // valid range for this type) the pick is random, exactly as before.
  const pickIdx = (lo, hi) =>
    (Number.isInteger(forcedIdx) && forcedIdx >= lo && forcedIdx <= hi) ? forcedIdx : randInt(lo, hi);

  if (type === "first") {
    const candidate = ayahs[pickIdx(1, ayahs.length - 1)];
    return { q: clean(candidate.text), a: clean(first.text), kind: "firstAyah", qAyahNumber: candidate.number, sourcePage: page };
  }

  if (type === "last") {
    const candidate = ayahs[pickIdx(0, ayahs.length - 2)];
    return { q: clean(candidate.text), a: clean(last.text), kind: "lastAyah", qAyahNumber: candidate.number, sourcePage: page };
  }

  if (type === "previous") {
    const idx = pickIdx(1, ayahs.length - 1);
    return { q: clean(ayahs[idx].text), a: clean(ayahs[idx - 1].text), kind: "text", qAyahNumber: ayahs[idx].number };
  }

  if (type === "next") {
    const idx = pickIdx(0, ayahs.length - 2);
    return { q: clean(ayahs[idx].text), a: clean(ayahs[idx + 1].text), kind: "text", qAyahNumber: ayahs[idx].number };
  }

  if (type === "surah") {
    const candidate = ayahs[pickIdx(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: getSurahName(candidate), kind: "surah", qAyahNumber: candidate.number };
  }

  if (type === "pageNumber") {
    const candidate = ayahs[pickIdx(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: String(page), kind: "pageNumber", qAyahNumber: candidate.number };
  }

  if (type === "ayahCount") {
    return { q: clean(first.text), a: String(ayahs.length), kind: "ayahCount", qAyahNumber: first.number };
  }

  if (type === "juz") {
    const candidate = ayahs[pickIdx(0, ayahs.length - 1)];
    const juz = candidate.juz;
    if (juz == null) return null;
    return { q: clean(candidate.text), a: String(juz), kind: "juz", qAyahNumber: candidate.number };
  }

  if (type === "ayahNumber") {
    const candidate = ayahs[pickIdx(0, ayahs.length - 1)];
    const num = candidate.numberInSurah;
    if (num == null) return null;
    return { q: clean(candidate.text), a: String(num), kind: "ayahNumber", qAyahNumber: candidate.number };
  }

  if (type === "listenNext") {
    // q is deliberately left empty — this type is audio-only, the
    // ayah's text must never be shown (see generateCard()'s handling
    // of qa.audioOnly). Only the answer (the next ayah) is text.
    const idx = pickIdx(0, ayahs.length - 2);
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

// Gathers the first (or last) ayah's text from OTHER pages in range —
// used so a "first ayah of the page" / "last ayah of the page"
// question's wrong answers are ALSO first/last ayahs of some other
// page, not just any random verse. Without this, a plain-text
// distractor pulled from the middle of a page tends to look visibly
// different in style/length from a genuine page-opening or
// page-closing ayah, handing away the answer by shape alone rather
// than requiring the person to actually know the page.
async function collectPositionalAyahTexts(position, minP, maxP, excludePage, excludeSet, count) {
  const results = [];
  const seen = new Set(excludeSet);

  async function tryRange(lo, hi) {
    const pages = [];
    for (let p = lo; p <= hi; p++) if (p !== excludePage) pages.push(p);
    shuffle(pages);
    for (const p of pages) {
      if (results.length >= count) break;
      try {
        const ayahs = await fetchPageAyahs(p);
        if (!ayahs || !ayahs.length) continue;
        const text = clean(position === "first" ? ayahs[0].text : ayahs[ayahs.length - 1].text);
        if (text && !seen.has(text)) {
          seen.add(text);
          results.push(text);
        }
      } catch (e) { /* skip failed page fetch */ }
    }
  }

  await tryRange(minP, maxP);
  if (results.length < count) await tryRange(1, 604); // widen, same fallback pattern as pickTextDistractors
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

// Below this many, a "first ayah of a page" or "last ayah of a page"
// question is considered too easy to guess by shape alone — see
// collectPositionalAyahTexts()'s comment. MIN_MCQ_ANSWERS already
// guarantees the RANGE has enough pages overall (checkGenerationBlock),
// but that's a floor on total pages, not a promise about this specific
// distractor strategy, so it's kept as its own named constant.
const MIN_SAME_POSITION_DISTRACTORS = 3;

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
  } else if (qa.kind === "firstAyah" || qa.kind === "lastAyah") {
    const position = qa.kind === "firstAyah" ? "first" : "last";
    const excludeSet = new Set([qa.q, correct]);
    // Fill as many distractor slots as possible with same-position
    // (also first/last-of-a-page) ayahs — only the leftover slots, if
    // any, fall back to a plain ayah from anywhere in range.
    const positional = await collectPositionalAyahTexts(position, minP, maxP, qa.sourcePage, excludeSet, want);
    if (positional.length < MIN_SAME_POSITION_DISTRACTORS) {
      console.warn(`Only found ${positional.length} same-position (${position}-ayah) distractor(s) for page ${qa.sourcePage}; expected at least ${MIN_SAME_POSITION_DISTRACTORS}. Consider widening the range for this question type.`);
    }
    distractors = positional;
    if (distractors.length < want) {
      const more = await pickTextDistractors(new Set([...excludeSet, ...distractors]), minP, maxP, want - distractors.length);
      distractors = distractors.concat(more);
    }
  } else {
    distractors = await pickTextDistractors(new Set([qa.q, correct]), minP, maxP, want);
  }

  const choices = shuffle([correct, ...distractors]);
  return { choices, correctIndex: choices.indexOf(correct) };
}

// ============================================================
// Question de-duplication
//
// A question's identity is (type, question ayah) — the same ayah
// asked as the same type is "the same question", however its wrong
// answers happen to be shuffled. Rules (see README §9):
//   - ⚔️ التحديات (محلي / مباشر / ذاتي): never repeat a question
//     within one challenge, ever.
//   - 📝 اختبارات: never repeat a question within the next 25.
//
// Rather than pick at random and hope, every (type, page range) gets
// an exact POOL of the questions that are possible in that range
// (built once from the local ayah index, cached). Picking then
// samples from the pool and skips anything the caller says is off
// limits — so it's known EXACTLY when a type has run out, instead of
// guessing after N failed random tries. Picking stays "random page,
// then random ayah on that page" while plenty is left, i.e. the same
// distribution as before; a full sweep only happens near exhaustion.
// ============================================================
const TESTS_NO_REPEAT_WINDOW = 25;
const QUESTION_POOL_CACHE_MAX = 40;

function questionKey(type, ayahRef) { return `${type}|${ayahRef}`; }

function indexRange(lo, hi) {
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

async function buildQuestionPool(type, minP, maxP) {
  const all = await fetchLocalAyahIndex();

  const refsByPage = new Map();
  for (const a of all) {
    if (a.page < minP || a.page > maxP) continue;
    let list = refsByPage.get(a.page);
    if (!list) { list = []; refsByPage.set(a.page, list); }
    list.push(`${a.surah}:${a.ayah}`);
  }

  // Adjacent-page types only ever use pages whose neighbour is still
  // inside the range (same rule generateCard() always applied).
  const pageStart = (type === "prevPageFirst" || type === "pageStartToPrevLast") ? minP + 1 : minP;
  const pageEnd = (type === "nextPageFirst" || type === "pageEndToNextFirst") ? maxP - 1 : maxP;
  const isAdjacent = ADJACENT_TYPES.has(type);

  const pages = [];
  for (let page = pageStart; page <= pageEnd; page++) {
    const refs = refsByPage.get(page);
    if (!refs || !refs.length) continue;
    const n = refs.length;
    if (!isAdjacent && n < 2) continue; // pickQAFromPage() needs at least 2 ayahs on the page

    // Which ayahs of this page can be THE question ayah for this type —
    // mirrors exactly what pickQAFromPage()/pickAdjacentPageQA() pick from.
    let idxs;
    switch (type) {
      case "first":
      case "previous":
        idxs = indexRange(1, n - 1); break;
      case "last":
      case "next":
      case "listenNext":
        idxs = indexRange(0, n - 2); break;
      case "ayahCount":
      case "nextPageFirst":
      case "prevPageFirst":
      case "pageStartToPrevLast":
        idxs = [0]; break;
      case "pageEndToNextFirst":
        idxs = [n - 1]; break;
      default: // surah, pageNumber, juz, ayahNumber
        idxs = indexRange(0, n - 1);
    }
    if (!idxs.length) continue;
    pages.push(idxs.map((idx) => ({ page, idx, ref: refs[idx] })));
  }

  return { pages };
}

const questionPoolCache = new Map(); // "type|min|max" -> Promise<pool>
function getQuestionPool(type, minP, maxP) {
  const cacheKey = `${type}|${minP}|${maxP}`;
  if (questionPoolCache.has(cacheKey)) return questionPoolCache.get(cacheKey);

  const promise = buildQuestionPool(type, minP, maxP).catch((e) => {
    questionPoolCache.delete(cacheKey);
    throw e;
  });
  questionPoolCache.set(cacheKey, promise);
  if (questionPoolCache.size > QUESTION_POOL_CACHE_MAX) {
    questionPoolCache.delete(questionPoolCache.keys().next().value); // drop the oldest
  }
  return promise;
}

// Random unused entry from the pool, or null when nothing is left.
// `isExcluded(key)` says which questions are off limits right now.
function pickFromQuestionPool(pool, type, isExcluded) {
  if (!pool.pages.length) return null;

  // Fast path: random page, random ayah on it (the historical distribution).
  for (let i = 0; i < 40; i++) {
    const arr = pool.pages[randInt(0, pool.pages.length - 1)];
    const entry = arr[randInt(0, arr.length - 1)];
    if (!isExcluded(questionKey(type, entry.ref))) return entry;
  }

  // Near exhaustion: sweep everything so "nothing left" is exact.
  const free = [];
  for (const arr of pool.pages) {
    for (const entry of arr) {
      if (!isExcluded(questionKey(type, entry.ref))) free.push(entry);
    }
  }
  return free.length ? free[randInt(0, free.length - 1)] : null;
}

// Builds one complete, ready-to-show question (text + shuffled
// choices) that isn't in `excludeKeys` (a Set of questionKey()s, or
// null for no restriction). Resolves to:
//   { status: "ok", qa, built, page, key }
//   { status: "exhausted" } — every possible question of this type in
//                             this range is already excluded
//   { status: "error" }     — something else went wrong (bad page data etc.)
async function generateUniqueQuestion(type, minP, maxP, excludeKeys) {
  try {
    const pool = await getQuestionPool(type, minP, maxP);
    const rejected = new Set(); // entries that turned out unusable (bad data) — never retried
    const isExcluded = (key) => (excludeKeys && excludeKeys.has(key)) || rejected.has(key);

    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = pickFromQuestionPool(pool, type, isExcluded);
      if (!entry) return { status: "exhausted" };
      const key = questionKey(type, entry.ref);

      let qa = null;
      try {
        if (ADJACENT_TYPES.has(type)) {
          qa = await pickAdjacentPageQA(type, entry.page);
        } else {
          const ayahs = await fetchPageAyahs(entry.page);
          qa = pickQAFromPage(ayahs, type, entry.page, entry.idx);
        }
      } catch (e) {
        qa = null;
      }
      if (qa && !qa.q && !qa.audioOnly) qa = null;
      if (qa && !qa.a) qa = null;
      if (!qa) { rejected.add(key); continue; }

      const built = await buildChoices(qa, minP, maxP);
      if (!built || built.choices.length < 2 || built.correctIndex < 0) { rejected.add(key); continue; }

      return { status: "ok", qa, built, page: entry.page, key };
    }
    return { status: "error" };
  } catch (e) {
    return { status: "error" };
  }
}

// -------- 📝 اختبارات: no repeat within the next 25 questions --------
let recentTestKeys = []; // the last TESTS_NO_REPEAT_WINDOW question keys, oldest first

function rememberTestKey(key) {
  recentTestKeys.push(key);
  while (recentTestKeys.length > TESTS_NO_REPEAT_WINDOW) recentTestKeys.shift();
}

async function generateQuestionForTests(type, minP, maxP) {
  // Normally every recent question is excluded. If the range is so
  // small that a type has fewer questions than the window (e.g. 6
  // pages of "ayah count"), don't block the person — relax by
  // forgetting the OLDEST recent questions one at a time, so whatever
  // repeats is always the one asked longest ago.
  for (let start = 0; ; start++) {
    const excluded = new Set(recentTestKeys.slice(start));
    const gen = await generateUniqueQuestion(type, minP, maxP, excluded);
    if (gen.status !== "exhausted" || start >= recentTestKeys.length) return gen;
  }
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
  if (currentPage != null) viewPageInQuranBtn.style.display = "block";

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
      sessionId: null, // Tests screen no longer belongs to any session
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
  // Scroll the whole flashcard-wrap (range/score header, timer bar,
  // and the card) back into view on click — without this, someone who
  // scrolled down to read feedback on the previous question would
  // have to manually scroll back up to see the new one every time.
  homeFlashcardWrap.scrollIntoView({ behavior: "smooth", block: "start" });

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

    setStatus("جاري التحميل...");
    lockGenerate();

    // reset
    stopTimer();
    hideAudioButton();
    viewPageInQuranBtn.style.display = "none";
    flashcard.classList.remove("audio-question");
    mcqChoicesEl.innerHTML = "";
    answeredThisCard = false;
    hasActiveCard = false;
    currentCorrectIndex = -1;
    audioGateTimerPending = false;

    // Adjacent-page types stay strictly inside [minP, maxP], and no
    // question (same ayah + same type) repeats within the next 25 —
    // both handled by the pool behind generateQuestionForTests().
    const gen = await generateQuestionForTests(type, minP, maxP);
    if (gen.status !== "ok") {
      setCardText(qText, "تعذر إنشاء سؤال. جرّب نطاقًا أوسع أو نوعًا آخر.");
      mcqChoicesEl.innerHTML = "";
      setStatus("حصلت مشكلة. جرّب مرة ثانية.");
      unlockGenerate();
      return;
    }
    const { qa, built, page } = gen;
    rememberTestKey(gen.key);

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

    // Audio-only (listenNext) cards keep their choices locked until the
    // person actually listens (see renderChoices()'s locked param
    // above) — starting the countdown here would burn timer time
    // against someone who isn't even allowed to answer yet. The timer
    // instead starts the moment playback actually begins (see
    // playAudioBtn's click handler below).
    audioGateTimerPending = isAudioOnly;
    if (!isAudioOnly) startTimer();
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
  "first", "last", "previous", "next", "surah", "pageNumber", "ayahCount",
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
const challengeTypeIntro = document.getElementById("challengeTypeIntro");
const challengeTypeIntroLabel = document.getElementById("challengeTypeIntroLabel");
const challengeTypeIntroDesc = document.getElementById("challengeTypeIntroDesc");
const challengeTypeIntroCount = document.getElementById("challengeTypeIntroCount");
const challengeTypeIntroNotice = document.getElementById("challengeTypeIntroNotice");
const challengeTypeIntroContinueBtn = document.getElementById("challengeTypeIntroContinueBtn");
const challengeQuestionArea = document.getElementById("challengeQuestionArea");
const challengeProgressBar = document.getElementById("challengeProgressBar");
const challengeFlashcard = document.getElementById("challengeFlashcard");
const challengeFlashcardWrap = document.getElementById("challengeFlashcardWrap");
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
let challengeQueue = [];          // remaining question types, grouped into
                                   // same-type blocks (see buildChallengeQueue)
let challengeTotalQuestions = 0;
let challengeQuestionIndex = 0;
let challengeCountPerType = 5;
let challengeLastShownType = null;   // type of the last question actually shown
let challengeTypeBlockPosition = 0;  // 1-based position within the current type's block
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
let challengeUsedKeys = new Set();       // questionKey()s already asked THIS challenge — never repeated
let challengeExhaustedTypes = [];        // types that ran out of unused questions
let challengePendingNotice = "";         // shown once on the next type-intro screen

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
  if (type === "first" || type === "last") {
    const available = maxP - minP + 1;
    if (available < MIN_MCQ_ANSWERS) {
      const label = type === "first" ? "خمن الآية الأولى بالصفحة" : "خمن الآية الأخيرة بالصفحة";
      return rangeTooNarrowMessage(label, available, "صفحة", "صفحات");
    }
  }
  if (type === "ayahCount") {
    const available = maxP - minP + 1;
    if (available <= MIN_MCQ_ANSWERS) return rangeTooNarrowMessage("خمن كم عدد آيات الصفحة", available, "صفحة", "صفحات", MIN_MCQ_ANSWERS + 1);
  }
  if (type === "previous" || type === "next" || type === "listenNext") {
    const available = await ayahsCountInRange(minP, maxP);
    if (available < MIN_MCQ_ANSWERS) {
      return rangeTooNarrowMessage(getTypeLabel(type), available, "آية", "آيات");
    }
  }
  if (type === "ayahNumber") {
    const available = await ayahsCountInRange(minP, maxP);
    if (available <= MIN_AYAHNUMBER_ANSWERS) return rangeTooNarrowMessage("خمن رقم الآية بالسورة", available, "آية", "آيات", MIN_AYAHNUMBER_ANSWERS + 1);
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
// Groups questions into same-type blocks (e.g. all 5 "خمن السورة"
// questions back-to-back, then all 5 of the next type) rather than
// interleaving types randomly — so the group always knows what kind
// of question is coming for the next few rounds instead of it
// changing unpredictably every question. The block *order* is still
// shuffled each game.
function buildChallengeQueue(selectedTypes, countPerType) {
  const orderedTypes = shuffle(selectedTypes);
  const queue = [];
  orderedTypes.forEach((type) => {
    for (let i = 0; i < countPerType; i++) queue.push(type);
  });
  return queue;
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
  challengeCountPerType = count;
  challengeQueue = buildChallengeQueue(selectedTypes, count);
  challengeTotalQuestions = challengeQueue.length;
  challengeQuestionIndex = 0;
  challengeLastShownType = null;
  challengeTypeBlockPosition = 0;
  challengeUsedKeys = new Set();
  challengeExhaustedTypes = [];
  challengePendingNotice = "";

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

// Called between every question. Peeks at what type is coming up
// next — if it's a new block (different type than the last question
// shown), it shows the type-intro screen and waits for the group to
// hit "ابدأ هذا النوع" before generating anything or starting a timer.
// If it's the same block continuing, it goes straight to the next
// question, same as before.
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

  const nextType = challengeQueue[0];
  if (nextType !== challengeLastShownType) {
    showChallengeTypeIntro(nextType);
    return;
  }

  await proceedToChallengeQuestion();
}

function showChallengeTypeIntro(type) {
  challengeQuestionArea.style.display = "none";
  challengeTypeIntro.style.display = "block";
  challengeTypeIntro.scrollIntoView({ behavior: "smooth", block: "start" });
  challengeTypeIntroLabel.textContent = getTypeLabel(type);
  challengeTypeIntroDesc.textContent = getTypeDescription(type);
  const blockSize = challengeQueue.filter((t) => t === type).length;
  challengeTypeIntroCount.textContent = blockSize > 1 ? `${blockSize} أسئلة من هذا النوع` : "سؤال واحد من هذا النوع";

  if (challengePendingNotice) {
    challengeTypeIntroNotice.textContent = challengePendingNotice;
    challengeTypeIntroNotice.style.display = "block";
    challengePendingNotice = "";
  } else {
    challengeTypeIntroNotice.style.display = "none";
  }
}

challengeTypeIntroContinueBtn.addEventListener("click", async () => {
  challengeTypeIntro.style.display = "none";
  challengeQuestionArea.style.display = "block";
  await proceedToChallengeQuestion();
});

// Generates and shows the next question in the queue. Retries a few
// times on a transient generation failure (same class of failure
// solo mode can hit — e.g. a page with too few ayahs for a given
// type); if it still can't produce one, it discards that slot and
// falls back through nextChallengeQuestion() so a type-intro still
// shows if the failure happened to be the last question of its block.
async function proceedToChallengeQuestion() {
  challengeFlashcardWrap.scrollIntoView({ behavior: "smooth", block: "start" });

  challengeQuestionIndex++;
  const type = challengeQueue.shift();
  const prevBlockPosition = challengeTypeBlockPosition;
  const prevLastShownType = challengeLastShownType;
  challengeTypeBlockPosition = (type === challengeLastShownType) ? challengeTypeBlockPosition + 1 : 1;
  challengeLastShownType = type;
  challengeProgressLabel.textContent =
    `سؤال ${challengeQuestionIndex} من ${challengeTotalQuestions} (${challengeTypeBlockPosition}/${challengeCountPerType} لهذا النوع)`;

  // Never repeats a question (same ayah + same type) within a challenge.
  const gen = await generateUniqueQuestion(type, challengeRangeMinP, challengeRangeMaxP, challengeUsedKeys);
  if (gen.status !== "ok") {
    // This slot never became a real question — undo its numbering.
    challengeQuestionIndex--;
    challengeTypeBlockPosition = prevBlockPosition;
    challengeLastShownType = prevLastShownType;

    let removed = 1;
    if (gen.status === "exhausted") {
      // Nothing unused left for this type in this range: drop the rest
      // of its questions rather than repeat one.
      const before = challengeQueue.length;
      challengeQueue = challengeQueue.filter((t) => t !== type);
      removed += before - challengeQueue.length;
      if (!challengeExhaustedTypes.includes(type)) challengeExhaustedTypes.push(type);
      challengePendingNotice = `نفدت الأسئلة المتاحة من نوع «${getTypeLabel(type)}» في هذا النطاق دون تكرار، لذلك تم تخطي بقية أسئلة هذا النوع.`;
    }
    challengeTotalQuestions = Math.max(challengeQuestionIndex, challengeTotalQuestions - removed);
    await nextChallengeQuestion();
    return;
  }
  challengeUsedKeys.add(gen.key);
  const { qa, built } = gen;

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

  const exhaustedNoteHtml = challengeExhaustedTypes.length
    ? `<div class="challenge-notice">نفدت الأسئلة المتاحة (دون تكرار) من: ${escapeChallengeHtml(challengeExhaustedTypes.map(getTypeLabel).join("، "))} — لذلك جاء التحدي أقصر من المخطط.</div>`
    : "";

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
    <div class="stat-rows">${rowsHtml}</div>${exhaustedNoteHtml}`;
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

// ============================================================
// Online duels (⚔️ تحديات → مباشر) — 1v1 live challenges against a
// friend or a random matched opponent. Requires an account. See
// supabase-client.js for the RPC/realtime/presence wrappers this
// uses, supabase-schema.sql sections 16–29 for the tables/RPCs, and
// supabase/functions/generate-duel-questions for how the shared
// question set gets built without either player's browser seeing the
// answers first.
// ============================================================

const challengeModeToggle = document.getElementById("challengeModeToggle");
const challengeOfflineWrap = document.getElementById("challengeOfflineWrap");
const challengeOnlineWrap = document.getElementById("challengeOnlineWrap");
const challengeSelfWrap = document.getElementById("challengeSelfWrap");

const duelGuestNotice = document.getElementById("duelGuestNotice");
const duelHubSection = document.getElementById("duelHubSection");
const duelConfigSection = document.getElementById("duelConfigSection");
const duelWaitingSection = document.getElementById("duelWaitingSection");
const duelPlaySection = document.getElementById("duelPlaySection");
const duelResultsSection = document.getElementById("duelResultsSection");

const duelStatsSummary = document.getElementById("duelStatsSummary");
const duelFriendsList = document.getElementById("duelFriendsList");
const duelQuickMatchBtn = document.getElementById("duelQuickMatchBtn");
const duelOnlineList = document.getElementById("duelOnlineList");

const duelConfigBackBtn = document.getElementById("duelConfigBackBtn");
const duelConfigTitle = document.getElementById("duelConfigTitle");
const duelRangeSelect = document.getElementById("duelRangeSelect");
const duelTimerSelect = document.getElementById("duelTimerSelect");
const duelCustomRangeRow = document.getElementById("duelCustomRangeRow");
const duelCustomMin = document.getElementById("duelCustomMin");
const duelCustomMax = document.getElementById("duelCustomMax");
const duelTypesGrid = document.getElementById("duelTypesGrid");
const duelCountSelect = document.getElementById("duelCountSelect");
const duelSubmitBtn = document.getElementById("duelSubmitBtn");
const duelConfigError = document.getElementById("duelConfigError");

const duelWaitingTitle = document.getElementById("duelWaitingTitle");
const duelWaitingDesc = document.getElementById("duelWaitingDesc");
const duelWaitingCancelBtn = document.getElementById("duelWaitingCancelBtn");

const duelProgressLabel = document.getElementById("duelProgressLabel");
const duelScoreboard = document.getElementById("duelScoreboard");
const duelTypeIntro = document.getElementById("duelTypeIntro");
const duelTypeIntroLabel = document.getElementById("duelTypeIntroLabel");
const duelTypeIntroCountdown = document.getElementById("duelTypeIntroCountdown");
const duelQuestionArea = document.getElementById("duelQuestionArea");
const duelProgressBar = document.getElementById("duelProgressBar");
const duelFlashcard = document.getElementById("duelFlashcard");
const duelFlashcardWrap = document.getElementById("duelFlashcardWrap");
const duelCardHelp = document.getElementById("duelCardHelp");
const duelQText = document.getElementById("duelQText");
const duelMcqChoices = document.getElementById("duelMcqChoices");
const duelPlayAudioBtn = document.getElementById("duelPlayAudioBtn");
const duelRoundStatus = document.getElementById("duelRoundStatus");
const duelForfeitBtn = document.getElementById("duelForfeitBtn");

const duelResultsBody = document.getElementById("duelResultsBody");
const duelRematchBtn = document.getElementById("duelRematchBtn");
const duelBackToHubBtn = document.getElementById("duelBackToHubBtn");

// -------- state --------
let duelId = null;
let duelIsHost = false;
let duelOpponentId = null;
let duelOpponentName = "الخصم";
let duelLastConfig = null; // { rangeMin, rangeMax, timerSeconds, questionTypes, countPerType } — set on finish, used by the rematch button
let duelConfigContext = null; // { kind: 'friend'|'direct', friendId, friendName } | { kind: 'quickmatch' }
let duelStateChannel = null;
let duelCurrentQuestion = null;
let duelAnswered = false;
let duelAdvancePending = false;
let duelTimerInterval = null;
let duelTypeIntroTimer = null;
let duelWaitingPollInterval = null;
let duelWaitingCancelHandler = null;
let duelAudioEl = null;
let duelValidationToken = 0;
let myDisplayNameCache = null;
let myFriendIdsCache = new Set(); // friend user ids, refreshed each hub visit
let knownAchievementCodesCache = null; // seeded at sign-in — see initKnownAchievementCache()

function escapeDuelHtml(str) {
  return (str || "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function getMyDisplayName() {
  if (myDisplayNameCache) return myDisplayNameCache;
  const profile = (typeof fetchProfile === "function") ? await fetchProfile() : null;
  myDisplayNameCache = profile?.display_name || "لاعب";
  return myDisplayNameCache;
}

async function resolveDuelOpponentName(duel) {
  if (duel.opponent_display_name) return duel.opponent_display_name; // already joined (my_active_duels)
  const otherId = duel.created_by === currentUser.id ? duel.opponent_id : duel.created_by;
  const name = (typeof fetchDisplayName === "function") ? await fetchDisplayName(otherId) : null;
  return name || "الخصم";
}

function resolveDuelOpponentId(duel) {
  return duel.created_by === currentUser.id ? duel.opponent_id : duel.created_by;
}

// -------- محلي/مباشر/ذاتي mode toggle --------
challengeModeToggle.querySelectorAll(".challenge-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    challengeModeToggle.querySelectorAll(".challenge-mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    challengeOfflineWrap.style.display = mode === "offline" ? "block" : "none";
    challengeOnlineWrap.style.display = mode === "online" ? "block" : "none";
    challengeSelfWrap.style.display = mode === "self" ? "block" : "none";
    if (mode === "online") enterOnlineDuelMode();
    else switchDuelScreen(null);
    if (mode === "self") enterSelfChallengeMode();
  });
});

// -------- screen switching (hub / config / waiting / play / results) --------
const duelScreens = {
  guest: duelGuestNotice,
  hub: duelHubSection,
  config: duelConfigSection,
  waiting: duelWaitingSection,
  play: duelPlaySection,
  results: duelResultsSection,
};

function switchDuelScreen(name) {
  Object.entries(duelScreens).forEach(([key, el]) => {
    el.style.display = key === name ? "block" : "none";
  });

  if (name === "hub" && currentUser) {
    getMyDisplayName().then((myName) => {
      if (typeof joinOnlineLobby === "function") joinOnlineLobby(myName, renderDuelOnlineList);
    });
  } else if (typeof leaveOnlineLobby === "function") {
    leaveOnlineLobby();
  }

  if (name !== "waiting" && duelWaitingPollInterval) {
    clearInterval(duelWaitingPollInterval);
    duelWaitingPollInterval = null;
  }
}

function showDuelWaiting(title, desc, onCancel, cancelLabel) {
  duelWaitingTitle.textContent = title;
  duelWaitingDesc.textContent = desc;
  duelWaitingCancelHandler = onCancel;
  duelWaitingCancelBtn.textContent = cancelLabel || "إلغاء";
  duelWaitingCancelBtn.style.display = onCancel ? "" : "none";
  switchDuelScreen("waiting");
}

duelWaitingCancelBtn.addEventListener("click", () => {
  if (duelWaitingCancelHandler) duelWaitingCancelHandler();
});

// -------- entering online mode --------
async function enterOnlineDuelMode() {
  if (!currentUser) {
    switchDuelScreen("guest");
    return;
  }

  // Pull-based fallback (in case the realtime channel wasn't
  // connected at the moment something happened — e.g. a page reload
  // mid-duel, or an invite that arrived before this tab was opened).
  const activeDuels = (typeof fetchMyActiveDuels === "function") ? await fetchMyActiveDuels() : [];
  if (activeDuels && activeDuels.length) {
    await resumeDuel(activeDuels[0]);
    return;
  }

  const invites = (typeof fetchMyIncomingDuelInvites === "function") ? await fetchMyIncomingDuelInvites() : [];
  const pending = invites.find((i) => i.status === "pending" || i.status === "accepted");
  if (pending && typeof renderDuelInviteBanner === "function") {
    renderDuelInviteBanner(pending);
  }

  await loadDuelHub();
  switchDuelScreen("hub");
}

async function resumeDuel(duel) {
  duelId = duel.id;
  duelIsHost = duel.created_by === currentUser.id;
  duelOpponentId = resolveDuelOpponentId(duel);
  duelOpponentName = await resolveDuelOpponentName(duel);

  if (duel.status === "accepted") {
    if (duelIsHost) {
      showDuelWaiting("جارٍ التحضير", "جارٍ تحضير الأسئلة...", null);
      await hostGenerateQuestionsAndWatch(duel.id);
    } else {
      showDuelWaiting("بانتظار المضيف", `بانتظار ${duelOpponentName} لتحضير الأسئلة...`, forfeitWhileWaiting, "استسلام");
      beginDuelStateWatch(duel.id, onGuestWaitingForQuestions);
    }
  } else if (duel.status === "active") {
    await enterDuelPlay(duel);
  }
}

// -------- hub: stats, friends, online-now list --------
async function loadDuelHub() {
  const stats = await fetchDuelStats(currentUser.id);
  renderDuelStatsSummary(stats);
  await loadDuelFriendsList();
}

function renderDuelStatsSummary(stats) {
  duelStatsSummary.innerHTML = `
    <span class="duel-stat-pill wins">🏆 ${stats?.wins || 0} فوز</span>
    <span class="duel-stat-pill losses">💔 ${stats?.losses || 0} خسارة</span>
    <span class="duel-stat-pill">🤝 ${stats?.draws || 0} تعادل</span>`;
}

async function loadDuelFriendsList() {
  duelFriendsList.innerHTML = '<div class="status">جاري التحميل...</div>';
  const friends = (typeof fetchMyFriends === "function") ? await fetchMyFriends() : [];
  myFriendIdsCache = new Set(friends.map((f) => f.friend_user_id));

  if (!friends.length) {
    duelFriendsList.innerHTML = '<div class="status">لا يوجد أصدقاء بعد. أضف أصدقاء من «👥 أصدقائي» أو من قائمة المتصلين أدناه.</div>';
    return;
  }
  duelFriendsList.innerHTML = friends
    .map((f) => `
      <div class="duel-person-row" data-user-id="${f.friend_user_id}" data-name="${escapeDuelHtml(f.friend_display_name)}">
        <span class="duel-person-name">${escapeDuelHtml(f.friend_display_name)}</span>
        <button type="button" class="btn small challenge-duel-friend-btn">⚔️ تحدَّ</button>
      </div>`)
    .join("");

  duelFriendsList.querySelectorAll(".challenge-duel-friend-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".duel-person-row");
      openDuelConfig({ kind: "friend", friendId: row.dataset.userId, friendName: row.dataset.name });
    });
  });
}

// Shared by the online-now list and the live duel scoreboard — sends
// a friend request straight from a user id (see
// send_friend_request_by_user_id() in supabase-schema.sql), no
// friend_code exchange needed since we already know exactly who this
// is (they're either present right now, or actively duelling us).
async function addFriendFromDuel(userId, btnEl) {
  if (!userId || (typeof sendFriendRequestByUserId !== "function")) return;
  btnEl.disabled = true;
  const result = await sendFriendRequestByUserId(userId);
  if (result?.ok) {
    btnEl.textContent = result.status === "accepted" ? "أصبحتما صديقين! ✓" : "تم الإرسال ✓";
    myFriendIdsCache.add(userId);
  } else if (result?.error === "already_accepted" || result?.error === "already_pending") {
    btnEl.textContent = "تم الإرسال بالفعل";
    myFriendIdsCache.add(userId);
  } else {
    btnEl.disabled = false;
    btnEl.textContent = "+ صديق";
    alert("تعذّر إرسال طلب الصداقة.");
  }
}

function renderDuelOnlineList(people) {
  if (!people || !people.length) {
    duelOnlineList.innerHTML = '<div class="status">لا أحد متصل الآن.</div>';
    return;
  }
  duelOnlineList.innerHTML = people
    .map((p) => {
      const alreadyFriend = myFriendIdsCache.has(p.userId);
      return `
      <div class="duel-person-row" data-user-id="${p.userId}" data-name="${escapeDuelHtml(p.display_name)}">
        <span class="duel-person-name"><span class="duel-online-dot"></span>${escapeDuelHtml(p.display_name)}</span>
        <span class="duel-person-actions">
          ${alreadyFriend ? "" : '<button type="button" class="btn small ghost duel-add-friend-btn">+ صديق</button>'}
          <button type="button" class="btn small challenge-duel-online-btn">⚔️ تحدَّ</button>
        </span>
      </div>`;
    })
    .join("");

  duelOnlineList.querySelectorAll(".challenge-duel-online-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".duel-person-row");
      openDuelConfig({ kind: "direct", friendId: row.dataset.userId, friendName: row.dataset.name });
    });
  });

  duelOnlineList.querySelectorAll(".duel-add-friend-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".duel-person-row");
      addFriendFromDuel(row.dataset.userId, btn);
    });
  });
}

duelQuickMatchBtn.addEventListener("click", () => openDuelConfig({ kind: "quickmatch" }));

// -------- config form (shared by friend / direct / quick-match) --------
function openDuelConfig(context) {
  duelConfigContext = context;
  if (context.kind === "quickmatch") {
    duelConfigTitle.textContent = "مباراة سريعة";
    duelSubmitBtn.textContent = "ابحث عن خصم";
  } else {
    duelConfigTitle.textContent = `تحدَّ ${context.friendName}`;
    duelSubmitBtn.textContent = "إرسال التحدي";
  }
  switchDuelScreen("config");
  refreshDuelConfigAvailability();
}

duelConfigBackBtn.addEventListener("click", () => switchDuelScreen("hub"));

function showHideDuelCustomRange() {
  duelCustomRangeRow.style.display = duelRangeSelect.value === "custom" ? "flex" : "none";
}
duelRangeSelect.addEventListener("change", () => { showHideDuelCustomRange(); refreshDuelConfigAvailability(); });
[duelCustomMin, duelCustomMax].forEach((el) => el.addEventListener("change", refreshDuelConfigAvailability));

function renderDuelTypesGrid() {
  duelTypesGrid.innerHTML = "";
  CHALLENGE_TYPES.forEach((type) => {
    const label = document.createElement("label");
    label.className = "challenge-type-chip";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = type;
    cb.addEventListener("change", () => {
      label.classList.toggle("checked", cb.checked);
      refreshDuelConfigAvailability();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(getTypeLabel(type)));
    duelTypesGrid.appendChild(label);
  });
}

function getSelectedDuelTypes() {
  return Array.from(duelTypesGrid.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
}

// Reuses the same coverage checks the offline setup screen uses
// (challengeTypeBlockMessage — no mistake-review coupling), just
// against the duel's own range picker.
async function refreshDuelConfigAvailability() {
  const myToken = ++duelValidationToken;
  const selectedTypes = getSelectedDuelTypes();
  let msg = "";
  if (selectedTypes.length < CHALLENGE_MIN_TYPES) msg = `اختر ${CHALLENGE_MIN_TYPES} أنواع أسئلة على الأقل.`;

  if (!msg) {
    const range = resolveRangeBounds(duelRangeSelect.value, duelCustomMin.value, duelCustomMax.value);
    for (const type of selectedTypes) {
      const blocked = await challengeTypeBlockMessage(type, range.minP, range.maxP);
      if (blocked) { msg = `"${getTypeLabel(type)}": ${blocked}`; break; }
    }
  }

  if (myToken !== duelValidationToken) return;
  duelConfigError.textContent = msg;
  duelSubmitBtn.disabled = !!msg;
}

async function createDuelForContext(context, range, timerSeconds, types, count) {
  if (context.kind === "friend") {
    return await createFriendDuel(context.friendId, range.minP, range.maxP, timerSeconds, types, count);
  }
  if (context.kind === "direct") {
    return await createDirectDuel(context.friendId, range.minP, range.maxP, timerSeconds, types, count);
  }
  return null;
}

duelSubmitBtn.addEventListener("click", async () => {
  const selectedTypes = getSelectedDuelTypes();
  const range = resolveRangeBounds(duelRangeSelect.value, duelCustomMin.value, duelCustomMax.value);
  const timerSeconds = parseInt(duelTimerSelect.value, 10) || 15;
  const count = parseInt(duelCountSelect.value, 10) || 5;

  duelSubmitBtn.disabled = true;

  if (duelConfigContext.kind === "quickmatch") {
    const result = await joinQuickMatchQueue(range.minP, range.maxP, timerSeconds, selectedTypes, count);
    duelSubmitBtn.disabled = false;

    if (result.matched) {
      const duel = await fetchDuelState(result.duelId);
      duelId = result.duelId;
      duelIsHost = true;
      duelOpponentId = duel ? resolveDuelOpponentId(duel) : null;
      duelOpponentName = duel ? await resolveDuelOpponentName(duel) : "الخصم";
      showDuelWaiting("جارٍ التحضير", "تم إيجاد خصم! جارٍ تحضير الأسئلة...", null);
      await hostGenerateQuestionsAndWatch(result.duelId);
    } else {
      showDuelWaiting("جارٍ البحث", "جارٍ البحث عن خصم بنفس الإعدادات بالضبط...", leaveQueueAndReturn, "إلغاء البحث");
      startQuickMatchWaitPoll();
    }
    return;
  }

  const newId = await createDuelForContext(duelConfigContext, range, timerSeconds, selectedTypes, count);
  duelSubmitBtn.disabled = false;
  if (!newId) {
    alert("تعذّر إرسال التحدي. حاول مرة أخرى.");
    return;
  }
  duelId = newId;
  duelIsHost = true;
  duelOpponentId = duelConfigContext.friendId;
  duelOpponentName = duelConfigContext.friendName;
  showDuelWaiting("بانتظار الرد", `بانتظار موافقة ${duelConfigContext.friendName} على التحدي...`, cancelWaitingDuel);
  beginDuelStateWatch(newId, onHostWaitingForAcceptance);
});

async function cancelWaitingDuel() {
  stopQuickMatchWaitPoll();
  if (duelId) await cancelDuel(duelId);
  teardownDuelStateWatch();
  duelId = null;
  switchDuelScreen("hub");
}

async function leaveQueueAndReturn() {
  stopQuickMatchWaitPoll();
  await leaveQuickMatchQueue();
  switchDuelScreen("hub");
}

// Backing out after already accepting counts as a forfeit (a real
// opponent is committed on the other end) — cancelDuel() only works
// for the still-uncommitted 'pending' stage, which is why the host's
// own pre-acceptance cancel above uses that instead.
async function forfeitWhileWaiting() {
  stopQuickMatchWaitPoll();
  if (duelId) await forfeitDuel(duelId);
  teardownDuelStateWatch();
  duelId = null;
  switchDuelScreen("hub");
}

// -------- realtime state watching while pending/waiting --------
function beginDuelStateWatch(id, onChange) {
  teardownDuelStateWatch();
  duelStateChannel = subscribeToDuelState(id, onChange);
}
function teardownDuelStateWatch() {
  if (duelStateChannel) {
    unsubscribeFromDuelState(duelStateChannel);
    duelStateChannel = null;
  }
}

async function onHostWaitingForAcceptance(duel) {
  if (duel.status === "accepted") {
    showDuelWaiting("جارٍ التحضير", "تم القبول! جارٍ تحضير الأسئلة...", null);
    await hostGenerateQuestionsAndWatch(duel.id);
  } else if (duel.status === "declined") {
    teardownDuelStateWatch();
    alert(`${duelOpponentName} رفض التحدي.`);
    duelId = null;
    switchDuelScreen("hub");
  } else if (duel.status === "cancelled") {
    teardownDuelStateWatch();
    duelId = null;
    switchDuelScreen("hub");
  }
}

async function onGuestWaitingForQuestions(duel) {
  if (duel.status === "active") {
    teardownDuelStateWatch();
    const fresh = await fetchDuelState(duel.id);
    await enterDuelPlay(fresh);
  } else if (duel.status === "cancelled" || duel.status === "finished") {
    teardownDuelStateWatch();
    duelId = null;
    switchDuelScreen("hub");
  }
}

async function hostGenerateQuestionsAndWatch(id) {
  teardownDuelStateWatch();
  const result = await generateDuelQuestions(id);
  if (!result || !result.ok) {
    alert("تعذّر تحضير أسئلة التحدي. حاول مرة أخرى لاحقًا.");
    duelId = null;
    switchDuelScreen("hub");
    return;
  }
  const duel = await fetchDuelState(id);
  if (duel && duel.status === "active") {
    await enterDuelPlay(duel);
  } else {
    switchDuelScreen("hub");
  }
}

// Defensive fallback for the side still waiting in the quick-match
// queue, in case the realtime "you've been matched" notification
// (which arrives via the same channel as friend invites) doesn't land.
function startQuickMatchWaitPoll() {
  stopQuickMatchWaitPoll();
  duelWaitingPollInterval = setInterval(async () => {
    const active = await fetchMyActiveDuels();
    if (!active || !active.length) return;
    stopQuickMatchWaitPoll();
    await resumeDuel(active[0]);
  }, 4000);
}
function stopQuickMatchWaitPoll() {
  if (duelWaitingPollInterval) {
    clearInterval(duelWaitingPollInterval);
    duelWaitingPollInterval = null;
  }
}

// -------- live play --------
async function enterDuelPlay(duel) {
  duelId = duel.id;
  duelIsHost = duel.created_by === currentUser.id;
  duelOpponentId = resolveDuelOpponentId(duel);
  if (!duelOpponentName || duelOpponentName === "الخصم") {
    duelOpponentName = await resolveDuelOpponentName(duel);
  }

  switchDuelScreen("play");
  renderDuelScoreboard(duel);
  beginDuelStateWatch(duel.id, onDuelStateChangedDuringPlay);
  await loadDuelCurrentQuestion(duel);
}

function renderDuelScoreboard(duel) {
  const myScore = duelIsHost ? duel.creator_score : duel.opponent_score;
  const oppScore = duelIsHost ? duel.opponent_score : duel.creator_score;
  const alreadyFriend = duelOpponentId && myFriendIdsCache.has(duelOpponentId);
  const addFriendHtml = (!alreadyFriend && duelOpponentId)
    ? `<button type="button" id="duelAddFriendBtn" class="btn small ghost duel-scoreboard-add-friend">+ صديق</button>`
    : "";

  duelScoreboard.innerHTML = `
    <div class="duel-score-side me">
      <div class="duel-score-side-name">أنت</div>
      <div class="duel-score-side-points">${myScore}</div>
    </div>
    <div class="duel-score-vs">VS</div>
    <div class="duel-score-side opponent">
      <div class="duel-score-side-name">${escapeDuelHtml(duelOpponentName)}</div>
      <div class="duel-score-side-points">${oppScore}</div>
      ${addFriendHtml}
    </div>`;
  duelProgressLabel.textContent = `سؤال ${duel.current_question_index + 1} من ${duel.total_questions}`;

  const addBtn = document.getElementById("duelAddFriendBtn");
  if (addBtn) addBtn.addEventListener("click", () => addFriendFromDuel(duelOpponentId, addBtn));
}

async function onDuelStateChangedDuringPlay(duel) {
  if (duel.status === "finished") {
    teardownDuelStateWatch();
    await showDuelResults(duel);
    return;
  }

  renderDuelScoreboard(duel);

  if (duel.current_question_index !== (duelCurrentQuestion?.question_index ?? -1)) {
    await loadDuelCurrentQuestion(duel);
  }
}

async function loadDuelCurrentQuestion(duel) {
  duelFlashcardWrap.scrollIntoView({ behavior: "smooth", block: "start" });

  duelAnswered = false;
  duelRoundStatus.style.display = "none";
  stopDuelTimer();
  stopDuelTypeIntroCountdown();
  duelAudioStop();

  const q = await fetchDuelQuestion(duel.id, duel.current_question_index);
  if (!q) {
    setTimeout(() => loadDuelCurrentQuestion(duel), 800); // transient fetch hiccup — retry shortly
    return;
  }
  duelCurrentQuestion = q;

  // advance_duel_question() (and the Edge Function, for question 1)
  // sets current_question_revealed_at a few seconds in the future
  // whenever the type is about to change, specifically so both
  // players get a synced beat to notice the new type before the
  // timer starts — same idea as offline mode's type-intro screen,
  // just without needing a mutual "ready" handshake since both
  // clients compute this identically off the same server timestamp.
  const revealedAt = duel.current_question_revealed_at ? new Date(duel.current_question_revealed_at).getTime() : Date.now();
  const preRollMs = revealedAt - Date.now();

  if (preRollMs > 250) {
    showDuelTypeIntro(q.question_type, preRollMs, () => {
      revealDuelQuestionCard(q);
      startDuelTimer(duel);
    });
  } else {
    revealDuelQuestionCard(q);
    startDuelTimer(duel);
  }
}

function showDuelTypeIntro(type, preRollMs, onDone) {
  duelQuestionArea.style.display = "none";
  duelTypeIntro.style.display = "block";
  duelTypeIntroLabel.textContent = getTypeLabel(type);

  stopDuelTypeIntroCountdown();
  const endsAt = Date.now() + preRollMs;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    duelTypeIntroCountdown.textContent = remaining > 0 ? `يبدأ خلال ${remaining}...` : "الآن!";
    if (Date.now() >= endsAt) {
      stopDuelTypeIntroCountdown();
      onDone();
    }
  };
  duelTypeIntroTimer = setInterval(tick, 200);
  tick();
}

function stopDuelTypeIntroCountdown() {
  if (duelTypeIntroTimer) { clearInterval(duelTypeIntroTimer); duelTypeIntroTimer = null; }
}

function revealDuelQuestionCard(q) {
  duelTypeIntro.style.display = "none";
  duelQuestionArea.style.display = "block";

  duelFlashcard.classList.toggle("audio-question", !!q.is_audio_only);
  duelCardHelp.textContent = `النوع: ${getTypeLabel(q.question_type)}`;
  setCardText(duelQText, q.is_audio_only ? "🎧 اضغط زر الاستماع لسماع الآية" : q.q_text);
  renderDuelChoices(q.choices, !!q.is_audio_only);
  duelPlayAudioBtn.style.display = q.q_ayah_number ? "inline-flex" : "none";
}

// `locked` mirrors solo mode's renderChoices()/isAudioOnly handling —
// without it, a listenNext duel question could be answered blind,
// which both defeats the point of that question type and hands an
// unfair speed advantage in a first-correct-wins race to whoever
// skips listening.
function renderDuelChoices(choices, locked) {
  duelMcqChoices.innerHTML = "";
  choices.forEach((choiceText, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mcq-choice" + (locked ? " locked" : "");
    btn.textContent = choiceText;
    btn.style.fontSize = choiceFontSize(choiceText);
    btn.dataset.index = String(idx);
    if (locked) btn.disabled = true;
    duelMcqChoices.appendChild(btn);
  });
}

function lockDuelChoices() {
  Array.from(duelMcqChoices.children).forEach((btn) => { btn.disabled = true; });
}
function unlockDuelChoices() {
  Array.from(duelMcqChoices.children).forEach((btn) => { btn.disabled = false; });
}
// Releases the listen-gate specifically (as opposed to unlockDuelChoices()
// above, which is the post-answer-failure recovery path) — same split
// solo mode makes between unlockChoicesAfterListening() and the plain
// enable/disable used elsewhere.
function unlockDuelChoicesAfterListening() {
  const buttons = Array.from(duelMcqChoices.querySelectorAll(".mcq-choice.locked"));
  buttons.forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove("locked");
  });
}
function highlightDuelChoice(chosenIdx, isCorrect) {
  Array.from(duelMcqChoices.children).forEach((btn, idx) => {
    if (idx === chosenIdx) btn.classList.add(isCorrect ? "correct" : "wrong");
  });
}

duelMcqChoices.addEventListener("click", (e) => {
  const btn = e.target.closest(".mcq-choice");
  if (!btn || btn.disabled || duelAnswered) return;
  submitMyDuelAnswer(Number(btn.dataset.index));
});

async function submitMyDuelAnswer(choiceIndex) {
  if (duelAnswered || !duelCurrentQuestion) return;
  duelAnswered = true;
  lockDuelChoices();

  const questionIndex = duelCurrentQuestion.question_index;
  const result = await submitDuelAnswer(duelId, questionIndex, choiceIndex);

  if (!result || !result.ok) {
    duelAnswered = false; // transient failure — allow retry
    unlockDuelChoices();
    return;
  }

  highlightDuelChoice(choiceIndex, result.isCorrect);
  showDuelRoundStatus(result);

  // Only advance once the round is actually decided: either I just
  // won the point, or both players have now answered and neither got
  // it right (bothAnswered — see submit_duel_answer() in
  // supabase-schema.sql). If I answered wrong and the opponent hasn't
  // answered yet, wait — their eventual answer (whichever way it
  // goes) or the shared timer will move things along instead, so a
  // lone wrong guess can no longer cut off the other player's turn.
  if (result.wonPoint || result.bothAnswered) {
    setTimeout(() => tryAdvanceDuelQuestion(questionIndex), 1400);
  }
}

function showDuelRoundStatus(result) {
  duelRoundStatus.style.display = "block";
  duelRoundStatus.className = "duel-round-status";
  if (result.timeout) {
    duelRoundStatus.classList.add("timeout");
    duelRoundStatus.textContent = "⏱️ انتهى الوقت.";
  } else if (result.wonPoint) {
    duelRoundStatus.classList.add("won");
    duelRoundStatus.textContent = "🎉 أحسنت! أنت الأسرع.";
  } else if (result.isCorrect) {
    duelRoundStatus.classList.add("waiting");
    duelRoundStatus.textContent = "✅ إجابة صحيحة، لكن الخصم كان أسرع.";
  } else if (result.bothAnswered) {
    duelRoundStatus.classList.add("lost");
    duelRoundStatus.textContent = "❌ لم يُجب أحدكما بشكل صحيح.";
  } else {
    duelRoundStatus.classList.add("waiting");
    duelRoundStatus.textContent = "❌ إجابة خاطئة — بانتظار الخصم...";
  }
}

function startDuelTimer(duel) {
  stopDuelTimer();
  const sec = duel.timer_seconds || 15;
  const revealedAt = duel.current_question_revealed_at ? new Date(duel.current_question_revealed_at).getTime() : Date.now();
  const durationMs = sec * 1000;

  const tick = () => {
    const elapsed = Date.now() - revealedAt;
    const pct = clamp((elapsed / durationMs) * 100, 0, 100);
    duelProgressBar.style.width = pct + "%";
    if (elapsed >= durationMs) {
      stopDuelTimer();
      if (!duelAnswered) {
        duelAnswered = true;
        lockDuelChoices();
        showDuelRoundStatus({ isCorrect: false, wonPoint: false, timeout: true });
      }
      // The shared fallback: even if a wrong answer is deliberately
      // not advancing the round (see submitMyDuelAnswer above), the
      // timer running out on either client always does — so there's
      // no permanent deadlock if the opponent never answers.
      tryAdvanceDuelQuestion(duel.current_question_index);
    }
  };

  duelTimerInterval = setInterval(tick, 150);
  tick();
}

function stopDuelTimer() {
  if (duelTimerInterval) { clearInterval(duelTimerInterval); duelTimerInterval = null; }
  duelProgressBar.style.width = "0%";
}

async function tryAdvanceDuelQuestion(questionIndex) {
  if (duelAdvancePending) return;
  duelAdvancePending = true;
  try {
    await advanceDuelQuestion(duelId, questionIndex);
    // No need to act on the result — the realtime subscription
    // (onDuelStateChangedDuringPlay) delivers the new question index
    // (or 'finished' status) to both players uniformly.
  } finally {
    duelAdvancePending = false;
  }
}

function duelAudioStop() {
  if (duelAudioEl) { duelAudioEl.pause(); duelAudioEl.currentTime = 0; duelAudioEl = null; }
  duelPlayAudioBtn.textContent = "🔊 استماع";
  duelPlayAudioBtn.classList.remove("playing");
}

duelPlayAudioBtn.addEventListener("click", async () => {
  if (duelAudioEl && !duelAudioEl.paused) { duelAudioStop(); return; }
  if (!duelCurrentQuestion?.q_ayah_number) return;

  duelPlayAudioBtn.disabled = true;
  duelPlayAudioBtn.textContent = "⏳ جارٍ التحميل...";
  try {
    const url = await fetchAyahAudioUrl(duelCurrentQuestion.q_ayah_number);
    if (!url) throw new Error("no audio url");
    duelAudioEl = new Audio(url);
    duelAudioEl.addEventListener("ended", duelAudioStop);
    await duelAudioEl.play();
    duelPlayAudioBtn.textContent = "⏸️ إيقاف";
    duelPlayAudioBtn.classList.add("playing");
    unlockDuelChoicesAfterListening();
  } catch (e) {
    duelAudioStop();
  } finally {
    duelPlayAudioBtn.disabled = false;
  }
});

duelForfeitBtn.addEventListener("click", async () => {
  if (!duelId) return;
  const ok = confirm("هل تريد الاستسلام؟ ستُحتسب هذه خسارة.");
  if (!ok) return;
  await forfeitDuel(duelId);
  // realtime subscription picks up status='finished' → shows results
});

const duelClaimForfeitBtn = document.getElementById("duelClaimForfeitBtn");
duelClaimForfeitBtn.addEventListener("click", async () => {
  if (!duelId) return;
  duelClaimForfeitBtn.disabled = true;
  // claim_opponent_forfeit() is the actual gatekeeper (a generous,
  // server-verified grace period since the last question was
  // revealed) — this button just offers the option; a too-early tap
  // gets a friendly explanation instead of silently failing.
  const result = await claimOpponentForfeit(duelId);
  duelClaimForfeitBtn.disabled = false;
  if (result?.ok) {
    // realtime subscription picks up status='finished' → shows results
  } else if (result?.reason === "too_soon") {
    alert("لم يمض وقت كافٍ بعد لاعتبار الخصم غير نشط. حاول مرة أخرى بعد قليل.");
  } else if (result?.reason === "already_resolved") {
    // duel likely just finished normally at the same moment — the
    // realtime subscription will show results momentarily.
  } else {
    alert("تعذّر تنفيذ الطلب. حاول مرة أخرى.");
  }
});

// -------- results --------
async function showDuelResults(duel) {
  duelIsHost = duel.created_by === currentUser.id;
  const myScore = duelIsHost ? duel.creator_score : duel.opponent_score;
  const oppScore = duelIsHost ? duel.opponent_score : duel.creator_score;
  const iWon = duel.winner_id === currentUser.id;

  duelLastConfig = {
    rangeMin: duel.range_min,
    rangeMax: duel.range_max,
    timerSeconds: duel.timer_seconds,
    questionTypes: duel.question_types,
    countPerType: duel.count_per_type,
  };

  let headline;
  if (duel.forfeited_by) {
    const iForfeited = duel.forfeited_by === currentUser.id;
    headline = iForfeited ? "استسلمت — خسارة 💔" : `${duelOpponentName} انسحب — فوز لك! 🏆 (+50 XP)`;
  } else if (iWon) {
    headline = "🏆 فزت بالمبارزة! (+50 XP)";
  } else if (duel.winner_id) {
    headline = "💔 خسرت هذه المرة.";
  } else {
    headline = "🤝 تعادل!";
  }

  // A duel win awards a flat XP bonus and can trigger duel_first_win/
  // duel_wins_10 (see award_duel_win_achievements() in supabase-schema
  // .sql) — but three different RPCs (advance_duel_question,
  // forfeit_duel, claim_opponent_forfeit) can each be the one that
  // actually finalizes a given duel, and for advance_duel_question
  // specifically only ONE of the two players' near-simultaneous calls
  // gets the real result (the other gets a harmless "already advanced"
  // no-op with no achievement/XP data). Rather than trust whichever
  // RPC response happened to arrive, refetch my own stats and diff —
  // reliable regardless of which path or which client's call actually
  // settled the duel.
  if (iWon) {
    await checkForNewDuelAchievements();
    const freshStats = (typeof fetchUserStats === "function") ? await fetchUserStats() : null;
    if (freshStats && typeof updateLevelBadge === "function") updateLevelBadge(freshStats.xp || 0);
  }

  const stats = await fetchDuelStats(currentUser.id);

  duelResultsBody.innerHTML = `
    <div class="stat-summary">
      <div class="stat-big" style="font-size:20px;">${escapeDuelHtml(headline)}</div>
      <div class="stat-caption">أنت ${myScore} — ${oppScore} ${escapeDuelHtml(duelOpponentName)}</div>
    </div>
    <div class="duel-stats-summary" style="margin-top:6px; border:none; padding-top:0;">
      <span class="duel-stat-pill wins">🏆 ${stats?.wins || 0} فوز</span>
      <span class="duel-stat-pill losses">💔 ${stats?.losses || 0} خسارة</span>
      <span class="duel-stat-pill">🤝 ${stats?.draws || 0} تعادل</span>
    </div>`;

  stopDuelTimer();
  duelAudioStop();
  duelId = null;
  switchDuelScreen("results");
}

duelRematchBtn.addEventListener("click", async () => {
  if (!duelOpponentId || !duelLastConfig) return;

  duelRematchBtn.disabled = true;
  // Always a direct challenge (not another quick-match queue entry) —
  // we already know exactly who to face, so this just re-sends the
  // same config straight to them as a fresh invite they need to
  // accept, same as any other direct challenge.
  const newId = await createDirectDuel(
    duelOpponentId,
    duelLastConfig.rangeMin,
    duelLastConfig.rangeMax,
    duelLastConfig.timerSeconds,
    duelLastConfig.questionTypes,
    duelLastConfig.countPerType
  );
  duelRematchBtn.disabled = false;

  if (!newId) {
    alert("تعذّر إرسال طلب إعادة المباراة. حاول مرة أخرى.");
    return;
  }

  duelId = newId;
  duelIsHost = true;
  showDuelWaiting("بانتظار الرد", `بانتظار موافقة ${duelOpponentName} على إعادة المباراة...`, cancelWaitingDuel);
  beginDuelStateWatch(newId, onHostWaitingForAcceptance);
});

duelBackToHubBtn.addEventListener("click", async () => {
  await loadDuelHub();
  switchDuelScreen("hub");
});

// -------- handoff from the global invite banner (see auth-ui.js) --------
// Called after accepting a friend invite, or tapping "انضمام" on a
// quick-match pairing notification — lands the person on whichever
// screen the duel actually needs next, regardless of where they were
// in the app when they accepted.
async function onDuelInviteAccepted(id) {
  if (typeof switchView === "function") switchView("challenge");
  challengeModeToggle.querySelectorAll(".challenge-mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === "online");
  });
  challengeOfflineWrap.style.display = "none";
  challengeOnlineWrap.style.display = "block";
  challengeSelfWrap.style.display = "none";

  const duel = await fetchDuelState(id);
  if (!duel) { switchDuelScreen("hub"); return; }
  await resumeDuel(duel);
}

// -------- init --------
renderDuelTypesGrid();
showHideDuelCustomRange();

// ============================================================
// Self-challenge mode (⚔️ تحديات → ذاتي) — a solo, session-backed
// quiz. This is where the old session-backed Tests screen's
// functionality moved to: the range/type/count are chosen once at
// setup (like محلي), then questions come in sequential blocks of
// exactly SELF_BLOCK_SIZE (3) same-type questions — answering inside
// a block auto-advances immediately (like the Tests screen), but the
// block pauses for a manual tap before the next one starts, whether
// that next block repeats the same type or moves to a new one.
//
// Signed-in users get a real `sessions` row (see supabase-schema.sql)
// that survives a page refresh — getActiveSessionId()/
// syncActiveSessionId() below are the same hooks auth-ui.js already
// uses to highlight the active session in "📊 الجلسات", just now
// pointed at the self-challenge session instead of the retired
// session-backed Tests screen. Guests play fully in-memory, exactly
// like محلي — nothing persists across a refresh and nothing counts
// toward the leaderboard.
//
// Reuses the exact same pure question-generation helpers as Tests/
// محلي (fetchPageAyahs, pickQAFromPage, pickAdjacentPageQA,
// buildChoices, ADJACENT_TYPES, getTypeLabel/getTypeDescription) so a
// ذاتي question looks and behaves exactly like a normal one — only
// the surrounding interaction (timer, audio button, choice list,
// block pacing) is its own copy, same pattern as محلي/مباشر each
// having their own.
// ============================================================

const SELF_TYPES = CHALLENGE_TYPES;
const SELF_MIN_TYPES = 1;
const SELF_BLOCK_SIZE = 3;

const selfSetupSection = document.getElementById("selfSetupSection");
const selfPlaySection = document.getElementById("selfPlaySection");
const selfResultsSection = document.getElementById("selfResultsSection");

const selfRangeSelect = document.getElementById("selfRangeSelect");
const selfTimerSelect = document.getElementById("selfTimerSelect");
const selfCustomRangeRow = document.getElementById("selfCustomRangeRow");
const selfCustomMin = document.getElementById("selfCustomMin");
const selfCustomMax = document.getElementById("selfCustomMax");
const selfTypesGrid = document.getElementById("selfTypesGrid");
const selfCountSelect = document.getElementById("selfCountSelect");
const selfStartBtn = document.getElementById("selfStartBtn");
const selfSetupError = document.getElementById("selfSetupError");

const selfEndBtn = document.getElementById("selfEndBtn");
const selfProgressLabel = document.getElementById("selfProgressLabel");
const selfScoreBox = document.getElementById("selfScoreBox");
const selfBlockPause = document.getElementById("selfBlockPause");
const selfBlockPauseIcon = document.getElementById("selfBlockPauseIcon");
const selfBlockPauseDone = document.getElementById("selfBlockPauseDone");
const selfBlockPauseStats = document.getElementById("selfBlockPauseStats");
const selfBlockPauseNotice = document.getElementById("selfBlockPauseNotice");
const selfBlockPauseTag = document.getElementById("selfBlockPauseTag");
const selfBlockPauseLabel = document.getElementById("selfBlockPauseLabel");
const selfBlockPauseDesc = document.getElementById("selfBlockPauseDesc");
const selfBlockContinueBtn = document.getElementById("selfBlockContinueBtn");
const selfQuestionArea = document.getElementById("selfQuestionArea");
const selfProgressBar = document.getElementById("selfProgressBar");
const selfFlashcard = document.getElementById("selfFlashcard");
const selfFlashcardWrap = document.getElementById("selfFlashcardWrap");
const selfCardHelp = document.getElementById("selfCardHelp");
const selfQText = document.getElementById("selfQText");
const selfMcqChoices = document.getElementById("selfMcqChoices");
const selfPlayAudioBtn = document.getElementById("selfPlayAudioBtn");

const selfResultsBody = document.getElementById("selfResultsBody");
const selfBackToSetupBtn = document.getElementById("selfBackToSetupBtn");

// -------- state --------
// Exposed to auth-ui.js exactly like the old Tests-screen session
// hooks were: getActiveSessionId() for "which session is active right
// now" (used to highlight it in the sessions table and to block
// deleting it), syncActiveSessionId() to update that pointer whenever
// a ذاتي quiz starts or ends.
let selfActiveSessionId = null;
function getActiveSessionId() { return selfActiveSessionId; }
function syncActiveSessionId(id) { selfActiveSessionId = id; }

let selfRangeMinP = null;
let selfRangeMaxP = null;
let selfTimerSeconds = 30;
let selfSelectedTypes = [];
let selfCountPerType = null; // null = غير محدد (unlimited, shared across every selected type)
let selfUnlimited = false;

let selfQueue = [];       // head = the next (or currently shown) question's type
let selfCycleTypes = [];  // unlimited mode only: round-robin order, replenished 3 at a time
let selfCycleIndex = 0;
let selfTypeCounts = {};  // { [type]: how many already answered THIS session } — drives resume + remaining-per-type

let selfTotalQuestions = 0; // finite mode only, for the progress label
let selfQuestionIndex = 0;
let selfLastShownType = null;
let selfBlockPosition = 0; // 1-based position within the current same-type block

let selfCorrect = 0;
let selfTotal = 0;

let selfCurrentCorrectIndex = -1;
let selfCurrentQuestionType = null;
let selfCurrentPage = null;
let selfAnswered = false;
let selfHasActiveCard = false;

let selfTimerInterval = null;
let selfTimerStart = null;
let selfTimerDurationMs = 0;

let selfAudioEl = null;
let selfCurrentAudioAyah = null;

// Per-run tracking (reset whenever a run starts or is resumed)
let selfUsedKeys = new Set();        // questionKey()s already asked in this challenge — never repeated
let selfExhaustedTypes = new Set();  // types that ran out of unused questions
let selfPauseNotices = [];           // shown once on the next block-pause screen
let selfBlockAnswered = 0;           // answers / correct answers in the block in progress
let selfBlockCorrect = 0;
let selfAttemptLog = [];             // [{ question_type, is_correct }] for this page-load — feeds the guest results breakdown
let selfPendingRecords = [];         // in-flight recordAttempt() calls, awaited before the results are fetched
let selfConsecutiveFailures = 0;     // guards against an endless loop if question generation keeps failing

const SELF_USED_KEYS_PREFIX = "qf_self_used_";

function resetSelfRunTracking() {
  selfUsedKeys = new Set();
  selfExhaustedTypes = new Set();
  selfPauseNotices = [];
  selfBlockAnswered = 0;
  selfBlockCorrect = 0;
  selfAttemptLog = [];
  selfPendingRecords = [];
  selfConsecutiveFailures = 0;
}

// The asked-question keys are persisted per session so a page refresh
// in the middle of a signed-in challenge can't cause repeats.
function saveSelfUsedKeys() {
  if (!selfActiveSessionId) return;
  try { localStorage.setItem(SELF_USED_KEYS_PREFIX + selfActiveSessionId, JSON.stringify([...selfUsedKeys])); } catch (e) { /* storage unavailable, ignore */ }
}
function loadSelfUsedKeys(sessionId) {
  try {
    const raw = localStorage.getItem(SELF_USED_KEYS_PREFIX + sessionId);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch (e) {
    return new Set();
  }
}
function clearSelfUsedKeys(sessionId) {
  if (!sessionId) return;
  try { localStorage.removeItem(SELF_USED_KEYS_PREFIX + sessionId); } catch (e) { /* ignore */ }
}

// A type has no unused questions left in this range: drop it from the
// queue AND the unlimited-mode round robin, and tell the person on the
// next pause screen.
function handleSelfTypeExhausted(type) {
  if (selfExhaustedTypes.has(type)) return;
  selfExhaustedTypes.add(type);
  selfQueue = selfQueue.filter((t) => t !== type);
  selfCycleTypes = selfCycleTypes.filter((t) => t !== type);
  selfPauseNotices.push(`نفدت الأسئلة المتاحة من نوع «${getTypeLabel(type)}» في هذا النطاق دون تكرار — لن يظهر هذا النوع مرة أخرى.`);
}

// -------- setup UI --------
function renderSelfTypesGrid() {
  selfTypesGrid.innerHTML = "";
  SELF_TYPES.forEach((type) => {
    const label = document.createElement("label");
    label.className = "challenge-type-chip";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = type;
    cb.addEventListener("change", () => {
      label.classList.toggle("checked", cb.checked);
      refreshSelfStartAvailability();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(getTypeLabel(type)));
    selfTypesGrid.appendChild(label);
  });
}

function getSelectedSelfTypes() {
  return Array.from(selfTypesGrid.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
}

function showHideSelfCustomRange() {
  selfCustomRangeRow.style.display = (selfRangeSelect.value === "custom") ? "flex" : "none";
}
selfRangeSelect.addEventListener("change", () => { showHideSelfCustomRange(); refreshSelfStartAvailability(); });
[selfCustomMin, selfCustomMax].forEach((el) => el.addEventListener("change", refreshSelfStartAvailability));

let selfValidationToken = 0;
async function refreshSelfStartAvailability() {
  const myToken = ++selfValidationToken;
  const selectedTypes = getSelectedSelfTypes();
  const enoughTypes = selectedTypes.length >= SELF_MIN_TYPES;

  let msg = "";
  if (!enoughTypes) msg = "اختر نوع سؤال واحدًا على الأقل.";

  if (!msg) {
    const range = resolveRangeBounds(selfRangeSelect.value, selfCustomMin.value, selfCustomMax.value);
    for (const type of selectedTypes) {
      const blocked = await challengeTypeBlockMessage(type, range.minP, range.maxP);
      if (blocked) { msg = `"${getTypeLabel(type)}": ${blocked}`; break; }
    }
  }

  if (myToken !== selfValidationToken) return; // a newer check superseded this one
  selfSetupError.textContent = msg;
  selfStartBtn.disabled = !!msg;
}

// -------- queue --------
// Builds (or rebuilds, on resume) the remaining queue from
// selfTypeCounts — how many of each selected type still need
// answering to reach selfCountPerType. Types are grouped into
// consecutive blocks (shuffled order), same principle as محلي's
// buildChallengeQueue(), just remaining-aware so a resumed quiz picks
// up exactly where it left off instead of restarting each type.
function buildSelfQueueFromRemaining() {
  const orderedTypes = shuffle([...selfSelectedTypes]);
  const queue = [];
  orderedTypes.forEach((type) => {
    const done = selfTypeCounts[type] || 0;
    const remaining = Math.max(0, (selfCountPerType || 0) - done);
    for (let i = 0; i < remaining; i++) queue.push(type);
  });
  return queue;
}

// Unlimited mode has no finite queue to pre-build — instead, whenever
// it empties, append the next SELF_BLOCK_SIZE questions of the next
// type in the round-robin. This is the only difference from finite
// mode; everything downstream (pausing, generating, progress) treats
// selfQueue the same way either way.
function replenishSelfQueueIfNeeded() {
  if (!selfUnlimited || selfQueue.length > 0) return;
  if (!selfCycleTypes.length) return; // every selected type has run out of questions
  const type = selfCycleTypes[selfCycleIndex % selfCycleTypes.length];
  selfCycleIndex++;
  for (let i = 0; i < SELF_BLOCK_SIZE; i++) selfQueue.push(type);
}

// -------- starting / resuming --------
selfStartBtn.addEventListener("click", async () => {
  const selectedTypes = getSelectedSelfTypes();
  const range = resolveRangeBounds(selfRangeSelect.value, selfCustomMin.value, selfCustomMax.value);
  const rawCount = selfCountSelect.value;
  const countPerType = rawCount === "unlimited" ? null : (parseInt(rawCount, 10) || 5);

  selfRangeMinP = range.minP;
  selfRangeMaxP = range.maxP;
  selfTimerSeconds = parseInt(selfTimerSelect.value, 10) || 0;
  selfSelectedTypes = selectedTypes;
  selfCountPerType = countPerType;
  selfUnlimited = countPerType == null;
  selfTypeCounts = {};
  selfCorrect = 0;
  selfTotal = 0;
  selfQuestionIndex = 0;
  selfLastShownType = null;
  selfBlockPosition = 0;
  resetSelfRunTracking();

  if (currentUser && typeof createSession === "function") {
    const newId = await createSession(range.minP, range.maxP, selectedTypes, countPerType);
    syncActiveSessionId(newId);
  } else {
    syncActiveSessionId(null); // guest — fully ephemeral, nothing persisted
  }

  if (selfUnlimited) {
    selfCycleTypes = shuffle([...selfSelectedTypes]);
    selfCycleIndex = 0;
    selfQueue = [];
  } else {
    selfQueue = buildSelfQueueFromRemaining();
    selfTotalQuestions = selfSelectedTypes.length * selfCountPerType;
  }

  updateSelfScoreBox();
  selfSetupSection.style.display = "none";
  selfResultsSection.style.display = "none";
  selfPlaySection.style.display = "block";
  await nextSelfQuestion();
});

// Called when switching to the ⚔️ التحديات → ذاتي tab. If a
// signed-in user already has an unfinished ذاتي quiz (e.g. they
// refreshed the page mid-quiz), resumes it by rebuilding the queue
// from recorded attempts rather than dropping them back to setup.
async function enterSelfChallengeMode() {
  // Already mid-quiz (or showing results) from earlier this same page
  // load — just switching tabs and back, leave it exactly as is.
  if (selfPlaySection.style.display === "block" || selfResultsSection.style.display === "block") return;

  if (currentUser && typeof ensureActiveSession === "function") {
    const active = await ensureActiveSession();
    if (active && active.questionTypes && active.questionTypes.length) {
      selfRangeMinP = active.rangeMin;
      selfRangeMaxP = active.rangeMax;
      selfSelectedTypes = active.questionTypes;
      selfCountPerType = active.countPerType;
      selfUnlimited = active.countPerType == null;
      syncActiveSessionId(active.id);

      const progress = (typeof fetchSessionProgress === "function") ? await fetchSessionProgress(active.id) : null;
      selfTypeCounts = progress?.byType || {};
      selfTotal = progress?.total || 0;
      selfCorrect = progress?.correct || 0;
      selfQuestionIndex = selfTotal;
      selfLastShownType = null;
      selfBlockPosition = 0;
      resetSelfRunTracking();
      selfUsedKeys = loadSelfUsedKeys(active.id); // so a refresh can't cause repeats

      if (selfUnlimited) {
        selfCycleTypes = shuffle([...selfSelectedTypes]);
        selfCycleIndex = 0;
        selfQueue = [];
      } else {
        selfQueue = buildSelfQueueFromRemaining();
        selfTotalQuestions = selfSelectedTypes.length * selfCountPerType;
        if (selfQueue.length === 0) {
          // Already complete (e.g. finished from another tab) — just
          // close it out instead of resuming an empty quiz.
          await finishSelfChallenge(true);
          return;
        }
      }

      updateSelfScoreBox();
      selfSetupSection.style.display = "none";
      selfResultsSection.style.display = "none";
      selfPlaySection.style.display = "block";
      await nextSelfQuestion();
      return;
    }
  }

  resetSelfToSetup();
}

// -------- play --------
function updateSelfScoreBox() {
  selfScoreBox.textContent = `النتيجة: ${selfCorrect} / ${selfTotal}`;
}

function renderSelfChoices(choices) {
  selfMcqChoices.innerHTML = "";
  choices.forEach((choiceText, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mcq-choice";
    btn.textContent = choiceText;
    btn.style.fontSize = choiceFontSize(choiceText);
    btn.dataset.index = String(idx);
    selfMcqChoices.appendChild(btn);
  });
}

function revealSelfChoices(chosenIndex) {
  Array.from(selfMcqChoices.children).forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === selfCurrentCorrectIndex) btn.classList.add("correct");
    if (idx === chosenIndex && idx !== selfCurrentCorrectIndex) btn.classList.add("wrong");
  });
}

selfMcqChoices.addEventListener("click", (e) => {
  const btn = e.target.closest(".mcq-choice");
  if (!btn || btn.disabled) return;
  if (!selfHasActiveCard || selfAnswered) return;

  const idx = Number(btn.dataset.index);
  const isCorrect = idx === selfCurrentCorrectIndex;

  stopSelfTimer();
  revealSelfChoices(idx);
  finishSelfQuestion(isCorrect);
});

function stopSelfTimer() {
  if (selfTimerInterval) {
    clearInterval(selfTimerInterval);
    selfTimerInterval = null;
  }
  selfProgressBar.style.width = "0%";
}

function startSelfTimer() {
  stopSelfTimer();
  if (selfTimerSeconds <= 0) return; // "بدون مؤقت"

  selfTimerDurationMs = selfTimerSeconds * 1000;
  selfTimerStart = Date.now();
  selfProgressBar.style.width = "0%";

  selfTimerInterval = setInterval(() => {
    const elapsed = Date.now() - selfTimerStart;
    const pct = clamp((elapsed / selfTimerDurationMs) * 100, 0, 100);
    selfProgressBar.style.width = pct + "%";
    if (elapsed >= selfTimerDurationMs) {
      stopSelfTimer();
      if (selfHasActiveCard && !selfAnswered) {
        revealSelfChoices(-1); // -1 = no selection made, just reveal the correct one
        finishSelfQuestion(false);
      }
    }
  }, 100);
}

function selfAudioStop() {
  if (selfAudioEl) {
    selfAudioEl.pause();
    selfAudioEl.currentTime = 0;
    selfAudioEl = null;
  }
  selfPlayAudioBtn.textContent = "🔊 استماع";
  selfPlayAudioBtn.classList.remove("playing");
}

selfPlayAudioBtn.addEventListener("click", async () => {
  if (selfAudioEl && !selfAudioEl.paused) {
    selfAudioStop();
    return;
  }
  if (!selfCurrentAudioAyah) return;

  selfPlayAudioBtn.disabled = true;
  selfPlayAudioBtn.textContent = "⏳ جارٍ التحميل...";
  try {
    const url = await fetchAyahAudioUrl(selfCurrentAudioAyah);
    if (!url) throw new Error("no audio url");
    selfAudioEl = new Audio(url);
    selfAudioEl.addEventListener("ended", selfAudioStop);
    await selfAudioEl.play();
    selfPlayAudioBtn.textContent = "⏸️ إيقاف";
    selfPlayAudioBtn.classList.add("playing");
  } catch (e) {
    selfAudioStop();
  } finally {
    selfPlayAudioBtn.disabled = false;
  }
});

// Decides what happens next: finish (queue truly empty — finite mode
// only), pause for a new block (type changed, or SELF_BLOCK_SIZE
// reached), or go straight to the next question (same block
// continuing). Called both to kick off the very first question and
// after every answer.
async function nextSelfQuestion() {
  selfAnswered = false;
  stopSelfTimer();
  selfAudioStop();

  replenishSelfQueueIfNeeded();

  if (selfQueue.length === 0) {
    await finishSelfChallenge(true);
    return;
  }

  const nextType = selfQueue[0];
  const blockDone = (nextType !== selfLastShownType) || (selfBlockPosition >= SELF_BLOCK_SIZE);

  if (blockDone) {
    showSelfBlockPause(nextType);
    return;
  }

  await proceedToSelfQuestion();
}

function showSelfBlockPause(nextType) {
  selfQuestionArea.style.display = "none";
  selfBlockPause.style.display = "block";
  selfBlockPause.scrollIntoView({ behavior: "smooth", block: "start" });

  const hadPreviousBlock = !!selfLastShownType;
  const sameType = hadPreviousBlock && nextType === selfLastShownType;

  selfBlockPauseIcon.textContent = hadPreviousBlock ? "✅" : "🔔";

  // The block that was just finished — deliberately SMALL and muted.
  if (hadPreviousBlock) {
    selfBlockPauseDone.textContent =
      `أنهيت بلوك «${getTypeLabel(selfLastShownType)}» — ${selfBlockCorrect} من ${selfBlockAnswered} صحيحة`;
    selfBlockPauseDone.style.display = "";
  } else {
    selfBlockPauseDone.style.display = "none";
  }

  // Where the whole challenge stands.
  const remaining = selfQueue.length;
  const pct = selfTotal > 0 ? Math.round((selfCorrect / selfTotal) * 100) : 0;
  let statsHtml = `
    <div class="self-stat-chip"><div class="self-stat-value">${selfTotal}</div><div class="self-stat-label">أجبت</div></div>
    <div class="self-stat-chip"><div class="self-stat-value">${selfCorrect} <span class="self-stat-pct">(${pct}%)</span></div><div class="self-stat-label">صحيحة</div></div>
    <div class="self-stat-chip"><div class="self-stat-value">${selfUnlimited ? "∞" : remaining}</div><div class="self-stat-label">${selfUnlimited ? "المتبقي: غير محدد" : "متبقٍ"}</div></div>`;
  if (!selfUnlimited) {
    const overall = selfTotal + remaining;
    const progressPct = overall > 0 ? Math.round((selfTotal / overall) * 100) : 0;
    statsHtml += `
      <div class="self-block-progress">
        <div class="level-progress-bar"><div class="level-progress-fill" style="width:${progressPct}%"></div></div>
        <div class="level-progress-caption">${selfTotal} من ${overall} سؤال (${progressPct}%)</div>
      </div>`;
  }
  selfBlockPauseStats.innerHTML = statsHtml;

  // One-off notices (e.g. a type ran out of unused questions).
  if (selfPauseNotices.length) {
    selfBlockPauseNotice.textContent = selfPauseNotices.join(" ");
    selfBlockPauseNotice.style.display = "block";
    selfPauseNotices = [];
  } else {
    selfBlockPauseNotice.style.display = "none";
  }

  // The NEXT block's type — the prominent part.
  selfBlockPauseTag.textContent = !hadPreviousBlock
    ? (selfTotal > 0 ? "▶️ متابعة التحدي" : "🚀 النوع الأول")
    : (sameType ? "🔁 نفس النوع مرة أخرى" : "🆕 النوع الجديد");
  selfBlockPauseLabel.textContent = getTypeLabel(nextType);
  const blockAhead = Math.min(selfQueue.filter((t) => t === nextType).length, SELF_BLOCK_SIZE);
  let desc = `${getTypeDescription(nextType)} — ${blockAhead === 1 ? "سؤال واحد" : `${blockAhead} أسئلة`} في هذا البلوك`;
  if (!selfUnlimited) desc += ` (أجبت على ${selfTypeCounts[nextType] || 0} من ${selfCountPerType} من هذا النوع)`;
  selfBlockPauseDesc.textContent = desc;

  // Reset — the upcoming block starts fresh.
  selfBlockPosition = 0;
  selfBlockAnswered = 0;
  selfBlockCorrect = 0;
}

selfBlockContinueBtn.addEventListener("click", async () => {
  selfBlockPause.style.display = "none";
  selfQuestionArea.style.display = "block";
  await proceedToSelfQuestion();
});

// Generates and shows the question at the head of selfQueue. Retries
// a few times on a transient generation failure (same class of
// failure Tests/محلي mode can hit), and discards the slot on
// persistent failure rather than getting the quiz stuck.
async function proceedToSelfQuestion() {
  selfFlashcardWrap.scrollIntoView({ behavior: "smooth", block: "start" });

  const type = selfQueue.shift();

  // Never repeats a question (same ayah + same type) within a challenge.
  const gen = await generateUniqueQuestion(type, selfRangeMinP, selfRangeMaxP, selfUsedKeys);
  if (gen.status !== "ok") {
    if (gen.status === "exhausted") handleSelfTypeExhausted(type);
    else selfConsecutiveFailures++;

    if (selfConsecutiveFailures >= 5) { await finishSelfChallenge(true); return; }
    await nextSelfQuestion(); // re-decides: finish / pause for the next block / continue
    return;
  }
  selfConsecutiveFailures = 0;
  selfUsedKeys.add(gen.key);
  saveSelfUsedKeys();
  const { qa, built, page } = gen;

  // Bookkeeping only once a real question exists.
  selfBlockPosition = (type === selfLastShownType) ? selfBlockPosition + 1 : 1;
  selfLastShownType = type;
  selfQuestionIndex++;

  selfProgressLabel.textContent = selfUnlimited
    ? `سؤال ${selfQuestionIndex} — النوع: ${getTypeLabel(type)} (${selfBlockPosition}/${SELF_BLOCK_SIZE})`
    : `سؤال ${selfQuestionIndex} من ${selfQuestionIndex + selfQueue.length} — النوع: ${getTypeLabel(type)}`;

  selfCurrentCorrectIndex = built.correctIndex;
  selfCurrentQuestionType = type;
  selfCurrentPage = page;
  selfCurrentAudioAyah = qa.qAyahNumber || null;

  const isAudioOnly = !!qa.audioOnly;
  selfFlashcard.classList.toggle("audio-question", isAudioOnly);
  selfCardHelp.textContent = `النوع: ${getTypeLabel(type)} — ${getTypeDescription(type)}`;
  setCardText(selfQText, isAudioOnly ? "🎧 اضغط زر الاستماع لسماع الآية، ثم اختر الآية التالية لها" : qa.q);
  renderSelfChoices(built.choices);
  selfPlayAudioBtn.style.display = selfCurrentAudioAyah ? "inline-flex" : "none";

  selfHasActiveCard = true;
  startSelfTimer();
}

function finishSelfQuestion(isCorrect) {
  if (selfAnswered) return;
  selfAnswered = true;

  selfTotal += 1;
  if (isCorrect) selfCorrect += 1;
  selfTypeCounts[selfCurrentQuestionType] = (selfTypeCounts[selfCurrentQuestionType] || 0) + 1;
  selfBlockAnswered += 1;
  if (isCorrect) selfBlockCorrect += 1;
  selfAttemptLog.push({ question_type: selfCurrentQuestionType, is_correct: isCorrect });
  updateSelfScoreBox();

  const flashClass = isCorrect ? "flash-correct" : "flash-wrong";
  selfFlashcard.classList.add(flashClass);
  setTimeout(() => selfFlashcard.classList.remove(flashClass), 700);

  if (typeof recordAttempt === "function" && currentUser && selfActiveSessionId) {
    const now = new Date();
    const pendingRecord = recordAttempt({
      questionType: selfCurrentQuestionType,
      page: selfCurrentPage,
      isCorrect,
      sessionId: selfActiveSessionId,
      rangeMin: selfRangeMinP,
      rangeMax: selfRangeMaxP,
      localHour: now.getHours(),
      isWeekend: now.getDay() === 5 || now.getDay() === 6,
    }).then((result) => {
      if (result?.ok && result.newlyEarned && result.newlyEarned.length) showAchievementToasts(result.newlyEarned);
      if (result?.ok && result.xpGained) showXpPopup(result.xpGained);
      if (result?.ok && result.xp != null && typeof updateLevelBadge === "function") updateLevelBadge(result.xp);
    }).catch(() => { /* non-fatal: keep the quiz usable offline */ });
    selfPendingRecords.push(pendingRecord);
  }

  setTimeout(() => { nextSelfQuestion(); }, 900);
}

selfEndBtn.addEventListener("click", async () => {
  if (!confirm("هل تريد إنهاء الاختبار الآن؟")) return;
  stopSelfTimer();
  selfAudioStop();
  await finishSelfChallenge(false);
});

// -------- results --------
async function finishSelfChallenge(natural) {
  stopSelfTimer();
  selfAudioStop();
  selfPlaySection.style.display = "none";
  selfBlockPause.style.display = "none";
  selfResultsSection.style.display = "block";
  selfResultsBody.innerHTML = '<div class="status">جاري التحميل...</div>';
  selfResultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

  const finishedSessionId = selfActiveSessionId;

  // Let in-flight attempt syncs land first, so the stats fetched below
  // include the very last answers.
  if (selfPendingRecords.length) await Promise.allSettled(selfPendingRecords);
  selfPendingRecords = [];

  if (currentUser && finishedSessionId && typeof finishActiveSession === "function") {
    await finishActiveSession(finishedSessionId);
  }
  clearSelfUsedKeys(finishedSessionId);
  syncActiveSessionId(null);

  const pct = selfTotal > 0 ? Math.round((selfCorrect / selfTotal) * 100) : 0;
  const exhaustedNote = selfExhaustedTypes.size
    ? `<div class="challenge-notice">نفدت الأسئلة المتاحة (دون تكرار) من: ${[...selfExhaustedTypes].map(getTypeLabel).join("، ")}.</div>`
    : "";

  let html = `
    <div class="stat-summary">
      <div class="stat-big" style="font-size:20px;">${selfCorrect} / ${selfTotal} (${pct}%)</div>
      <div class="stat-caption">${natural ? "انتهى الاختبار 🎉" : "تم إنهاء الاختبار يدويًا"}</div>
    </div>${exhaustedNote}`;

  if (currentUser && finishedSessionId && typeof renderSessionsOverviewInto === "function") {
    // Signed in: the same sessions overview as 👤 ملفي الشخصي, with
    // this challenge selected.
    html += `
      <div class="section-label">📊 جميع تحدياتي الذاتية</div>
      <div id="selfResultsOverview"></div>
      <button id="selfResultsProfileBtn" type="button" class="btn small ghost" style="width:100%; margin-top:12px;">👤 فتح ملفي الشخصي (لوحة الصدارة وحذف الجلسات)</button>`;
    selfResultsBody.innerHTML = html;
    document.getElementById("selfResultsProfileBtn").addEventListener("click", () => {
      if (typeof switchView === "function") switchView("profile");
    });
    await renderSessionsOverviewInto(document.getElementById("selfResultsOverview"), finishedSessionId);
  } else {
    // Guest: nothing is saved anywhere, so show this run's own
    // per-type breakdown instead.
    html += `
      <div class="section-label">📊 تفاصيل هذا التحدي</div>
      <div class="stat-rows">${typeof buildTypeRowsHtml === "function" ? buildTypeRowsHtml(selfAttemptLog) : ""}</div>
      <div class="hint" style="text-align:center; margin-top:12px;">سجّل الدخول لتُحفظ تحدياتك الذاتية وتظهر هنا كلها مع إحصائياتها.</div>`;
    selfResultsBody.innerHTML = html;
  }
}

function resetSelfToSetup() {
  syncActiveSessionId(null);
  selfTypesGrid.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = false;
    cb.closest(".challenge-type-chip")?.classList.remove("checked");
  });
  selfRangeSelect.value = "custom";
  selfCustomMin.value = 1;
  selfCustomMax.value = 604;
  showHideSelfCustomRange();
  selfTimerSelect.value = "30";
  selfCountSelect.value = "5";

  selfResultsSection.style.display = "none";
  selfPlaySection.style.display = "none";
  selfSetupSection.style.display = "block";
  refreshSelfStartAvailability();
}
selfBackToSetupBtn.addEventListener("click", resetSelfToSetup);

// -------- init --------
renderSelfTypesGrid();
resetSelfToSetup();

generateBtn.addEventListener("click", generateCard);

// Init
loadGuestScore();
updateScore();
setStatus("");
qText.textContent = "—";

// -------- settings accordion (expanded by default) --------
settingsToggleBtn.addEventListener("click", () => {
  const expanded = settingsToggleBtn.getAttribute("aria-expanded") === "true";
  settingsToggleBtn.setAttribute("aria-expanded", String(!expanded));
  settingsAccordionBody.classList.toggle("collapsed", expanded);
});

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

viewPageInQuranBtn.addEventListener("click", () => {
  if (currentPage == null) return;
  if (typeof switchView === "function") switchView("quran");
  if (typeof quranGoToPage === "function") quranGoToPage(currentPage);
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
    await refreshQuestionTypeAvailability();
    if (challengeSelfWrap.style.display !== "none" && typeof enterSelfChallengeMode === "function") {
      await enterSelfChallengeMode();
    }
  });
} else {
  settingsSyncReady = true;
}