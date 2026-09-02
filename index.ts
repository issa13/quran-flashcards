// generate-duel-questions
//
// Called by the duel HOST's browser right after their opponent accepts
// (duels.status = 'accepted'). Generates the shared, fixed question set
// for a 1v1 online duel and writes it straight into the database using
// the service-role key — the ONE deliberate exception to this app's
// "every cross-user write goes through a security-definer Postgres RPC"
// rule (see supabase-schema.sql section 16+). It has to happen here,
// server-side, specifically so that NEITHER player's own browser ever
// sees the correct answers before the official reveal: whichever
// browser built the questions would otherwise know them in advance.
//
// This intentionally mirrors app.js's solo-mode question generation
// (pickQAFromPage / pickAdjacentPageQA / buildChoices and friends) as
// closely as possible, using the same public Quran API and the same
// distractor strategies, just ported to Deno/TypeScript.
//
// Deploy with: supabase functions deploy generate-duel-questions
// (see SETUP.md). Needs no manual secrets — SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE = "https://api.alquran.cloud/v1/";
const EDITION = "quran-uthmani";
const MCQ_CHOICE_COUNT = 6;

const JUZ_START_PAGE = [
  1, 22, 42, 62, 82, 102, 121, 142, 162, 182,
  201, 222, 242, 262, 282, 302, 322, 342, 362, 382,
  402, 422, 442, 462, 482, 502, 522, 542, 562, 582,
];

const ADJACENT_TYPES = new Set([
  "nextPageFirst", "prevPageFirst", "pageEndToNextFirst", "pageStartToPrevLast",
]);

interface Ayah {
  number: number;
  numberInSurah: number;
  text: string;
  juz: number;
  surah: { number: number; name: string };
}

interface QA {
  q: string;
  a: string;
  kind: "text" | "surah" | "pageNumber" | "ayahCount" | "juz" | "ayahNumber";
  qAyahNumber: number | null;
  audioOnly?: boolean;
}

interface GeneratedQuestion {
  question_type: string;
  page: number | null;
  q_text: string;
  q_ayah_number: number | null;
  is_audio_only: boolean;
  choices: string[];
  correct_index: number;
}

function clean(s: string | null | undefined): string {
  return (s || "").toString().trim();
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function juzForPage(page: number): number {
  let juz = 1;
  for (let i = 0; i < JUZ_START_PAGE.length; i++) {
    if (page >= JUZ_START_PAGE[i]) juz = i + 1;
    else break;
  }
  return juz;
}

function juzsInRange(minP: number, maxP: number): number[] {
  const start = juzForPage(minP);
  const end = juzForPage(maxP);
  const list: number[] = [];
  for (let j = start; j <= end; j++) list.push(j);
  return list;
}

// -------- API with per-invocation cache --------
const pageCache = new Map<number, Ayah[]>();
let surahCatalogPromise: Promise<Array<{ number: number; name: string }>> | null = null;

async function fetchPageAyahs(page: number): Promise<Ayah[]> {
  if (pageCache.has(page)) return pageCache.get(page)!;
  const res = await fetch(`${API_BASE}page/${page}/${EDITION}`);
  if (!res.ok) throw new Error("HTTP error fetching page " + page);
  const json = await res.json();
  const ayahs: Ayah[] = json?.data?.ayahs || [];
  pageCache.set(page, ayahs);
  return ayahs;
}

function fetchSurahCatalog(): Promise<Array<{ number: number; name: string }>> {
  if (surahCatalogPromise) return surahCatalogPromise;
  surahCatalogPromise = fetch(`${API_BASE}surah`)
    .then((res) => {
      if (!res.ok) throw new Error("HTTP error fetching surah catalog");
      return res.json();
    })
    .then((json) => json?.data || [])
    .catch((e) => {
      surahCatalogPromise = null;
      throw e;
    });
  return surahCatalogPromise;
}

async function surahsInRange(minP: number, maxP: number): Promise<string[]> {
  try {
    const [minAyahs, maxAyahs, catalog] = await Promise.all([
      fetchPageAyahs(minP),
      fetchPageAyahs(maxP),
      fetchSurahCatalog(),
    ]);
    const lowSurah = minAyahs?.[0]?.surah?.number;
    const highSurah = maxAyahs?.[maxAyahs.length - 1]?.surah?.number;
    if (lowSurah == null || highSurah == null || !catalog.length) return [];

    const list: string[] = [];
    for (let n = lowSurah; n <= highSurah; n++) {
      const entry = catalog.find((s) => s.number === n);
      if (entry) list.push(clean(entry.name));
    }
    return list;
  } catch (_e) {
    return [];
  }
}

function getSurahName(ayah: Ayah): string {
  return clean(ayah?.surah?.name) || "غير معروف";
}

// -------- question builders (mirrors app.js's pickQAFromPage) --------
function pickQAFromPage(ayahs: Ayah[], type: string, page: number): QA | null {
  if (!ayahs || ayahs.length < 2) return null;

  const first = ayahs[0];
  const last = ayahs[ayahs.length - 1];

  if (type === "first") {
    const candidate = ayahs[randInt(1, ayahs.length - 1)];
    return { q: clean(candidate.text), a: clean(first.text), kind: "text", qAyahNumber: candidate.number };
  }
  if (type === "last") {
    const candidate = ayahs[randInt(0, ayahs.length - 2)];
    return { q: clean(candidate.text), a: clean(last.text), kind: "text", qAyahNumber: candidate.number };
  }
  if (type === "previous") {
    const idx = randInt(1, ayahs.length - 1);
    return { q: clean(ayahs[idx].text), a: clean(ayahs[idx - 1].text), kind: "text", qAyahNumber: ayahs[idx].number };
  }
  if (type === "surah") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: getSurahName(candidate), kind: "surah", qAyahNumber: candidate.number };
  }
  if (type === "pageNumber") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    return { q: clean(candidate.text), a: String(page), kind: "pageNumber", qAyahNumber: candidate.number };
  }
  if (type === "ayahCount") {
    return { q: clean(first.text), a: String(ayahs.length), kind: "ayahCount", qAyahNumber: first.number };
  }
  if (type === "juz") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    const juz = candidate.juz;
    if (juz == null) return null;
    return { q: clean(candidate.text), a: String(juz), kind: "juz", qAyahNumber: candidate.number };
  }
  if (type === "ayahNumber") {
    const candidate = ayahs[randInt(0, ayahs.length - 1)];
    const num = candidate.numberInSurah;
    if (num == null) return null;
    return { q: clean(candidate.text), a: String(num), kind: "ayahNumber", qAyahNumber: candidate.number };
  }
  if (type === "listenNext") {
    const idx = randInt(0, ayahs.length - 2);
    const qAyah = ayahs[idx];
    const aAyah = ayahs[idx + 1];
    return { q: "", a: clean(aAyah.text), kind: "text", qAyahNumber: qAyah.number, audioOnly: true };
  }

  return null;
}

async function pickAdjacentPageQA(type: string, page: number): Promise<QA | null> {
  const currentAyahs = await fetchPageAyahs(page);
  if (!currentAyahs || currentAyahs.length < 1) return null;

  if (type === "nextPageFirst") {
    const qAyah = currentAyahs[0];
    const nextAyahs = await fetchPageAyahs(page + 1);
    if (!nextAyahs || nextAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(nextAyahs[0].text), kind: "text", qAyahNumber: qAyah.number };
  }
  if (type === "prevPageFirst") {
    const qAyah = currentAyahs[0];
    const prevAyahs = await fetchPageAyahs(page - 1);
    if (!prevAyahs || prevAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(prevAyahs[0].text), kind: "text", qAyahNumber: qAyah.number };
  }
  if (type === "pageEndToNextFirst") {
    const qAyah = currentAyahs[currentAyahs.length - 1];
    const nextAyahs = await fetchPageAyahs(page + 1);
    if (!nextAyahs || nextAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(nextAyahs[0].text), kind: "text", qAyahNumber: qAyah.number };
  }
  if (type === "pageStartToPrevLast") {
    const qAyah = currentAyahs[0];
    const prevAyahs = await fetchPageAyahs(page - 1);
    if (!prevAyahs || prevAyahs.length < 1) return null;
    return { q: clean(qAyah.text), a: clean(prevAyahs[prevAyahs.length - 1].text), kind: "text", qAyahNumber: qAyah.number };
  }
  return null;
}

// -------- distractors (mirrors app.js's buildChoices) --------
async function collectTextCandidates(exclude: Set<string>, low: number, high: number, count: number): Promise<string[]> {
  const results: string[] = [];
  const seen = new Set(exclude);
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
    } catch (_e) { /* skip failed page fetch */ }
  }
  return results;
}

async function pickTextDistractors(exclude: Set<string>, minP: number, maxP: number, count: number): Promise<string[]> {
  let results = await collectTextCandidates(exclude, minP, maxP, count);
  if (results.length < count) {
    const more = await collectTextCandidates(new Set([...exclude, ...results]), 1, 604, count - results.length);
    results = results.concat(more);
  }
  return results;
}

function pickNearbyNumberDistractors(correctNum: number, count: number, spread: number): string[] {
  const pool = new Set<number>();
  let widen = spread;
  let guard = 0;
  while (pool.size < count && widen < 200) {
    guard++;
    const offset = randInt(-widen, widen);
    const n = correctNum + offset;
    if (n >= 1 && n !== correctNum) pool.add(n);
    if (guard % (count * 10) === 0) widen += spread;
  }
  return Array.from(pool).slice(0, count).map(String);
}

async function buildChoices(qa: QA, minP: number, maxP: number): Promise<{ choices: string[]; correctIndex: number } | null> {
  const correct = qa.a;
  const want = MCQ_CHOICE_COUNT - 1;
  let distractors: string[] = [];

  if (qa.kind === "surah") {
    const available = await surahsInRange(minP, maxP);
    const pool = shuffle(available.filter((n) => n !== correct));
    const surahWant = Math.min(MCQ_CHOICE_COUNT, available.length) - 1;
    distractors = pool.slice(0, Math.max(0, surahWant));
  } else if (qa.kind === "pageNumber") {
    const correctNum = parseInt(correct, 10);
    const pool: number[] = [];
    for (let p = minP; p <= maxP; p++) if (p !== correctNum) pool.push(p);
    const pageWant = Math.min(MCQ_CHOICE_COUNT, maxP - minP + 1) - 1;
    distractors = shuffle(pool).slice(0, Math.max(0, pageWant)).map(String);
  } else if (qa.kind === "juz") {
    const available = juzsInRange(minP, maxP);
    const correctNum = parseInt(correct, 10);
    const pool = shuffle(available.filter((j) => j !== correctNum));
    const juzWant = Math.min(MCQ_CHOICE_COUNT, available.length) - 1;
    distractors = pool.slice(0, Math.max(0, juzWant)).map(String);
  } else if (qa.kind === "ayahCount") {
    distractors = pickNearbyNumberDistractors(parseInt(correct, 10), want, 4);
  } else if (qa.kind === "ayahNumber") {
    distractors = pickNearbyNumberDistractors(parseInt(correct, 10), want, 8);
  } else {
    distractors = await pickTextDistractors(new Set([qa.q, correct]), minP, maxP, want);
  }

  const choices = shuffle([correct, ...distractors]);
  const correctIndex = choices.indexOf(correct);
  return { choices, correctIndex };
}

// -------- one question, with retries (mirrors app.js's generateCard) --------
async function generateOneQuestion(type: string, minP: number, maxP: number): Promise<GeneratedQuestion | null> {
  let attempts = 0;
  while (attempts < 6) {
    attempts++;
    let page: number;
    if (type === "nextPageFirst" || type === "pageEndToNextFirst") {
      page = randInt(minP, maxP - 1);
    } else if (type === "prevPageFirst" || type === "pageStartToPrevLast") {
      page = randInt(minP + 1, maxP);
    } else {
      page = randInt(minP, maxP);
    }

    let qa: QA | null = null;
    try {
      if (ADJACENT_TYPES.has(type)) {
        qa = await pickAdjacentPageQA(type, page);
      } else {
        const ayahs = await fetchPageAyahs(page);
        qa = pickQAFromPage(ayahs, type, page);
      }
    } catch (_e) {
      qa = null;
    }
    if (qa && !qa.q && !qa.audioOnly) qa = null;
    if (qa && !qa.a) qa = null;
    if (!qa) continue;

    const built = await buildChoices(qa, minP, maxP);
    if (!built || built.choices.length < 2 || built.correctIndex < 0) continue;

    return {
      question_type: type,
      page,
      q_text: qa.audioOnly ? "" : qa.q,
      q_ayah_number: qa.qAyahNumber,
      is_audio_only: !!qa.audioOnly,
      choices: built.choices,
      correct_index: built.correctIndex,
    };
  }
  return null;
}

// -------- HTTP handler --------
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { duelId } = await req.json();
    if (!duelId) {
      return new Response(JSON.stringify({ ok: false, error: "missing_duel_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identity client — resolves who's actually calling, from their
    // own JWT, so we never trust a client-supplied user id.
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "not_authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin client — bypasses RLS, used only for the privileged reads/
    // writes this function specifically exists to do.
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: duel, error: duelErr } = await admin
      .from("duels")
      .select("id, created_by, status, range_min, range_max, question_types, count_per_type, started_at")
      .eq("id", duelId)
      .maybeSingle();

    if (duelErr || !duel) {
      return new Response(JSON.stringify({ ok: false, error: "duel_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (duel.created_by !== user.id) {
      return new Response(JSON.stringify({ ok: false, error: "not_the_host" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (duel.status !== "accepted") {
      return new Response(JSON.stringify({ ok: false, error: "duel_not_ready", status: duel.status }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const types: string[] = duel.question_types || [];
    const countPerType: number = duel.count_per_type || 5;
    const queue = shuffle(
      types.flatMap((t) => Array(countPerType).fill(t)) as string[]
    );

    const generated: GeneratedQuestion[] = [];
    for (const type of queue) {
      const q = await generateOneQuestion(type, duel.range_min, duel.range_max);
      if (q) generated.push(q);
    }

    if (generated.length < 2) {
      return new Response(JSON.stringify({ ok: false, error: "could_not_generate_questions" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = generated.map((q, index) => ({
      duel_id: duelId,
      question_index: index,
      question_type: q.question_type,
      page: q.page,
      q_text: q.q_text,
      q_ayah_number: q.q_ayah_number,
      is_audio_only: q.is_audio_only,
      choices: q.choices,
      correct_index: q.correct_index,
    }));

    const { error: insertErr } = await admin.from("duel_questions").insert(rows);
    if (insertErr) {
      return new Response(JSON.stringify({ ok: false, error: "insert_failed", detail: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await admin
      .from("duels")
      .update({
        status: "active",
        total_questions: rows.length,
        current_question_index: 0,
        current_question_revealed_at: new Date().toISOString(),
        started_at: duel.started_at || new Date().toISOString(),
      })
      .eq("id", duelId)
      .eq("status", "accepted"); // guard against a double-call race

    if (updateErr) {
      return new Response(JSON.stringify({ ok: false, error: "activate_failed", detail: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, totalQuestions: rows.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "unexpected", detail: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
