#!/usr/bin/env node
// Derives a self-contained Quran text index — surah catalog + every
// ayah's full text with its page location — from the locally-mirrored
// mushaf-layout dataset (see download-mushaf-layout.sh). Once this
// runs, page/ayah text, surah info, ayah->page lookups, and full-text
// search can all be powered from data you host yourself, with zero
// dependency on alquran.cloud or any other live API for TEXT. (Audio
// is a separate matter — see the conversation notes on everyayah.com's
// direct static-file URLs, which likewise drop the alquran.cloud
// dependency for audio without needing this index at all.)
//
// Usage: run once after mushaf-layout/ is fully downloaded, from the
// repo root (same folder as download-mushaf-layout.sh and index.html):
//
//   node derive-quran-index.js
//
// Safe to re-run — it always reprocesses everything and overwrites
// its own output, so there's nothing to clean up first.
//
// Produces:
//   quran-index/surahs.json — [{ number, name, numberOfAyahs, startPage }]
//   quran-index/ayahs.json  — [{ surah, ayah, surahName, text, page, endPage }]
//     ordered by surah then ayah — this same flat file doubles as the
//     full-text search index (see quran-reader.js).
//
// How ayahs are reconstructed: mushaf-layout stores WORDS grouped by
// printed LINE, not by ayah, and an ayah can span multiple LINES
// within a page — but never spans two PAGES, since the standard
// 604-page Madani Mushaf layout deliberately always breaks pages on
// an ayah boundary. This walks every page's words in order and
// accumulates them into a per-ayah buffer keyed by "surah:ayah",
// closing it when it hits the word carrying the ayah's embedded
// number (mushaf-layout appends it to the last word of every verse,
// e.g. "ٱلرَّحِيمِ ١"). The buffer isn't reset between pages, so if a
// page-spanning ayah ever DID show up it would still reconstruct
// correctly rather than losing data — but validateNoPageSpans() below
// actively checks that this in fact never happens, since it shouldn't.

const fs = require("fs");
const path = require("path");

const MUSHAF_DIR = path.join(__dirname, "mushaf-layout");
const OUT_DIR = path.join(__dirname, "quran-index");
const TOTAL_PAGES = 604;
const EXPECTED_SURAHS = 114;
const EXPECTED_AYAHS = 6236;

function splitEmbeddedAyahNumber(wordText) {
  const match = (wordText || "").match(/\s*([\u0660-\u0669]+)\s*$/);
  if (!match) return { text: wordText || "", hasNumber: false };
  return { text: wordText.slice(0, match.index).trimEnd(), hasNumber: true };
}

function main() {
  if (!fs.existsSync(MUSHAF_DIR)) {
    console.error(`Error: ${MUSHAF_DIR} not found. Run download-mushaf-layout.sh first.`);
    process.exit(1);
  }

  const surahs = [];
  const surahByNumber = new Map();
  const ayahs = [];

  // The ayah currently being assembled. Only reset by finalizeBuffer(),
  // so it survives page boundaries on its own.
  let buffer = null; // { surah, ayah, words: [], startPage, endPage }

  function startBuffer(surah, ayah, page) {
    buffer = { surah, ayah, words: [], startPage: page, endPage: page };
  }

  function finalizeBuffer() {
    if (!buffer) return;
    const surahInfo = surahByNumber.get(buffer.surah);
    ayahs.push({
      surah: buffer.surah,
      ayah: buffer.ayah,
      surahName: surahInfo ? surahInfo.name : null,
      text: buffer.words.join(" "),
      page: buffer.startPage,
      endPage: buffer.endPage,
    });
    buffer = null;
  }

  for (let p = 1; p <= TOTAL_PAGES; p++) {
    const padded = String(p).padStart(3, "0");
    const filePath = path.join(MUSHAF_DIR, `page-${padded}.json`);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing ${filePath} — re-run download-mushaf-layout.sh to fill in gaps, then try again.`);
      process.exit(1);
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
      console.error(`Malformed JSON in ${filePath}: ${e.message}`);
      process.exit(1);
    }

    for (const line of (data.lines || [])) {
      if (line.type === "surah-header") {
        const number = parseInt(line.surah, 10);
        if (number && !surahByNumber.has(number)) {
          const entry = { number, name: line.text, numberOfAyahs: 0, startPage: p };
          surahByNumber.set(number, entry);
          surahs.push(entry);
        }
      } else if (line.type === "text") {
        for (const w of (line.words || [])) {
          const loc = (w.location || "").split(":");
          const surahNum = parseInt(loc[0], 10);
          const ayahNum = parseInt(loc[1], 10);
          if (!surahNum || !ayahNum) continue;

          if (!buffer || buffer.surah !== surahNum || buffer.ayah !== ayahNum) {
            // A new ayah started without the previous one closing —
            // shouldn't normally happen, but flush defensively so
            // data is never silently dropped.
            if (buffer) finalizeBuffer();
            startBuffer(surahNum, ayahNum, p);
          }
          buffer.endPage = p;

          const { text, hasNumber } = splitEmbeddedAyahNumber(w.word);
          if (text) buffer.words.push(text);
          if (hasNumber) finalizeBuffer();
        }
      }
      // "basmala" lines contribute no words to any ayah — in Al-Fatiha
      // the opening phrase is ayah 1 itself (a real "text" line), while
      // in every other surah it's purely decorative, matching how
      // quran-reader.js already treats the two cases differently.
    }
  }

  finalizeBuffer(); // in case the very last ayah's buffer is still open

  for (const a of ayahs) {
    const s = surahByNumber.get(a.surah);
    if (s) s.numberOfAyahs = Math.max(s.numberOfAyahs, a.ayah);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "surahs.json"), JSON.stringify(surahs), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "ayahs.json"), JSON.stringify(ayahs), "utf8");

  console.log(`Wrote ${surahs.length} surahs to quran-index/surahs.json`);
  console.log(`Wrote ${ayahs.length} ayahs to quran-index/ayahs.json`);

  if (surahs.length !== EXPECTED_SURAHS) {
    console.warn(`Warning: expected ${EXPECTED_SURAHS} surahs, got ${surahs.length}. Check mushaf-layout/ for missing/corrupt pages.`);
  }
  if (ayahs.length !== EXPECTED_AYAHS) {
    console.warn(`Warning: expected ${EXPECTED_AYAHS} ayahs, got ${ayahs.length}. Check mushaf-layout/ for missing/corrupt pages.`);
  }

  // Quick spot-checks worth eyeballing in the output above: surah 1
  // should have numberOfAyahs = 7, surah 2 = 286. If those look off,
  // something upstream in mushaf-layout is inconsistent.
  const fatiha = surahByNumber.get(1);
  const baqarah = surahByNumber.get(2);
  if (fatiha) console.log(`Sanity check — Al-Fatiha ayah count: ${fatiha.numberOfAyahs} (expected 7)`);
  if (baqarah) console.log(`Sanity check — Al-Baqarah ayah count: ${baqarah.numberOfAyahs} (expected 286)`);

  // Per the standard Mushaf convention, no ayah should ever span two
  // pages (only lines within a page do) — verify that actually holds
  // across the whole reconstructed dataset rather than assuming it.
  const spanning = ayahs.filter((a) => a.page !== a.endPage);
  if (spanning.length > 0) {
    console.warn(`Warning: ${spanning.length} ayah(s) reconstructed as spanning two pages, which shouldn't happen:`);
    spanning.slice(0, 10).forEach((a) => console.warn(`  ${a.surah}:${a.ayah} — page ${a.page} to ${a.endPage}`));
    console.warn("This likely means mushaf-layout has a gap/inconsistency around those ayahs — worth spot-checking those pages directly.");
  } else {
    console.log("Confirmed: no ayah spans two pages (as expected).");
  }
}

main();
