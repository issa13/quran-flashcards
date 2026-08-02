# Setting up accounts, sync & multi-user

The app still works with zero setup — as a guest, with progress saved
only on that device. To turn on accounts, cross-device sync, personal
stats, and the leaderboard, connect a free Supabase project (about
10 minutes, no server to run or pay for).

## 1. Create a Supabase project
1. Go to https://supabase.com → Sign up (free) → **New project**.
2. Pick a name/region/password (save the DB password somewhere safe).
3. Wait ~2 minutes for it to finish provisioning.

## 2. Run the schema
1. In your project, open **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase-schema.sql` (in this repo).
3. Click **Run**. This creates the `profiles`, `user_settings`,
   `attempts` tables, the `leaderboard` view, and row-level-security
   policies so each user can only read/write their own data.

## 3. Get your API keys
1. Go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `config.js` in this repo and paste them in:
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
   The anon key is safe to expose in client-side code — it only grants
   what your RLS policies above allow (each user their own rows, plus
   public read of `profiles` and `leaderboard`).

## 4. Allow your site to sign users in
1. Go to **Authentication → URL Configuration**.
2. Add your deployed URL (e.g. `https://issa13.github.io/quran-flashcards`)
   to **Site URL** and **Redirect URLs**.
3. **Authentication → Providers**: Email should be enabled by default.
   You can turn off "Confirm email" under **Authentication → Settings**
   if you want signup to work instantly without an email step, or leave
   it on for extra security.

## 5. Deploy
Commit and push `config.js` with your real values, then deploy as
before (e.g. GitHub Pages). That's it — accounts, settings sync, per
user stats, and the opt-in leaderboard are live.

## What's now stored per user
- `user_settings` — last used question type, timer, and page range,
  synced across every device they log into.
- `attempts` — every answered flashcard (question type, page, correct
  or not, timestamp) — powers the stats screen.
- `profiles` — display name and a `show_on_leaderboard` opt-in flag.

## Notes
- Guests (not signed in) still work exactly as before, with score kept
  in `localStorage` on that device.
- Nothing here costs money on Supabase's free tier at this scale.
- If you ever want to reset a user's data, you can delete their row
  from **Authentication → Users** in the Supabase dashboard — the
  `on delete cascade` foreign keys will clean up their profile,
  settings, and attempts automatically.
