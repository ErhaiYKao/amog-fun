/* Omegamac leaderboard API. Only the built-in presets at the standard durations are ranked.
 *
 * POST /api/omegamac/start  {preset, d}            -> {token, seed}
 *   The token is HMAC-signed (env.OMEGAMAC_SECRET) and carries the preset, duration, seed, issue time and a run id,
 *   so starting a run costs no database write.
 * POST /api/omegamac/submit {token, name, answers, times} -> {score, rank, best}
 *   The server replays the run: problems come from gen.js seeded with the token's seed, exactly as in the page, and
 *   every answer has to be right in order. times are ms since the run started. The run must have lasted the whole
 *   duration in real time, and each run id is accepted once.
 * GET  /api/omegamac/top?preset=basic&d=120          -> {top: [{name, score}]}  (best score per name)
 *
 * D1 (migrations/0001_omegamac.sql): omegamac_runs(id) for replay protection, omegamac_best(preset, dur, name, score,
 * created) with one row per name (case-insensitive) per board. */
import "../public/omegamac/gen.js";

const O = globalThis.Omegamac;
export const PRESET_IDS = O.PRESETS.map(p => p.id);
export const LIMITS = {
  perSecond: 4,        // more correct answers per second than this, on average, isn't a person
  minGap: 100,         // ms between two answers
  slack: 3000,         // ms the client clock may run ahead of ours (network, timer granularity)
  expires: 10 * 60e3,  // a run must be submitted within this long after it ends
  name: 20,
};

// ---------- tokens ----------
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const hmacKey = secret => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function makeToken(secret, run) {
  const body = b64u(enc.encode(JSON.stringify(run)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}
export async function readToken(secret, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), enc.encode(body))) return null;
    return JSON.parse(new TextDecoder().decode(unb64u(body)));
  } catch { return null; }
}
export function newRun(preset, d, now = Date.now()) {
  if (!PRESET_IDS.includes(preset) || !O.DURATIONS.includes(d)) return null;
  const r = crypto.getRandomValues(new Uint32Array(3));
  return { p: preset, d, s: r[0], iat: now, id: r[1].toString(36) + r[2].toString(36) };
}

// ---------- the replay ----------
// -> {ok: true, score} or {ok: false, why}
export function verifyRun(run, answers, times, now = Date.now()) {
  if (!run || !PRESET_IDS.includes(run.p) || !O.DURATIONS.includes(run.d)) return { ok: false, why: "bad run" };
  const ms = run.d * 1000;
  if (now < run.iat + ms - LIMITS.slack) return { ok: false, why: "the run isn't over yet" };
  if (now > run.iat + ms + LIMITS.expires) return { ok: false, why: "this run has expired" };
  if (!Array.isArray(answers) || !Array.isArray(times) || answers.length !== times.length) return { ok: false, why: "bad answers" };
  if (answers.length > run.d * LIMITS.perSecond) return { ok: false, why: "too fast" };
  let last = -Infinity;
  for (const t of times) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > ms + 1000 || t - last < LIMITS.minGap) return { ok: false, why: "bad timing" };
    last = t;
  }
  const S = O.presetSettings(run.p), rng = O.mulberry32(run.s);
  let prob = O.next(S, rng);
  for (const a of answers) {
    if (!prob || typeof a !== "string" || a.length > 24 || !O.check(prob, a)) return { ok: false, why: "wrong answer in the replay" };
    prob = O.next(S, rng, prob);
  }
  return { ok: true, score: answers.length };
}

export function cleanName(s) {
  const n = String(s ?? "").normalize("NFKC").replace(/[\p{C}]/gu, "").replace(/\s+/g, " ").trim();
  return [...n].slice(0, LIMITS.name).join("");
}

// ---------- HTTP ----------
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

async function body(req) {
  if (req.method !== "POST") return null;
  const text = await req.text();
  if (text.length > 64e3) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function top(env, preset, d, n = 10) {
  const { results } = await env.DB.prepare(
    "SELECT name, score FROM omegamac_best WHERE preset = ? AND dur = ? ORDER BY score DESC, created ASC LIMIT ?").bind(preset, d, n).all();
  return results;
}

export async function handle(req, env, url) {
  const route = url.pathname.replace(/^\/api\/omegamac\/?/, "");
  if (!env.OMEGAMAC_SECRET || !env.DB) return json({ error: "leaderboard not configured" }, 503);

  if (route === "top" && req.method === "GET") {
    const preset = url.searchParams.get("preset"), d = +url.searchParams.get("d");
    if (!PRESET_IDS.includes(preset) || !O.DURATIONS.includes(d)) return json({ error: "no such board" }, 400);
    return json({ top: await top(env, preset, d) }, 200, { "cache-control": "public, max-age=10" });
  }

  if (route === "start") {
    const b = await body(req), run = b && newRun(b.preset, b.d);
    if (!run) return json({ error: "only the built-in presets are ranked" }, 400);
    return json({ token: await makeToken(env.OMEGAMAC_SECRET, run), seed: run.s });
  }

  if (route === "submit") {
    const b = await body(req);
    if (!b) return json({ error: "bad request" }, 400);
    const name = cleanName(b.name);
    if (!name) return json({ error: "pick a name" }, 400);
    const run = await readToken(env.OMEGAMAC_SECRET, b.token);
    if (!run) return json({ error: "bad token" }, 400);
    const v = verifyRun(run, b.answers, b.times);
    if (!v.ok) return json({ error: v.why }, 422);
    const now = Date.now();
    try {
      await env.DB.prepare("INSERT INTO omegamac_runs (id, created) VALUES (?, ?)").bind(run.id, now).run();
    } catch { return json({ error: "this run was already submitted" }, 409); }
    await env.DB.prepare(
      `INSERT INTO omegamac_best (preset, dur, name, score, created) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (preset, dur, name) DO UPDATE SET score = excluded.score, created = excluded.created WHERE excluded.score > omegamac_best.score`)
      .bind(run.p, run.d, name, v.score, now).run();
    const best = await env.DB.prepare("SELECT score FROM omegamac_best WHERE preset = ? AND dur = ? AND name = ?").bind(run.p, run.d, name).first("score");
    const rank = await env.DB.prepare("SELECT COUNT(*) AS n FROM omegamac_best WHERE preset = ? AND dur = ? AND score > ?").bind(run.p, run.d, best).first("n");
    return json({ score: v.score, best, rank: rank + 1, top: await top(env, run.p, run.d) });
  }

  return json({ error: "not found" }, 404);
}
