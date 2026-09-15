#!/usr/bin/env node
// Corrects mislabeled "surah-header" lines directly in the downloaded
// mushaf-layout/*.json files (not just the derived quran-index).
//
// derive-quran-index.js already stopped trusting these header lines
// for TEXT, search, and quiz generation — but the Quran reader view
// still reads line.text straight off these files for two things that
// derive-quran-index.js never touches:
//   - the on-page surah-divider banner (buildMushafPageHtml)
//   - the bookmark list's page label (computeQuranPageContextLabel)
// Both would still show the wrong name on any affected page even
// after that fix, since they're reading the raw file, not the index.
// This corrects the raw file itself.
//
// Two known-bad examples, spot-checked by hand:
//   page-076.json (last line) says surah "003" / "سورة آل عمران",
//     should be surah 4 / "سورة النساء"
//   page-417.json (last line) says surah "032" / "سورة السجدة",
//     should be surah 33 / "سورة الأحزاب"
// There may be others — this checks every one of the 604 pages
// rather than only those two.
//
// How it decides what's correct, without trusting any header's own
// fields: every ayah's true surah/ayah number is already reliably
// encoded in its words' "location" field (e.g. "4:1:1"), which is
// what actually builds ayah text elsewhere in this project and has
// shown no such corruption. This derives each surah's true start
// page from that (same approach as derive-quran-index.js), then
// walks every "surah-header" line in the order it's encountered
// across all 604 pages, matching each one to the next surah whose
// start page it could plausibly be announcing — either that surah's
// own start page, or (as in both examples above) the tail end of the
// page right before it, which is how the printed Mushaf pre-announces
// a new surah when the previous one runs out of room mid-page.
// Anything it can't confidently match is left untouched and reported
// for manual review, rather than guessed at.
//
// Usage (run from the repo root, mushaf-layout/ already downloaded):
//   node fix-mushaf-surah-headers.js          # dry run — reports only
//   node fix-mushaf-surah-headers.js --write  # applies fixes to disk
//
// Always read the dry-run report before using --write. After
// --write, re-run `node derive-quran-index.js` and commit BOTH the
// corrected mushaf-layout/*.json files and the regenerated
// quran-index/*.json files.

const fs = require("fs");
const path = require("path");

const MUSHAF_DIR = path.join(__dirname, "mushaf-layout");
const TOTAL_PAGES = 604;
const EXPECTED_SURAHS = 114;
const WRITE = process.argv.includes("--write");
const LOOKAHEAD = 5; // how many surahs ahead to search for a plausible match per header

// Same canonical list as derive-quran-index.js — kept in sync deliberately.
const SURAH_NAMES = [
  "سورة الفاتحة", "سورة البقرة", "سورة آل عمران", "سورة النساء", "سورة المائدة",
  "سورة الأنعام", "سورة الأعراف", "سورة الأنفال", "سورة التوبة", "سورة يونس",
  "سورة هود", "سورة يوسف", "سورة الرعد", "سورة إبراهيم", "سورة الحجر",
  "سورة النحل", "سورة الإسراء", "سورة الكهف", "سورة مريم", "سورة طه",
  "سورة الأنبياء", "سورة الحج", "سورة المؤمنون", "سورة النور", "سورة الفرقان",
  "سورة الشعراء", "سورة النمل", "سورة القصص", "سورة العنكبوت", "سورة الروم",
  "سورة لقمان", "سورة السجدة", "سورة الأحزاب", "سورة سبأ", "سورة فاطر",
  "سورة يس", "سورة الصافات", "سورة ص", "سورة الزمر", "سورة غافر",
  "سورة فصلت", "سورة الشورى", "سورة الزخرف", "سورة الدخان", "سورة الجاثية",
  "سورة الأحقاف", "سورة محمد", "سورة الفتح", "سورة الحجرات", "سورة ق",
  "سورة الذاريات", "سورة الطور", "سورة النجم", "سورة القمر", "سورة الرحمن",
  "سورة الواقعة", "سورة الحديد", "سورة المجادلة", "سورة الحشر", "سورة الممتحنة",
  "سورة الصف", "سورة الجمعة", "سورة المنافقون", "سورة التغابن", "سورة الطلاق",
  "سورة التحريم", "سورة الملك", "سورة القلم", "سورة الحاقة", "سورة المعارج",
  "سورة نوح", "سورة الجن", "سورة المزمل", "سورة المدثر", "سورة القيامة",
  "سورة الإنسان", "سورة المرسلات", "سورة النبأ", "سورة النازعات", "سورة عبس",
  "سورة التكوير", "سورة الانفطار", "سورة المطففين", "سورة الانشقاق", "سورة البروج",
  "سورة الطارق", "سورة الأعلى", "سورة الغاشية", "سورة الفجر", "سورة البلد",
  "سورة الشمس", "سورة الليل", "سورة الضحى", "سورة الشرح", "سورة التين",
  "سورة العلق", "سورة القدر", "سورة البينة", "سورة الزلزلة", "سورة العاديات",
  "سورة القارعة", "سورة التكاثر", "سورة العصر", "سورة الهمزة", "سورة الفيل",
  "سورة قريش", "سورة الماعون", "سورة الكوثر", "سورة الكافرون", "سورة النصر",
  "سورة المسد", "سورة الإخلاص", "سورة الفلق", "سورة الناس",
];

function pageFile(p) {
  return path.join(MUSHAF_DIR, `page-${String(p).padStart(3, "0")}.json`);
}

function main() {
  if (!fs.existsSync(MUSHAF_DIR)) {
    console.error(`Error: ${MUSHAF_DIR} not found. Run download-mushaf-layout.sh first.`);
    process.exit(1);
  }

  const pageData = new Map();

  // -------- pass 1: ground truth surah start pages, from ayah locations --------
  const surahStartPage = new Map(); // surah number -> page
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    const fp = pageFile(p);
    if (!fs.existsSync(fp)) {
      console.error(`Missing ${fp} — re-run download-mushaf-layout.sh to fill in gaps, then try again.`);
      process.exit(1);
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (e) {
      console.error(`Malformed JSON in ${fp}: ${e.message}`);
      process.exit(1);
    }
    pageData.set(p, data);
    for (const line of (data.lines || [])) {
      if (line.type !== "text") continue;
      for (const w of (line.words || [])) {
        const loc = (w.location || "").split(":");
        const surahNum = parseInt(loc[0], 10);
        const ayahNum = parseInt(loc[1], 10);
        if (surahNum && ayahNum === 1 && !surahStartPage.has(surahNum)) {
          surahStartPage.set(surahNum, p);
        }
      }
    }
  }

  if (surahStartPage.size !== EXPECTED_SURAHS) {
    console.warn(
      `Warning: found ${surahStartPage.size} distinct surahs via ayah locations, expected ${EXPECTED_SURAHS}. ` +
      `Fix that first (see derive-quran-index.js's own warnings) before trusting this script's matching — ` +
      `it relies on this ground truth being complete.`
    );
  }

  // -------- pass 2: collect every surah-header line, in page/line order --------
  const headers = [];
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    (pageData.get(p).lines || []).forEach((line, idx) => {
      if (line.type === "surah-header") headers.push({ page: p, lineIndex: idx, lineObj: line });
    });
  }

  // -------- pass 3: match headers to surahs by expected start page --------
  let expected = 1;
  let fixedCount = 0;
  const unresolved = [];
  const changedPages = new Set();

  for (const h of headers) {
    // Which surah, starting from `expected`, could this header
    // plausibly be announcing? Either its own start page, or the
    // tail end of the page right before it.
    let matched = null;
    for (let n = expected; n <= Math.min(EXPECTED_SURAHS, expected + LOOKAHEAD); n++) {
      const sp = surahStartPage.get(n);
      if (sp === h.page || sp === h.page + 1) { matched = n; break; }
    }

    if (matched == null) {
      unresolved.push(h);
      continue; // leave this header untouched; don't advance `expected`
    }

    if (matched > expected) {
      for (let missing = expected; missing < matched; missing++) {
        console.warn(
          `No header line found anywhere for surah ${missing} (${SURAH_NAMES[missing - 1]}, ` +
          `starts page ${surahStartPage.get(missing)}) — needs manual insertion, this script can't fabricate a missing line.`
        );
      }
    }

    const correctSurahStr = String(matched).padStart(3, "0");
    const correctName = SURAH_NAMES[matched - 1];
    const originalSurahNum = parseInt(h.lineObj.surah, 10);
    // Only touch headers whose NUMBER is actually wrong — i.e. the real
    // corruption this script exists to fix. A correctly-numbered header
    // with different (but authentic) styling, like Al-Fatiha's header
    // using full tashkeel where this script's plain-style canonical
    // list doesn't, is not a bug and is left exactly as it is.
    if (originalSurahNum !== matched) {
      const lineNum = h.lineObj.line ?? h.lineIndex + 1;
      console.log(
        `page-${String(h.page).padStart(3, "0")}.json line ${lineNum}: ` +
        `"${h.lineObj.text}" (surah ${h.lineObj.surah}) -> "${correctName}" (surah ${correctSurahStr})`
      );
      h.lineObj.surah = correctSurahStr;
      h.lineObj.text = correctName;
      changedPages.add(h.page);
      fixedCount++;
    }
    expected = matched + 1;
  }

  if (expected <= EXPECTED_SURAHS) {
    for (let missing = expected; missing <= EXPECTED_SURAHS; missing++) {
      console.warn(
        `No header line found anywhere for surah ${missing} (${SURAH_NAMES[missing - 1]}, ` +
        `starts page ${surahStartPage.get(missing)}) — needs manual insertion.`
      );
    }
  }

  if (unresolved.length) {
    console.warn(`\n${unresolved.length} header(s) could not be confidently matched to a surah and were left untouched — review by hand:`);
    unresolved.forEach((h) => {
      const lineNum = h.lineObj.line ?? h.lineIndex + 1;
      console.warn(`  page-${String(h.page).padStart(3, "0")}.json line ${lineNum}: "${h.lineObj.text}" (surah ${h.lineObj.surah})`);
    });
  }

  console.log(`\n${fixedCount} header(s) corrected across ${changedPages.size} page(s).`);

  if (!WRITE) {
    console.log("Dry run only — nothing written. Re-run with --write to save these changes to disk.");
    return;
  }

  for (const p of changedPages) {
    fs.writeFileSync(pageFile(p), JSON.stringify(pageData.get(p), null, 2) + "\n", "utf8");
  }
  console.log(`Wrote ${changedPages.size} corrected page file(s).`);
  console.log("Now re-run: node derive-quran-index.js  (and commit both the corrected mushaf-layout files and the regenerated quran-index files)");
}

main();
