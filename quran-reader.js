// Quran reading tab (📖 القرآن) — page-by-page Uthmani text with
// page/surah/juz navigation and full-Quran text search, plus a
// per-ayah listen button. Entirely client-side against the same
// alquran.cloud API the rest of the app already uses; works for
// guests too, no account or Supabase involvement at all.
//
// Deliberately loaded AFTER app.js (see index.html) and reuses its
// globals directly rather than re-declaring them — API_BASE, EDITION,
// clamp(), fetchPageAyahs() (shares its page cache), fetchSurahCatalog()
// (shares its cache), fetchAyahAudioUrl(), and JUZ_START_PAGE all come
// from app.js. This mirrors how auth-ui.js and app.js already share
// globals across script tags in this project.

const QURAN_LAST_PAGE_KEY = "qf_quran_last_page";
// A non-diacritic Arabic edition — the Uthmani script's full tashkeel
// makes typed search brittle, so search runs against this instead;
// the page itself still always renders full Uthmani text as usual.
const QURAN_SEARCH_EDITION = "quran-simple";

const quranSearchInput = document.getElementById("quranSearchInput");
const quranSearchResults = document.getElementById("quranSearchResults");
const quranSurahSelect = document.getElementById("quranSurahSelect");
const quranJuzSelect = document.getElementById("quranJuzSelect");
const quranPageInput = document.getElementById("quranPageInput");
const quranGoPageBtn = document.getElementById("quranGoPageBtn");
const quranStatus = document.getElementById("quranStatus");
const quranPrevBtn = document.getElementById("quranPrevBtn");
const quranNextBtn = document.getElementById("quranNextBtn");
const quranPageIndicator = document.getElementById("quranPageIndicator");
const quranPageContent = document.getElementById("quranPageContent");

let currentQuranPage = 1;
let quranTabInitialized = false;
let quranSurahOptionsLoaded = false;

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
    } catch (e) { /* storage unavailable, ignore */ }
    await quranGoToPage(startPage);
  }
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
    quranPageContent.innerHTML = buildQuranPageHtml(ayahs);
  } catch (e) {
    quranPageContent.innerHTML = '<div class="status">تعذّر تحميل الصفحة. تحقق من الاتصال وحاول مرة أخرى.</div>';
  }
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
  if (page) quranGoToPage(page);
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
  if (page) await quranGoToPage(page);
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
      if (page) quranGoToPage(page);
    });
  });
}

// -------- per-ayah audio (reuses app.js's fetchAyahAudioUrl) --------
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
    const url = await fetchAyahAudioUrl(num); // reused from app.js
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
