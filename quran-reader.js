// Quran reading tab (📖 القرآن) — a fixed-to-viewport reader that
// renders the REAL 604-page, 15-line-per-page Mushaf layout (from a
// locally-mirrored dataset — see download-mushaf-layout.sh and
// mushaf-layout/page-XXX.json), not a re-flowed paragraph. The screen
// itself only ever shows the page; search, page/surah/juz navigation,
// bookmarks, reciter choice, and listen-to-a-range all live behind
// the ⋮ menu as modals. Works fully offline-capable for guests too —
// page text, surah info, ayah->page lookups, and search all run
// against our own derived index (see derive-quran-index.js), with
// zero dependency on alquran.cloud or any other API for text. Audio
// is the one exception (a different medium — can't be derived from
// text), served as direct static files from everyayah.com per the
// selected reciter, again with no API layer in between.
//
// Deliberately loaded AFTER app.js (see index.html) and reuses its
// globals directly rather than re-declaring them — clamp(),
// fetchSurahCatalog(), and fetchLocalAyahIndex() (all share app.js's
// own caches) come from app.js. This mirrors how auth-ui.js and
// app.js already share globals across script tags in this project.

const QURAN_LAST_PAGE_KEY = "qf_quran_last_page";
const QURAN_BOOKMARKS_KEY = "qf_quran_bookmarks";
const QURAN_RECITER_KEY = "qf_quran_reciter";

// `id` values are kept exactly as before so nobody's saved
// localStorage reciter preference resets; `folder` is the matching
// everyayah.com directory name (verified directly against their file
// listing), used by fetchQuranAyahAudioUrl() below.
const QURAN_RECITERS = [
  { id: "ar.alafasy", name: "مشاري راشد العفاسي", folder: "Alafasy_128kbps" },
  { id: "ar.abdulbasitmurattal", name: "عبد الباسط عبد الصمد (مرتل)", folder: "Abdul_Basit_Murattal_192kbps" },
  { id: "ar.husary", name: "محمود خليل الحصري", folder: "Husary_128kbps" },
  { id: "ar.minshawi", name: "محمد صديق المنشاوي (مرتل)", folder: "Minshawy_Murattal_128kbps" },
  { id: "ar.abdurrahmaansudais", name: "عبد الرحمن السديس", folder: "Abdurrahmaan_As-Sudais_192kbps" },
  { id: "ar.mahermuaiqly", name: "ماهر المعيقلي", folder: "MaherAlMuaiqly128kbps" },
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

// Builds a regex that matches a (diacritic-stripped) query against
// full-tashkeel Uthmani text — necessary because the page always
// displays complete diacritics while search itself is diacritic-free.
// Also tolerates the common Arabic spelling variants (أ/إ/آ vs ا,
// ى vs ي, ة vs ه) so a search doesn't miss a real match just because
// it was typed with a different (but equivalent) letter form. Used
// both to double-check a result actually contains the text (the
// search API's own matches aren't always literal substrings) and to
// highlight it wherever it's shown.
function buildArabicHighlightRegex(query) {
  const cleaned = stripArabicDiacritics(query).trim();
  if (!cleaned) return null;
  const equivalents = {
    "ا": "[اأإآ]", "أ": "[اأإآ]", "إ": "[اأإآ]", "آ": "[اأإآ]",
    "ى": "[ىي]", "ي": "[ىي]",
    "ة": "[ةه]", "ه": "[ةه]",
  };
  const diacriticsGap = "[\\u0610-\\u061A\\u064B-\\u065F\\u06D6-\\u06ED\\u0670]*";
  const pattern = cleaned.split("").map((ch) => {
    const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return equivalents[ch] || escaped;
  }).join(diacriticsGap);

  try {
    return new RegExp(pattern, "g");
  } catch (e) {
    return null;
  }
}

// Escapes each text segment individually and wraps matches in <mark>
// — never runs escaping on already-built HTML, so this stays safe.
function highlightArabicText(text, regex) {
  if (!regex) return escapeQuranHtml(text);
  regex.lastIndex = 0;
  let result = "";
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) { regex.lastIndex += 1; continue; }
    result += escapeQuranHtml(text.slice(lastIndex, match.index));
    result += `<mark class="quran-highlight">${escapeQuranHtml(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;
  }
  result += escapeQuranHtml(text.slice(lastIndex));
  return result;
}

// Resolves the true page (and authoritative global ayah number) for a
// specific ayah via the ayah-by-reference endpoint — deliberately NOT
// trusting the search API's own "page"/"number" fields for navigation,
// since they don't always line up with the actual result.
// "surah:ayah" string — our local ayah index (and the mirrored
// line-layout dataset) identifies ayahs this way, not by a global
// ayah number, so highlighting keys off the same thing.
let quranHighlightAyahKey = null;
let quranHighlightRegex = null;

// A direct static-file URL — no API call needed. everyayah.com serves
// every reciter's audio as plain files named {surah:03d}{ayah:03d}.mp3
// (verified directly against their file listing). `reference` is a
// "surah:ayahInSurah" string; `reciterId` maps to a folder via
// QURAN_RECITERS below.
function fetchQuranAyahAudioUrl(reference, reciterId) {
  const parts = String(reference).split(":").map((n) => parseInt(n, 10));
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const reciter = QURAN_RECITERS.find((r) => r.id === reciterId) || QURAN_RECITERS[0];
  const surahPadded = String(parts[0]).padStart(3, "0");
  const ayahPadded = String(parts[1]).padStart(3, "0");
  return `https://everyayah.com/data/${reciter.folder}/${surahPadded}${ayahPadded}.mp3`;
}

// ============================================================
// Fixed-viewport sizing — the reading box gets an explicit pixel
// height (available viewport space, measured live). Actual vertical
// distribution of the mirrored dataset's real Mushaf lines across
// that height is handled declaratively by CSS (.quran-mushaf-lines
// uses justify-content: space-between, so the last line always lands
// exactly at the bottom edge) — the only thing JS still needs to do
// is pick a font-size small enough that every individual line fits
// its available WIDTH without wrapping, since each dataset line must
// render as exactly one visual line to match the real Mushaf.
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
  fitMushafPage();
}

function fitMushafPage() {
  if (!quranPageContent) return;
  const maxFont = 24, minFont = 10;
  let fontSize = maxFont;

  quranPageContent.style.fontSize = fontSize + "px";
  quranPageContent.classList.remove("quran-viewport-scroll");

  const textLines = () => Array.from(quranPageContent.querySelectorAll(".quran-line-text"));
  // Reset any per-line spacing left over from a previous page/resize
  // before measuring — otherwise old values would throw off both the
  // width-fit loop and justifyMushafLine()'s "natural width" reading.
  textLines().forEach((el) => {
    el.style.columnGap = "0px";
    el.style.letterSpacing = "0px";
    el.style.justifyContent = "";
  });

  const anyLineOverflowsWidth = () =>
    Array.from(quranPageContent.querySelectorAll(".quran-mushaf-line"))
      .some((el) => el.scrollWidth > el.clientWidth + 1);

  // Shrink until every individual line fits its available width
  // without wrapping — a dataset "line" that wrapped into two visual
  // rows would break the real 15-line-per-page layout entirely.
  while (anyLineOverflowsWidth() && fontSize > minFont) {
    fontSize -= 1;
    quranPageContent.style.fontSize = fontSize + "px";
  }

  // Stretch each line to reach both margins, like justified Mushaf
  // typesetting — but instead of dumping all the extra space into
  // just the gaps between words (which looks absurd on a sparse
  // line — a couple of words stretched apart with a huge gap), this
  // spreads it across every word-gap up to a sane per-gap cap, then
  // bleeds any remainder into subtle letter-spacing so it never looks
  // like floating disconnected words.
  textLines().forEach((el) => justifyMushafLine(el, fontSize));

  // Even at the smallest readable size the whole block might still be
  // taller than the box on an unusually small screen — fall back to
  // an internal scroll rather than clip content.
  if (quranPageContent.scrollHeight > quranPageContent.clientHeight) {
    quranPageContent.classList.add("quran-viewport-scroll");
  }
}

// Stretches one text line to fill its full width. gap/letter-spacing
// are reset to 0 by the caller before this reads el.scrollWidth, so
// that's the line's true tightest natural width at the chosen font
// size. Word-gaps absorb the stretch first (capped per-gap so two
// words never end up looking like they floated apart), and whatever's
// left bleeds into letter-spacing, verified against the real rendered
// width each step rather than trusting character-count math (Arabic
// diacritics make that math approximate at best).
function justifyMushafLine(el, fontSize) {
  if (el.children.length <= 1) {
    el.style.justifyContent = "center"; // nothing to put a gap between
    return;
  }

  const targetWidth = el.clientWidth;
  const naturalWidth = el.scrollWidth;
  const gapNeeded = targetWidth - naturalWidth;
  if (gapNeeded <= 1) return; // already fills the line

  const numGaps = el.children.length - 1;
  const maxGapPx = fontSize * 1.1;
  // Real kashida elongates letter connectors, not the gaps between
  // every letter — capping here keeps this approximation from turning
  // into visibly loose, harder-to-read text on very sparse lines.
  const maxLetterSpacingPx = fontSize * 0.12;
  const gapPx = Math.max(0, Math.min(maxGapPx, gapNeeded / numGaps));
  el.style.columnGap = gapPx + "px";

  for (let i = 0; i < 4; i++) {
    const diff = targetWidth - el.scrollWidth;
    if (Math.abs(diff) < 1) break;
    const totalChars = el.textContent.replace(/\s/g, "").length || 1;
    const current = parseFloat(el.style.letterSpacing) || 0;
    const next = Math.max(0, Math.min(maxLetterSpacingPx, current + diff / totalChars));
    el.style.letterSpacing = next + "px";
    if (next === current) break; // hit the cap, no more room to give
  }

  // A genuinely very short line (a handful of words) can hit both caps
  // and still fall short — center that leftover shortfall so it reads
  // as a balanced short line rather than one-sided empty space.
  if (targetWidth - el.scrollWidth > 2) {
    el.style.justifyContent = "center";
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

// Where the mirrored 604-page dataset lives (see download-mushaf-layout.sh)
// — one JSON file per page, e.g. mushaf-layout/page-002.json.
const QURAN_MUSHAF_LAYOUT_BASE = "mushaf-layout";

const quranMushafPageCache = new Map();
async function fetchMushafPageLayout(page) {
  if (quranMushafPageCache.has(page)) return quranMushafPageCache.get(page);
  const padded = String(page).padStart(3, "0");
  // force-cache (unlike the "no-store" API calls elsewhere) since
  // these are static, versioned files hosted alongside the app itself.
  const res = await fetch(`${QURAN_MUSHAF_LAYOUT_BASE}/page-${padded}.json`, { cache: "force-cache" });
  if (!res.ok) throw new Error("HTTP error " + res.status);
  const data = await res.json();
  quranMushafPageCache.set(page, data);
  return data;
}

// The dataset appends the ayah's own (Arabic-Indic) number straight
// onto the last word's text of every verse, e.g. "ٱلرَّحِيمِ ١" — this
// pulls that back off so it can be shown as its own styled badge
// instead of plain trailing text.
function splitEmbeddedAyahNumber(wordText) {
  const match = (wordText || "").match(/\s*([\u0660-\u0669]+)\s*$/);
  if (!match) return { text: wordText || "", number: null };
  return { text: wordText.slice(0, match.index).trimEnd(), number: match[1] };
}

function renderMushafWordHtml(word) {
  const { text, number } = splitEmbeddedAyahNumber(word.word);
  const [surahStr, ayahStr] = (word.location || "").split(":");
  const surahNum = parseInt(surahStr, 10) || null;
  const ayahNum = parseInt(ayahStr, 10) || null;
  const isTarget = surahNum && ayahNum && quranHighlightAyahKey === `${surahNum}:${ayahNum}`;

  const textHtml = (isTarget && quranHighlightRegex)
    ? highlightArabicText(text, quranHighlightRegex)
    : escapeQuranHtml(text);

  let html = `<span class="quran-word${isTarget ? " quran-ayah-target" : ""}">${textHtml}</span>`;

  // Only the ayah-ending word (the one carrying the embedded number)
  // gets the listen button + number badge — matches the printed
  // Mushaf's own end-of-ayah marker convention.
  if (number && surahNum && ayahNum) {
    html +=
      `<button type="button" class="quran-ayah-audio-btn" data-surah="${surahNum}" data-ayah="${ayahNum}" aria-label="استماع">🔊</button>` +
      `<span class="quran-ayah-num">${number}</span>`;
  }
  return html;
}

// Renders the real 604-page Mushaf layout: one row per dataset line
// (surah-header / basmala / text), matching the actual printed
// 15-line-per-page arrangement rather than a re-flowed paragraph.
// Vertical distribution across the full page height is handled by
// CSS (.quran-mushaf-lines) — see fitMushafPage() for the width side.
function buildMushafPageHtml(data) {
  const lines = data?.lines || [];
  let html = '<div class="quran-mushaf-lines">';

  lines.forEach((line) => {
    if (line.type === "surah-header") {
      html += `<div class="quran-mushaf-line quran-line-header">${renderSurahDividerHtml({ name: line.text })}</div>`;
    } else if (line.type === "basmala") {
      html += `<div class="quran-mushaf-line quran-line-basmala"><div class="quran-bismillah">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div></div>`;
    } else if (line.type === "text") {
      const wordsHtml = (line.words || []).map(renderMushafWordHtml).join("");
      html += `<div class="quran-mushaf-line quran-line-text">${wordsHtml}</div>`;
    }
  });

  html += "</div>";
  return html;
}

// A short label describing what's on the page, for the bookmarks list.
function computeQuranPageContextLabel(data) {
  const header = (data?.lines || []).find((l) => l.type === "surah-header");
  if (header) return header.text;
  const firstText = (data?.lines || []).find((l) => l.type === "text");
  return firstText?.verseRange || "";
}

// -------- navigation --------
async function quranGoToPage(page, options) {
  options = options || {};
  page = clamp(parseInt(page, 10) || 1, 1, 604); // clamp() reused from app.js
  currentQuranPage = page;
  quranStopAudio();
  if (!options.preserveHighlight) {
    quranHighlightAyahKey = null;
    quranHighlightRegex = null;
  }
  try { localStorage.setItem(QURAN_LAST_PAGE_KEY, String(page)); } catch (e) { /* ignore */ }

  quranPageInput.value = page;
  quranPageIndicator.textContent = `الصفحة ${toArabicDigits(page)} من ٦٠٤`;
  quranPrevBtn.disabled = page <= 1;
  quranNextBtn.disabled = page >= 604;

  quranPageContent.innerHTML = '<div class="status">جاري التحميل...</div>';
  try {
    const data = await fetchMushafPageLayout(page);
    quranCurrentPageContextLabel = computeQuranPageContextLabel(data);
    quranPageContent.innerHTML = buildMushafPageHtml(data);
  } catch (e) {
    quranCurrentPageContextLabel = "";
    quranPageContent.innerHTML =
      '<div class="status">تعذّر تحميل الصفحة. تأكد من رفع مجلد mushaf-layout بشكل صحيح، ثم حاول مرة أخرى.</div>';
  }
  resizeQuranShell(); // re-measures defensively and re-fits the text

  if (quranHighlightAyahKey) {
    const targetEl = quranPageContent.querySelector(".quran-ayah-target");
    // Normally the whole page is visible at once (that's the point of
    // the auto-fit sizing), so this only actually moves anything in
    // the rare case a page fell back to its internal scroll mode.
    if (targetEl) requestAnimationFrame(() => targetEl.scrollIntoView({ block: "center" }));
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
  if (page) { closeQuranModal("quranGoToModal"); quranGoToPage(page); }
});

// fetchSurahCatalog() (reused from app.js) is backed by our own
// derived index now, which already carries each surah's startPage —
// no API call needed, and it's already cached by that function itself.
async function resolveSurahStartPage(surahNumber) {
  const catalog = await fetchSurahCatalog();
  const entry = catalog.find((s) => s.number === surahNumber);
  return entry ? entry.startPage : null;
}

function setQuranStatus(msg) {
  quranStatus.textContent = msg || "";
  quranStatus.style.display = msg ? "block" : "none";
}

quranSurahSelect.addEventListener("change", async () => {
  const num = parseInt(quranSurahSelect.value, 10);
  quranSurahSelect.value = "";
  if (!num) return;
  setQuranStatus("جاري الانتقال...");
  const page = await resolveSurahStartPage(num);
  setQuranStatus(page ? "" : "تعذّر تحديد صفحة هذه السورة. حاول مرة أخرى.");
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

// Fully local now — scans our own derived ayah index (the same data
// backing fetchPageAyahs() in app.js) instead of calling any search
// API. Since we generated this data ourselves, its page/surah/ayah
// fields are already trustworthy — no separate "verify via a second
// lookup" step is needed the way the old API-backed version required.
async function runQuranSearch(keyword) {
  const cleaned = stripArabicDiacritics(keyword).trim();
  if (!cleaned) {
    quranSearchResults.innerHTML = "";
    return;
  }
  const regex = buildArabicHighlightRegex(keyword);
  if (!regex) {
    quranSearchResults.innerHTML = "";
    return;
  }
  quranSearchResults.innerHTML = '<div class="status">جاري البحث...</div>';
  try {
    const allAyahs = await fetchLocalAyahIndex(); // reused from app.js
    const matches = [];
    for (const a of allAyahs) {
      regex.lastIndex = 0;
      if (regex.test(a.text)) {
        matches.push(a);
        if (matches.length >= 30) break;
      }
    }
    renderQuranSearchResults(matches, regex);
  } catch (e) {
    quranSearchResults.innerHTML = '<div class="status">تعذّر تحميل فهرس البحث. تأكد من رفع مجلد quran-index بشكل صحيح.</div>';
  }
}

function renderQuranSearchResults(matches, regex) {
  quranSearchResults.innerHTML = "";
  if (!matches.length) {
    quranSearchResults.innerHTML = '<div class="status">لا توجد نتائج.</div>';
    return;
  }

  matches.forEach((m) => {
    const row = document.createElement("div");
    row.className = "quran-search-result";
    row.innerHTML =
      `<div class="quran-search-result-loc">${escapeQuranHtml(m.surahName || "")} — آية ${toArabicDigits(m.ayah)}</div>` +
      `<div class="quran-search-result-text">${highlightArabicText(m.text || "", regex)}</div>`;
    row.addEventListener("click", () => {
      quranSearchInput.value = "";
      quranSearchResults.innerHTML = "";
      closeQuranModal("quranSearchModal");
      quranHighlightAyahKey = `${m.surah}:${m.ayah}`;
      quranHighlightRegex = regex;
      quranGoToPage(m.page, { preserveHighlight: true });
    });
    quranSearchResults.appendChild(row);
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
let quranPlayingAyahKey = null; // "surah:ayah"

function quranStopAudio() {
  if (quranAudioEl) {
    quranAudioEl.pause();
    quranAudioEl.currentTime = 0;
    quranAudioEl = null;
  }
  quranPlayingAyahKey = null;
  updateQuranAudioButtons();
}

function updateQuranAudioButtons() {
  quranPageContent.querySelectorAll(".quran-ayah-audio-btn").forEach((btn) => {
    const key = `${btn.dataset.surah}:${btn.dataset.ayah}`;
    const isPlaying = key === quranPlayingAyahKey;
    btn.textContent = isPlaying ? "⏸️" : "🔊";
    btn.classList.toggle("playing", isPlaying);
  });
}

// Delegated (rather than per-button) since the page's whole content
// is re-rendered on every navigation.
quranPageContent.addEventListener("click", async (e) => {
  const btn = e.target.closest(".quran-ayah-audio-btn");
  if (!btn || btn.disabled) return;
  const key = `${btn.dataset.surah}:${btn.dataset.ayah}`;

  if (quranPlayingAyahKey === key) {
    quranStopAudio();
    return;
  }
  quranStopAudio();
  btn.disabled = true;
  try {
    const url = await fetchQuranAyahAudioUrl(key, quranSelectedReciter);
    if (!url) throw new Error("no audio url");
    quranAudioEl = new Audio(url);
    quranPlayingAyahKey = key;
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