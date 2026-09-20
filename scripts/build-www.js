#!/usr/bin/env node
// Assembles www/ — the folder Capacitor packages into the native apps —
// from the repo root. The repo root stays the single source of truth
// (and still deploys to GitHub Pages as before); www/ is generated, so
// it is git-ignored and safe to delete.
//
//   npm run build:web
//
// Only files the app actually loads at runtime are copied. SQL, the Edge
// Function, one-time tooling scripts and docs are deliberately left out.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "www");

const FILES = [
  "index.html",
  "styles.css",
  "config.js",
  "supabase-client.js",
  "auth-ui.js",
  "app.js",
  "quran-reader.js",
  "native-shell.js", // added in a later step — copied only if it exists
];
const OPTIONAL_FILES = new Set(["native-shell.js"]);
const DIRS = ["vendor", "fonts", "quran-index", "mushaf-layout"];

function fail(msg) {
  console.error("\nError: " + msg + "\n");
  process.exit(1);
}

function main() {
  // ---- preflight: make sure the pieces that need a one-time setup exist ----
  const hints = {
    vendor: "Run:  npm run vendor",
    fonts: "Run:  npm run vendor",
    "quran-index": "Run:  node derive-quran-index.js  (needs mushaf-layout/ first)",
    "mushaf-layout": "Run:  ./download-mushaf-layout.sh",
  };
  for (const d of DIRS) {
    if (!fs.existsSync(path.join(ROOT, d))) fail(`${d}/ is missing. ${hints[d]}`);
  }
  const pageCount = fs.readdirSync(path.join(ROOT, "mushaf-layout")).filter((f) => /^page-\d{3}\.json$/.test(f)).length;
  if (pageCount !== 604) fail(`mushaf-layout/ has ${pageCount} of 604 page files. Re-run ./download-mushaf-layout.sh.`);
  for (const f of ["surahs.json", "ayahs.json"]) {
    if (!fs.existsSync(path.join(ROOT, "quran-index", f))) fail(`quran-index/${f} is missing. Run: node derive-quran-index.js`);
  }
  if (!fs.existsSync(path.join(ROOT, "vendor", "supabase.js"))) fail("vendor/supabase.js is missing. Run: npm run vendor");
  if (!fs.existsSync(path.join(ROOT, "fonts", "fonts.css"))) fail("fonts/fonts.css is missing. Run: npm run vendor");

  // ---- copy ----
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const f of FILES) {
    const from = path.join(ROOT, f);
    if (!fs.existsSync(from)) {
      if (OPTIONAL_FILES.has(f)) continue;
      fail(`${f} is missing from the repo root.`);
    }
    fs.copyFileSync(from, path.join(OUT, f));
  }
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });

  // ---- verify: every local <script src> / <link href> in index.html resolves inside www/ ----
  const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  const missing = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:|data:|#|mailto:)/.test(ref)) continue;
    const clean = ref.split("?")[0].split("#")[0];
    if (clean && !fs.existsSync(path.join(OUT, clean))) missing.push(ref);
  }
  if (missing.length) fail("index.html references files that did not make it into www/:\n  " + missing.join("\n  "));

  // Anything still pointing at a CDN would break offline / native use.
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  if (external.length) console.warn("Note: index.html still loads external URLs:\n  " + external.join("\n  "));

  let bytes = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      e.isDirectory() ? walk(p) : (bytes += fs.statSync(p).size);
    }
  })(OUT);
  console.log(`www/ ready — ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

main();
