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

// Signed-in-only fixed range display
const sessionRangeRow = document.getElementById("sessionRangeRow");
const sessionRangeDisplay = document.getElementById("sessionRangeDisplay");

const scoreBox = document.getElementById("scoreBox");
const cardHelp = document.getElementById("cardHelp");

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

// Current question context (used for syncing attempts to Supabase)
let currentQuestionType = null;
let currentPage = null;
let currentRangeMin = null;
let currentRangeMax = null;

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
function getActiveSessionId() { return activeSessionId; }
function syncActiveSessionId(id, rangeMin, rangeMax) {
  activeSessionId = id;
  activeSessionRangeMin = rangeMin ?? null;
  activeSessionRangeMax = rangeMax ?? null;
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
    case "juz1": return { minP: 1, maxP: 21 };
    case "juz30": return { minP: 582, maxP: 604 };
    case "baqarah": return { minP: 2, maxP: 49 };
    case "imran": return { minP: 50, maxP: 76 };
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

function showGuestRangeUI() {
  guestRangeRow.style.display = "flex";
  showHideCustomRange();
  sessionRangeRow.style.display = "none";
}

function showSessionRangeUI(minP, maxP) {
  guestRangeRow.style.display = "none";
  customRangeRow.style.display = "none";
  sessionRangeRow.style.display = "flex";
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
    default: return "—";
  }
}

// -------- QA builders --------
// Every builder returns { q, a, kind } (or null on failure). `kind`
// tells buildChoices() which distractor strategy to use:
//   "text"   → other ayah texts (first/last/previous/adjacent types)
//   "surah"  → other surah names (from surahsInRange)
//   "pageNumber" / "juz" → other values from the same range
//   "ayahCount" / "ayahNumber" → nearby numbers
function pickQAFromPage(ayahs, type, page) {
  if (!ayahs || ayahs.length < 2) return null;

  const first = ayahs[0];
  const last = ayahs[ayahs.length - 1];

  if (type === "first") {
    const candidate = ayahs[randInt(1, ayahs.length - 1)];
    return { q: clean(candidate.text), a: clean(first.text), kind: "text" };
  }

  if (type === "last") {
    const candidate = ayahs[randInt(0, ayahs.length - 2)];
    return { q: clean(candidate.text), a: clean(last.text), kind: "text" };
  }

  if (type === "previous") {
    const idx = randInt(1, ayahs.length - 1);
    return { q: clean(ayahs[idx].text), a: clean(ayahs[idx - 1].text), kind: "text" };
  }

  if (type === "surah") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: getSurahName(candidate), kind: "surah" };
  }

  if (type === "pageNumber") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: String(page), kind: "pageNumber" };
  }

  if (type === "ayahCount") {
    return { q: clean(first.text), a: String(ayahs.length), kind: "ayahCount" };
  }

  if (type === "juz") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    const juz = candidate.juz;
    if (juz == null) return null;
    return { q: clean(candidate.text), a: String(juz), kind: "juz" };
  }

  if (type === "ayahNumber") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    const num = candidate.numberInSurah;
    if (num == null) return null;
    return { q: clean(candidate.text), a: String(num), kind: "ayahNumber" };
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
    const q = clean(currentAyahs[0].text);
    const nextAyahs = await fetchPageAyahs(page + 1);
    if (!nextAyahs || nextAyahs.length < 1) return null;
    return { q, a: clean(nextAyahs[0].text), kind: "text" };
  }

  if (type === "prevPageFirst") {
    const q = clean(currentAyahs[0].text);
    const prevAyahs = await fetchPageAyahs(page - 1);
    if (!prevAyahs || prevAyahs.length < 1) return null;
    return { q, a: clean(prevAyahs[0].text), kind: "text" };
  }

  if (type === "pageEndToNextFirst") {
    const q = clean(currentAyahs[currentAyahs.length - 1].text);
    const nextAyahs = await fetchPageAyahs(page + 1);
    if (!nextAyahs || nextAyahs.length < 1) return null;
    return { q, a: clean(nextAyahs[0].text), kind: "text" };
  }

  if (type === "pageStartToPrevLast") {
    const q = clean(currentAyahs[0].text);
    const prevAyahs = await fetchPageAyahs(page - 1);
    if (!prevAyahs || prevAyahs.length < 1) return null;
    return { q, a: clean(prevAyahs[prevAyahs.length - 1].text), kind: "text" };
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
function renderChoices(choices) {
  mcqChoicesEl.innerHTML = "";
  choices.forEach((choiceText, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mcq-choice";
    btn.textContent = choiceText;
    btn.style.fontSize = choiceFontSize(choiceText);
    btn.dataset.index = String(idx);
    mcqChoicesEl.appendChild(btn);
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

  updateScore();
  unlockGenerate();

  setStatus(isCorrect ? "✅ إجابة صحيحة!" : "❌ إجابة خاطئة.");

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
    }).then((result) => {
      if (result?.ok && result.newlyEarned && result.newlyEarned.length) {
        showAchievementToasts(result.newlyEarned);
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
    // always stays within the selected range too.
    let page;
    if (type === "nextPageFirst" || type === "pageEndToNextFirst") {
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

    if (!qa || !qa.q || !qa.a) {
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

    setCardText(qText, qa.q);
    renderChoices(built.choices);
    currentCorrectIndex = built.correctIndex;

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
    mcqChoicesEl.innerHTML = "";
    setStatus("فشل التحميل. تأكد من الإنترنت وحاول مجددًا.");
    unlockGenerate();
  }
}

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
  refreshQuestionTypeAvailability();
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
      showSessionRangeUI(activeSessionRangeMin, activeSessionRangeMax);
    } else {
      activeSessionId = null;
      activeSessionRangeMin = null;
      activeSessionRangeMax = null;
      showGuestRangeUI();
    }
    await refreshQuestionTypeAvailability();
  });
} else {
  settingsSyncReady = true;
}
