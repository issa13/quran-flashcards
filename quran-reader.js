// Quran reading tab (📖 القرآن) — a fixed-to-viewport, page-by-page
// Uthmani reader. The screen itself only ever shows the page; search,
// page/surah/juz navigation, bookmarks, reciter choice, and
// listen-to-a-range all live behind the ⋮ menu as modals. Entirely
// client-side against the same alquran.cloud API the rest of the app
// already uses; works for guests too, no account or Supabase
// involvement at all.
//
// Deliberately loaded AFTER app.js (see index.html) and reuses its
// globals directly rather than re-declaring them — API_BASE, EDITION,
// clamp(), fetchPageAyahs() (shares its page cache), and
// fetchSurahCatalog() (shares its cache) all come from app.js. This
// mirrors how auth-ui.js and app.js already share globals across
// script tags in this project. Audio is handled locally, though (see
// fetchQuranAyahAudioUrl() below), since this tab needs a
// user-selectable reciter, unlike solo/duel mode's fixed one.

const QURAN_LAST_PAGE_KEY = "qf_quran_last_page";
const QURAN_BOOKMARKS_KEY = "qf_quran_bookmarks";
const QURAN_RECITER_KEY = "qf_quran_reciter";
// A non-diacritic Arabic edition — the Uthmani script's full tashkeel
// makes typed search brittle, so search runs against this instead;
// the page itself still always renders full Uthmani text as usual.
const QURAN_SEARCH_EDITION = "quran-simple";

const QURAN_RECITERS = [
  { id: "ar.alafasy", name: "مشاري راشد العفاسي" },
  { id: "ar.abdulbasitmurattal", name: "عبد الباسط عبد الصمد (مرتل)" },
  { id: "ar.husary", name: "محمود خليل الحصري" },
  { id: "ar.minshawi", name: "محمد صديق المنشاوي (مرتل)" },
  { id: "ar.abdurrahmaansudais", name: "عبد الرحمن السديس" },
  { id: "ar.mahermuaiqly", name: "ماهر المعيقلي" },
];

// -------- DOM --------
const quranShellEl = document.querySelector(".quran-shell");
const quranMenuBtn = document.getElementById("quranMenuBtn");
const quranMenuDropdown = document.getElementById("quranMenuDropdown");
const quranPrevBtn = document.getElementById("quranPrevBtn");
const quranNextBtn = document.getElementById("quranNextBtn");
const quranPageIndicator = document.getElementById("quranPageIndicator");
const quranPageViewportEl = document.getElementById("quranPageViewport");
const quranPageContent = document.getElementById("quranPageContent");

const quranSearchInput = document.getElementById("quranSearchInput");
const quranSearchResults = document.getElementById("quranSearchResults");

const quranSurahSelect = document.getElementById("quranSurahSelect");
const quranJuzSelect = document.getElementById("quranJuzSelect");
const quranPageInput = document.getElementById("quranPageInput");
const quranGoPageBtn = document.getElementById("quranGoPageBtn");
const quranStatus = document.getElementById("quranStatus");

const quranBookmarkNameInput = document.getElementById("quranBookmarkNameInput");
const quranAddBookmarkBtn = document.getElementById("quranAddBookmarkBtn");
const quranBookmarksList = document.getElementById("quranBookmarksList");

const quranReciterList = document.getElementById("quranReciterList");

const quranListenFromSurah = document.getElementById("quranListenFromSurah");
const quranListenFromAyah = document.getElementById("quranListenFromAyah");
const quranListenToSurah = document.getElementById("quranListenToSurah");
const quranListenToAyah = document.getElementById("quranListenToAyah");
const quranListenStartBtn = document.getElementById("quranListenStartBtn");
const quranListenError = document.getElementById("quranListenError");
const quranListenPlayer = document.getElementById("quranListenPlayer");
const quranListenNowPlaying = document.getElementById("quranListenNowPlaying");
const quranListenPauseBtn = document.getElementById("quranListenPauseBtn");
const quranListenStopBtn = document.getElementById("quranListenStopBtn");

// -------- state --------
let currentQuranPage = 1;
let quranCurrentPageContextLabel = "";
let quranTabInitialized = false;
let quranSurahOptionsLoaded = false;
let quranListenSurahsLoaded = false;

let quranSelectedReciter = QURAN_RECITERS[0].id;
try {
  const savedReciter = localStorage.getItem(QURAN_RECITER_KEY);
  if (savedReciter && QURAN_RECITERS.some((r) => r.id === savedReciter)) quranSelectedReciter = savedReciter;
} catch (e) { /* storage unavailable, ignore */ }

function escapeQuranHtml(str) {
  return (str || "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function toArabicDigits(n) {
  const map = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(n).split("").map((d) => (map[+d] !== undefined ? map[+d] : d)).join("");
}

// Strips Arabic diacritics (tashkeel/harakat) from a search query so
// it matches regardless of whether the person typed them — the search
// edition itself has none, so leaving them in would just fail to match.
function stripArabicDiacritics(s) {
  return (s || "").replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0670]/g, "");
}

// Local audio lookup (as opposed to app.js's fetchAyahAudioUrl, which
// is fixed to one reciter for solo/duel mode) — accepts either a
// global ayah number or a "surah:ayahInSurah" reference, both valid
// per alquran.cloud, and an edition id for the currently chosen reciter.
async function fetchQuranAyahAudioUrl(reference, edition) {
  const res = await fetch(`${API_BASE}ayah/${reference}/${edition}`, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP error");
  const json = await res.json();
  return json?.data?.audio || json?.data?.audioSecondary?.[0] || null;
}

// ============================================================
// Fixed-viewport sizing — the reading box gets an explicit pixel
// height (available viewport space, measured live) and the text
// shrinks to fit inside it, so the person never has to scroll to see
// a whole page. Falls back to an internal scroll only if a page still
// doesn't fit even at the smallest readable size.
// ============================================================
function resizeQuranShell() {
  const quranView = document.getElementById("view-quran");
  if (!quranView || !quranView.classList.contains("active") || !quranShellEl) return;
  const wrapEl = document.querySelector(".wrap");
  if (!wrapEl) return;

  const top = quranShellEl.getBoundingClientRect().top;
  const wrapPaddingBottom = parseFloat(getComputedStyle(wrapEl).paddingBottom) || 0;
  const available = window.innerHeight - top - wrapPaddingBottom - 8; // small safety margin
  quranShellEl.style.height = Math.max(280, available) + "px";
  fitQuranPageText();
}

function fitQuranPageText() {
  if (!quranPageViewportEl || !quranPageContent) return;
  const maxFont = 21, minFont = 12;
  let fontSize = maxFont;
  quranPageContent.style.fontSize = fontSize + "px";
  quranPageViewportEl.classList.remove("quran-viewport-scroll");

  while (quranPageContent.scrollHeight > quranPageViewportEl.clientHeight && fontSize > minFont) {
    fontSize -= 1;
    quranPageContent.style.fontSize = fontSize + "px";
  }
  if (quranPageContent.scrollHeight > quranPageViewportEl.clientHeight) {
    // Genuinely doesn't fit even at the smallest size — allow an
    // internal scroll rather than clip content or shrink further.
    quranPageViewportEl.classList.add("quran-viewport-scroll");
  }
}

let quranResizeDebounce = null;
window.addEventListener("resize", () => {
  clearTimeout(quranResizeDebounce);
  quranResizeDebounce = setTimeout(resizeQuranShell, 150);
});

// -------- entering the tab (called by switchView() in auth-ui.js) --------
async function enterQuranTab() {
  if (!quranSurahOptionsLoaded) {
    quranSurahOptionsLoaded = await populateQuranSurahSelect();
  }
  if (!quranTabInitialized) {
    quranTabInitialized = true;
    let startPage = 1;
    try {
      const saved = parseInt(localStorage.getItem(QURAN_LAST_PAGE_KEY), 10);
      if (Number.isFinite(saved) && saved >= 1 && saved <= 604) startPage = saved;
    } catch (e) { /* ignore */ }
    await quranGoToPage(startPage);
  }
  requestAnimationFrame(resizeQuranShell);
}

async function populateQuranSurahSelect() {
  try {
    const catalog = await fetchSurahCatalog(); // reused from app.js
    if (!catalog || !catalog.length) throw new Error("empty catalog");
    quranSurahSelect.innerHTML =
      '<option value="">اذهب إلى سورة...</option>' +
      catalog.map((s) => `<option value="${s.number}">${s.number}. ${escapeQuranHtml(s.name)}</option>`).join("");
    return true;
  } catch (e) {
    quranSurahSelect.innerHTML = '<option value="">تعذّر تحميل قائمة السور</option>';
    return false; // retried next time the tab is opened
  }
}

(function populateQuranJuzSelect() {
  let opts = '<option value="">اذهب إلى جزء...</option>';
  for (let j = 1; j <= 30; j++) opts += `<option value="${j}">الجزء ${toArabicDigits(j)}</option>`;
  quranJuzSelect.innerHTML = opts;
})();

// -------- rendering a page --------
function renderSurahDividerHtml(surah) {
  return `<div class="quran-surah-divider"><span>۞</span>${escapeQuranHtml(surah.name)}<span>۞</span></div>`;
}

// Groups the page's ayahs by surah (a page very rarely spans more
// than two) and inserts a divider — plus the Bismillah heading, for
// every surah except Al-Fatiha (whose ayah 1 already IS the Bismillah)
// and At-Tawbah (which traditionally has none) — whenever a surah
// actually starts on this page.
function buildQuranPageHtml(ayahs) {
  let html = "";
  let lastSurahNumber = null;
  let paragraphOpen = false;

  ayahs.forEach((ayah) => {
    if (ayah.surah.number !== lastSurahNumber) {
      if (paragraphOpen) html += "</p>";
      lastSurahNumber = ayah.surah.number;
      html += renderSurahDividerHtml(ayah.surah);
      if (ayah.numberInSurah === 1 && ayah.surah.number !== 1 && ayah.surah.number !== 9) {
        html += `<div class="quran-bismillah">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>`;
      }
      html += `<p class="quran-page-flow">`;
      paragraphOpen = true;
    }

    html +=
      `<span class="quran-ayah">${escapeQuranHtml(ayah.text)} ` +
      `<button type="button" class="quran-ayah-audio-btn" data-ayah-number="${ayah.number}" aria-label="استماع">🔊</button>` +
      `<span class="quran-ayah-num">${toArabicDigits(ayah.numberInSurah)}</span></span> `;
  });

  if (paragraphOpen) html += "</p>";
  return html;
}

// -------- navigation --------
async function quranGoToPage(page) {
  page = clamp(parseInt(page, 10) || 1, 1, 604); // clamp() reused from app.js
  currentQuranPage = page;
  quranStopAudio();
  try { localStorage.setItem(QURAN_LAST_PAGE_KEY, String(page)); } catch (e) { /* ignore */ }

  quranPageInput.value = page;
  quranPageIndicator.textContent = `الصفحة ${toArabicDigits(page)} من ٦٠٤`;
  quranPrevBtn.disabled = page <= 1;
  quranNextBtn.disabled = page >= 604;

  quranPageContent.innerHTML = '<div class="status">جاري التحميل...</div>';
  try {
    const ayahs = await fetchPageAyahs(page); // reused from app.js, shares its cache
    quranCurrentPageContextLabel = ayahs[0] ? `${ayahs[0].surah.name}، آية ${toArabicDigits(ayahs[0].numberInSurah)}` : "";
    quranPageContent.innerHTML = buildQuranPageHtml(ayahs);
  } catch (e) {
    quranCurrentPageContextLabel = "";
    quranPageContent.innerHTML = '<div class="status">تعذّر تحميل الصفحة. تحقق من الاتصال وحاول مرة أخرى.</div>';
  }
  resizeQuranShell(); // re-measures defensively and re-fits the text
}

quranGoPageBtn.addEventListener("click", () => quranGoToPage(quranPageInput.value));
quranPageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") quranGoToPage(quranPageInput.value);
});
quranPrevBtn.addEventListener("click", () => quranGoToPage(currentQuranPage - 1));
quranNextBtn.addEventListener("click", () => quranGoToPage(currentQuranPage + 1));

quranJuzSelect.addEventListener("change", () => {
  const num = parseInt(quranJuzSelect.value, 10);
  quranJuzSelect.value = "";
  if (!num) return;
  const page = JUZ_START_PAGE[num - 1]; // reused from app.js
  if (page) { closeQuranModal("quranGoToModal"); quranGoToPage(page); }
});

// Resolved via the API (ayah-by-reference "surah:1") rather than a
// hardcoded page table — one light request per surah, cached after
// first use, and can't drift out of sync with the actual mushaf data.
const quranSurahStartPageCache = new Map();
async function resolveSurahStartPage(surahNumber) {
  if (quranSurahStartPageCache.has(surahNumber)) return quranSurahStartPageCache.get(surahNumber);
  try {
    const res = await fetch(`${API_BASE}ayah/${surahNumber}:1/${EDITION}`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP error");
    const json = await res.json();
    const page = json?.data?.page || null;
    if (page) quranSurahStartPageCache.set(surahNumber, page);
    return page;
  } catch (e) {
    return null;
  }
}

quranSurahSelect.addEventListener("change", async () => {
  const num = parseInt(quranSurahSelect.value, 10);
  quranSurahSelect.value = "";
  if (!num) return;
  quranStatus.textContent = "جاري الانتقال...";
  const page = await resolveSurahStartPage(num);
  quranStatus.textContent = page ? "" : "تعذّر تحديد صفحة هذه السورة. حاول مرة أخرى.";
  if (page) { closeQuranModal("quranGoToModal"); await quranGoToPage(page); }
});

// -------- search --------
let quranSearchDebounceTimer = null;
quranSearchInput.addEventListener("input", () => {
  clearTimeout(quranSearchDebounceTimer);
  const q = quranSearchInput.value.trim();
  if (q.length < 2) {
    quranSearchResults.innerHTML = "";
    return;
  }
  quranSearchDebounceTimer = setTimeout(() => runQuranSearch(q), 500);
});

async function runQuranSearch(keyword) {
  const cleaned = stripArabicDiacritics(keyword).trim();
  if (!cleaned) {
    quranSearchResults.innerHTML = "";
    return;
  }
  quranSearchResults.innerHTML = '<div class="status">جاري البحث...</div>';
  try {
    const res = await fetch(`${API_BASE}search/${encodeURIComponent(cleaned)}/all/${QURAN_SEARCH_EDITION}`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP error");
    const json = await res.json();
    renderQuranSearchResults(json?.data?.matches || []);
  } catch (e) {
    quranSearchResults.innerHTML = '<div class="status">تعذّر البحث. تحقق من الاتصال وحاول مرة أخرى.</div>';
  }
}

function renderQuranSearchResults(matches) {
  if (!matches.length) {
    quranSearchResults.innerHTML = '<div class="status">لا توجد نتائج.</div>';
    return;
  }

  quranSearchResults.innerHTML = matches.slice(0, 30).map((m) => `
    <div class="quran-search-result" data-page="${m.page}">
      <div class="quran-search-result-loc">${escapeQuranHtml(m.surah?.name || "")} — آية ${toArabicDigits(m.numberInSurah)} — صفحة ${toArabicDigits(m.page)}</div>
      <div class="quran-search-result-text">${escapeQuranHtml(m.text)}</div>
    </div>`).join("");

  quranSearchResults.querySelectorAll(".quran-search-result").forEach((row) => {
    row.addEventListener("click", () => {
      const page = Number(row.dataset.page);
      quranSearchInput.value = "";
      quranSearchResults.innerHTML = "";
      closeQuranModal("quranSearchModal");
      if (page) quranGoToPage(page);
    });
  });
}

// -------- bookmarks (multiple, named — localStorage only, guest-friendly) --------
function loadQuranBookmarks() {
  try {
    const raw = localStorage.getItem(QURAN_BOOKMARKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveQuranBookmarks(list) {
  try { localStorage.setItem(QURAN_BOOKMARKS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

function renderQuranBookmarksList() {
  const list = loadQuranBookmarks();
  if (!list.length) {
    quranBookmarksList.innerHTML = '<div class="status">لا توجد علامات محفوظة بعد.</div>';
    return;
  }

  quranBookmarksList.innerHTML = list.map((b) => `
    <div class="quran-bookmark-row" data-id="${b.id}">
      <div class="quran-bookmark-info">
        <div class="quran-bookmark-name">${escapeQuranHtml(b.label)}</div>
        <div class="quran-bookmark-loc">صفحة ${toArabicDigits(b.page)}${b.context ? " — " + escapeQuranHtml(b.context) : ""}</div>
      </div>
      <div class="quran-bookmark-actions">
        <button type="button" class="btn small ghost quran-bookmark-go-btn">اذهب</button>
        <button type="button" class="btn small ghost danger quran-bookmark-delete-btn">حذف</button>
      </div>
    </div>`).join("");

  quranBookmarksList.querySelectorAll(".quran-bookmark-go-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".quran-bookmark-row").dataset.id;
      const b = loadQuranBookmarks().find((x) => x.id === id);
      closeQuranModal("quranBookmarksModal");
      if (b) quranGoToPage(b.page);
    });
  });
  quranBookmarksList.querySelectorAll(".quran-bookmark-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".quran-bookmark-row").dataset.id;
      saveQuranBookmarks(loadQuranBookmarks().filter((x) => x.id !== id));
      renderQuranBookmarksList();
    });
  });
}

quranAddBookmarkBtn.addEventListener("click", () => {
  const label = quranBookmarkNameInput.value.trim() || `صفحة ${currentQuranPage}`;
  const list = loadQuranBookmarks();
  list.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label,
    page: currentQuranPage,
    context: quranCurrentPageContextLabel,
    createdAt: Date.now(),
  });
  saveQuranBookmarks(list);
  quranBookmarkNameInput.value = "";
  renderQuranBookmarksList();
});

// -------- reciter choice --------
function renderQuranReciterList() {
  quranReciterList.innerHTML = QURAN_RECITERS.map((r) => `
    <div class="quran-reciter-row${r.id === quranSelectedReciter ? " selected" : ""}" data-id="${r.id}">
      <span>${escapeQuranHtml(r.name)}</span>
      ${r.id === quranSelectedReciter ? '<span class="quran-reciter-check">✓</span>' : ""}
    </div>`).join("");

  quranReciterList.querySelectorAll(".quran-reciter-row").forEach((row) => {
    row.addEventListener("click", () => {
      quranSelectedReciter = row.dataset.id;
      try { localStorage.setItem(QURAN_RECITER_KEY, quranSelectedReciter); } catch (e) { /* ignore */ }
      renderQuranReciterList();
    });
  });
}

// -------- per-ayah audio (tap a single ayah while reading) --------
let quranAudioEl = null;
let quranPlayingAyahNumber = null;

function quranStopAudio() {
  if (quranAudioEl) {
    quranAudioEl.pause();
    quranAudioEl.currentTime = 0;
    quranAudioEl = null;
  }
  quranPlayingAyahNumber = null;
  updateQuranAudioButtons();
}

function updateQuranAudioButtons() {
  quranPageContent.querySelectorAll(".quran-ayah-audio-btn").forEach((btn) => {
    const isPlaying = Number(btn.dataset.ayahNumber) === quranPlayingAyahNumber;
    btn.textContent = isPlaying ? "⏸️" : "🔊";
    btn.classList.toggle("playing", isPlaying);
  });
}

// Delegated (rather than per-button) since the page's whole content
// is re-rendered on every navigation.
quranPageContent.addEventListener("click", async (e) => {
  const btn = e.target.closest(".quran-ayah-audio-btn");
  if (!btn || btn.disabled) return;
  const num = Number(btn.dataset.ayahNumber);

  if (quranPlayingAyahNumber === num) {
    quranStopAudio();
    return;
  }
  quranStopAudio();
  btn.disabled = true;
  try {
    const url = await fetchQuranAyahAudioUrl(num, quranSelectedReciter);
    if (!url) throw new Error("no audio url");
    quranAudioEl = new Audio(url);
    quranPlayingAyahNumber = num;
    quranAudioEl.addEventListener("ended", quranStopAudio);
    await quranAudioEl.play();
    updateQuranAudioButtons();
  } catch (err) {
    quranStopAudio();
  } finally {
    btn.disabled = false;
  }
});

// -------- listen to a range (surah+ayah to surah+ayah, continuous) --------
async function populateQuranListenSurahSelects() {
  try {
    const catalog = await fetchSurahCatalog();
    if (!catalog || !catalog.length) throw new Error("empty catalog");
    const opts = catalog.map((s) => `<option value="${s.number}">${s.number}. ${escapeQuranHtml(s.name)}</option>`).join("");
    quranListenFromSurah.innerHTML = opts;
    quranListenToSurah.innerHTML = opts;
    return true;
  } catch (e) {
    return false;
  }
}

let quranCatalogByNumber = null;
async function getQuranCatalogMap() {
  if (quranCatalogByNumber) return quranCatalogByNumber;
  const catalog = await fetchSurahCatalog();
  quranCatalogByNumber = new Map(catalog.map((s) => [s.number, s]));
  return quranCatalogByNumber;
}

function compareSurahAyah(s1, a1, s2, a2) {
  return s1 !== s2 ? s1 - s2 : a1 - a2;
}

async function buildQuranRangeQueue(fromSurah, fromAyah, toSurah, toAyah) {
  const catalogMap = await getQuranCatalogMap();
  const queue = [];
  let s = fromSurah, a = fromAyah, guard = 0;
  while (guard++ < 6300) { // hard ceiling — total ayahs in the whole Quran
    queue.push({ surah: s, ayah: a });
    if (s === toSurah && a === toAyah) break;
    const info = catalogMap.get(s);
    if (!info) break;
    if (a < info.numberOfAyahs) {
      a += 1;
    } else {
      s += 1;
      a = 1;
      if (!catalogMap.has(s)) break; // ran past surah 114
    }
  }
  return queue;
}

let quranRangeQueue = [];
let quranRangeIndex = -1;
let quranRangeAudioEl = null;
let quranRangePaused = false;

async function quranPlayNextInRange() {
  quranRangeIndex += 1;
  if (quranRangeIndex >= quranRangeQueue.length) {
    quranListenNowPlaying.textContent = "✅ انتهى الاستماع للمقطع المحدد.";
    return;
  }
  const step = quranRangeQueue[quranRangeIndex];
  const catalogMap = await getQuranCatalogMap();
  const surahInfo = catalogMap.get(step.surah);
  quranListenNowPlaying.textContent =
    `🎧 ${surahInfo ? surahInfo.name : step.surah} — آية ${toArabicDigits(step.ayah)} ` +
    `(${toArabicDigits(quranRangeIndex + 1)}/${toArabicDigits(quranRangeQueue.length)})`;

  try {
    const url = await fetchQuranAyahAudioUrl(`${step.surah}:${step.ayah}`, quranSelectedReciter);
    if (!url) throw new Error("no audio url");
    if (quranRangeAudioEl) { quranRangeAudioEl.pause(); quranRangeAudioEl = null; }
    quranRangeAudioEl = new Audio(url);
    quranRangeAudioEl.addEventListener("ended", () => {
      if (!quranRangePaused) quranPlayNextInRange();
    });
    await quranRangeAudioEl.play();
  } catch (e) {
    quranListenNowPlaying.textContent = "تعذّر تشغيل أحد المقاطع، جارٍ المتابعة...";
    quranPlayNextInRange(); // skip the failed ayah and continue
  }
}

function quranRangeStop() {
  if (quranRangeAudioEl) { quranRangeAudioEl.pause(); quranRangeAudioEl.currentTime = 0; quranRangeAudioEl = null; }
  quranRangeQueue = [];
  quranRangeIndex = -1;
  quranRangePaused = false;
  quranListenPlayer.style.display = "none";
  quranListenNowPlaying.textContent = "";
  quranListenPauseBtn.textContent = "⏸️ إيقاف مؤقت";
}

quranListenStartBtn.addEventListener("click", async () => {
  quranListenError.textContent = "";
  const fromSurah = parseInt(quranListenFromSurah.value, 10);
  const fromAyah = parseInt(quranListenFromAyah.value, 10);
  const toSurah = parseInt(quranListenToSurah.value, 10);
  const toAyah = parseInt(quranListenToAyah.value, 10);

  if (!fromSurah || !toSurah || !fromAyah || !toAyah) {
    quranListenError.textContent = "الرجاء اختيار سورة ورقم آية للبداية والنهاية.";
    return;
  }
  if (compareSurahAyah(fromSurah, fromAyah, toSurah, toAyah) > 0) {
    quranListenError.textContent = "نقطة البداية يجب أن تكون قبل نقطة النهاية.";
    return;
  }

  const catalogMap = await getQuranCatalogMap();
  const fromInfo = catalogMap.get(fromSurah);
  const toInfo = catalogMap.get(toSurah);
  if (fromInfo && fromAyah > fromInfo.numberOfAyahs) {
    quranListenError.textContent = `سورة البداية تحتوي على ${fromInfo.numberOfAyahs} آية فقط.`;
    return;
  }
  if (toInfo && toAyah > toInfo.numberOfAyahs) {
    quranListenError.textContent = `سورة النهاية تحتوي على ${toInfo.numberOfAyahs} آية فقط.`;
    return;
  }

  quranRangeQueue = await buildQuranRangeQueue(fromSurah, fromAyah, toSurah, toAyah);
  quranRangeIndex = -1;
  quranRangePaused = false;
  quranListenPlayer.style.display = "block";
  quranPlayNextInRange();
});

quranListenPauseBtn.addEventListener("click", () => {
  if (!quranRangeAudioEl) return;
  if (quranRangePaused) {
    quranRangePaused = false;
    quranRangeAudioEl.play();
    quranListenPauseBtn.textContent = "⏸️ إيقاف مؤقت";
  } else {
    quranRangePaused = true;
    quranRangeAudioEl.pause();
    quranListenPauseBtn.textContent = "▶️ متابعة";
  }
});

quranListenStopBtn.addEventListener("click", quranRangeStop);

// -------- ⋮ menu + modals --------
const QURAN_MODAL_IDS = ["quranSearchModal", "quranGoToModal", "quranBookmarksModal", "quranReciterModal", "quranListenModal"];

function openQuranModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "flex";
  if (id === "quranBookmarksModal") {
    renderQuranBookmarksList();
  } else if (id === "quranReciterModal") {
    renderQuranReciterList();
  } else if (id === "quranListenModal" && !quranListenSurahsLoaded) {
    quranListenSurahsLoaded = true;
    populateQuranListenSurahSelects().then((ok) => { if (!ok) quranListenSurahsLoaded = false; });
  }
}

function closeQuranModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "none";
  if (id === "quranListenModal") quranRangeStop();
}

QURAN_MODAL_IDS.forEach((id) => {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeQuranModal(id); });
  overlay.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeQuranModal(btn.dataset.closeModal));
  });
});

quranMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = quranMenuDropdown.style.display === "flex";
  quranMenuDropdown.style.display = isOpen ? "none" : "flex";
  quranMenuBtn.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (e) => {
  if (quranMenuDropdown.style.display === "flex" && !quranMenuDropdown.contains(e.target) && e.target !== quranMenuBtn) {
    quranMenuDropdown.style.display = "none";
    quranMenuBtn.setAttribute("aria-expanded", "false");
  }
});

quranMenuDropdown.querySelectorAll(".quran-menu-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    quranMenuDropdown.style.display = "none";
    quranMenuBtn.setAttribute("aria-expanded", "false");
    openQuranModal(btn.dataset.modal);
  });
});
