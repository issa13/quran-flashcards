# 📖 بطاقات مراجعة القرآن — How This App Works

This is a plain-language map of the whole project — what each file does, where the Quran data actually comes from, what needs the internet and what doesn't, and how to run it on your own laptop without confusion.

---

## 1. The big picture

This is a **static web app** — no build step, no backend server of your own. It's just HTML/CSS/JS files that a browser loads directly. Two outside things it talks to:

- **Supabase** — a hosted database/auth service, used ONLY for accounts, syncing XP/streaks/achievements, friends, leaderboards, and online duels.
- **everyayah.com** — a plain file server that hosts Quran recitation audio (mp3 files).

Everything else — the Quran text itself, page layout, search, question generation — now lives **in your own repo**, as plain files. That's the part that changed recently and is probably why things feel confusing, so the rest of this doc focuses there.

---

## 2. File map

| File | What it does |
|---|---|
| `index.html` | The whole app's structure — every screen/tab/modal lives in this one file, shown/hidden with CSS. |
| `styles.css` | All visual styling. |
| `config.js` | Your Supabase project URL + public key. If left as placeholders, the app runs in **guest mode** (see §5). |
| `supabase-client.js` | Thin wrapper around the Supabase SDK — login, signup, and every database call. |
| `auth-ui.js` | Wires up login/signup UI, profile, friends, leaderboard, and switching between tabs. |
| `app.js` | The core: solo quiz ("اختبارات"), offline local challenges ("تحديات" 📴), XP/leveling, and the online-duel *client* (the UI side, not the server side). |
| `quran-reader.js` | The whole "📖 القرآن" reading tab — page rendering, search, bookmarks, reciter choice, listen-to-a-range. |
| `index.ts` | A **Supabase Edge Function** — server-side code that generates the questions for online duels. Runs on Supabase's servers, not in the browser. |
| `supabase-schema.sql` | The database structure (tables, security rules, functions) — you run this once in Supabase's SQL editor. |
| `mushaf-layout/` | 604 JSON files — one per Mushaf page (see §3). |
| `quran-index/` | 2 JSON files, derived from the above (see §3). |
| `download-mushaf-layout.sh` | One-time script that downloads `mushaf-layout/`. |
| `derive-quran-index.js` | One-time script that builds `quran-index/` from `mushaf-layout/`. |

---

## 3. The Quran data pipeline (the confusing part)

There are **two different local datasets**, because they answer two different questions, and it's worth being clear on why both exist instead of just one.

```
mushaf-layout/page-XXX.json  (604 files, one per printed page)
        │
        │  organized by PRINTED LINE — "what word sits on
        │  which of the 15 lines of page 42?"
        │  → used ONLY by the reading tab, so it can show a
        │    real Mushaf page, line for line.
        │
        ▼
  node derive-quran-index.js   (run once, by you)
        │
        ▼
quran-index/surahs.json   — the 114-surah catalog (name, ayah count, start page)
quran-index/ayahs.json    — all 6,236 ayahs, WHOLE ayah text each, with its page

        organized by AYAH — "what's the full text of 2:255,
        and what page is it on?"
        → used by the quiz, offline challenges, search, and
          surah/juz navigation.
```

**Why not just use one?** Because "what's on this printed line" and "what's the full text of this ayah" are genuinely different shapes of the same information — an ayah often spans several lines, so you can't get whole-ayah text directly out of the line-based file without reassembling it. `derive-quran-index.js` does that reassembling **once**, so nothing else in the app has to do it over and over.

**Neither of these needs any internet API.** They're just files sitting in your repo, same as `styles.css`. `alquran.cloud` (the API this app used to depend on for text) isn't used anywhere client-side anymore.

### Setup order matters
1. `./download-mushaf-layout.sh` → creates `mushaf-layout/`
2. `node derive-quran-index.js` → reads `mushaf-layout/`, creates `quran-index/`
3. Commit both folders to your repo.

If you skip step 2, or run it before step 1 finishes, the quiz and search will show a "couldn't load" message rather than break silently — that message will explicitly mention `quran-index` or `mushaf-layout` so it's obvious what's missing.

---

## 4. Audio

Recitation audio is **not** text, so it can't come from the JSON files above — it's real mp3 files, hosted by **everyayah.com** (a long-established, dedicated Quran audio host). The app builds the file URL directly:

```
https://everyayah.com/data/{ReciterFolder}/{surah:03d}{ayah:03d}.mp3
```

No API call, no lookup — just a predictable URL per reciter. This **does** need internet, every time (the files are too large to keep a personal copy of all reciters).

---

## 5. What needs the internet, and what doesn't

| Feature | Needs internet? |
|---|---|
| 📖 Reading the Quran, searching, bookmarks, goto page/surah/juz | **No** — all local files |
| 🎧 Listening to recitation (single ayah or a range) | **Yes** — streams from everyayah.com |
| 📝 اختبارات (solo quiz) — as a **guest** | **No** — text is local, scoring is saved in your browser only |
| 📝 اختبارات — **signed in** | **Yes** — XP/streaks/achievements are saved to your account via Supabase |
| 📴 تحديات محلي (offline local challenge) | **No** — same local text, never touches Supabase at all |
| ⚔️ Online duels | **Yes**, always — matchmaking, live scoring, and question generation all happen on Supabase's servers |
| Friends / leaderboard / profile sync | **Yes** — all Supabase |

**Guest mode** (no account) is what makes the "no internet" rows possible — it stores everything (progress, last-read page, bookmarks, reciter choice) in your browser's `localStorage` instead of a server.

---

## 6. Running it on your own laptop

This is the part that trips people up. **How** you open the app matters:

- ❌ **Double-clicking `index.html`** opens it as `file:///Users/you/.../index.html`. Browsers block pages loaded this way from reading *other* local files (like `quran-index/surahs.json`) as a security measure — even though the file is right there on your disk. This will make the quiz and Quran tab fail to load data, for reasons that have nothing to do with your internet connection.
- ✅ **Serving it over local HTTP** avoids that entirely. From the project folder, run:
  ```
  python3 -m http.server
  ```
  then open `http://localhost:8000` in your browser. No installation needed if you already have Python (macOS/Linux have it by default; Windows may need `python` instead of `python3`, or use `npx serve` if you have Node instead).

Once served this way, the address bar shows `http://localhost:...` — not `file://` — and local fetches work normally, with or without an actual internet connection.

### The other thing that was silently breaking things
Until recently, the Supabase login library was loaded from an internet CDN with **no fallback** — if that failed to load (no internet, ad-blocker, CDN hiccup), the whole app could break instead of just quietly switching to guest mode. That's now fixed: if the library fails to load, the app falls back to guest mode automatically, the same way it does if `config.js` is left unfilled.

---

## 7. Quick troubleshooting

| Symptom | Likely cause |
|---|---|
| Quran tab / quiz says "تعذّر تحميل..." mentioning `quran-index` or `mushaf-layout` | Those folders aren't in the right place, or the derive script wasn't run — see §3. |
| Nothing loads at all, console errors mention `supabase` | You're on an old copy of `supabase-client.js` without the fallback fix — see §6. |
| Quran tab works but login doesn't | Expected offline — login always needs Supabase (§5). |
| Everything works online, breaks with wifi off | Check whether you're running via `file://` (§6) before assuming it's a code bug. |

---

## 8. What's still on the roadmap (discussed, not yet built)

- **True offline (PWA)**: a service worker to cache the app shell itself, so it loads with zero connection at all (right now, "no internet needed" applies to the *data*, but the browser still needs to fetch the HTML/CSS/JS files themselves the first time).
- **Self-hosting the Supabase SDK file** (instead of the CDN) — reduces one more external dependency, though login itself will always need real internet regardless.
- **Local queue for signed-in quiz attempts** made offline, synced once back online (currently, signed-in scoring simply requires a connection at the moment you answer).
