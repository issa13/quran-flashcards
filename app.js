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
let total = 0;
let correct = 0;

// Card state
let hasActiveCard = false;
let answeredThisCard = false;

// Timer state
let timerInterval = null;
let timerStart = 0;
let timerDurationMs = 0;

// Cache
const pageCache = new Map();

function setStatus(msg) { statusEl.textContent = msg || ""; }

function updateScore() {
  scoreBox.textContent = `النتيجة: ${correct} / ${total}`;
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

    // show description inside card (front)
    cardHelp.textContent = `النوع: ${label} — ${getTypeDescription(type)}`;

    const { minP, maxP } = getRangeFromSelect();

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
      qText.textContent = "تعذر إنشاء سؤال. حاول مرة أخرى.";
      aText.textContent = "—";
      setStatus("حصلت مشكلة. جرّب مرة ثانية.");
      unlockGenerate();
      return;
    }

    qText.textContent = qa.q;
    aText.textContent = qa.a;

    hasActiveCard = true;
    answeredThisCard = false;

    const sec = getTimerSeconds();
    const timerText = (sec <= 0) ? "بدون مؤقت" : `${sec} ثانية`;

    setStatus(`جاهز. النوع: ${label} | المؤقت: ${timerText}`);
    unlockGenerate();

    startTimer();
  } catch (err) {
    qText.textContent = "خطأ في الشبكة أو في الـ API.";
    aText.textContent = "—";
    setStatus("فشل التحميل. تأكد من الإنترنت وحاول مجددًا.");
    unlockGenerate();
  }
}

generateBtn.addEventListener("click", generateCard);

// Init
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
