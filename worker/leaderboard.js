/* Shared leaderboard API for the timed games (Omegamac, Fermimac). Each game module exports
 *   { id, presets: [ids], durations: [s], minGap, verify(run, answers, times) -> {ok, score, ms} | {ok: false, why} }
 * where verify replays the run from its seed (ms = how long the run really lasted, after skip penalties).
 *
 * POST /api/<game>/start  {preset, d}                    -> {token, seed}
 *   HMAC-signed token (env.OMEGAMAC_SECRET) with game, preset, duration, seed, issue time and run id: no DB write.
 * POST /api/<game>/submit {token, name, answers, times}  -> {score, best, rank, top}
 *   The run must have lasted its whole length in real time, be submitted within LIMITS.expires, replay to a valid
 *   run, and each run id is accepted once.
 * GET  /api/<game>/top?preset=…&d=…                       -> {top: [{name, score}]}  (best per name, case-insensitive)
 * D1: lb_runs (replay protection), lb_best (one row per name per board); see migrations/. */
export const LIMITS = {
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
export function newRun(game, preset, d, now = Date.now()) {
  if (!game.presets.includes(preset) || !game.durations.includes(d)) return null;
  const r = crypto.getRandomValues(new Uint32Array(3));
  return { g: game.id, p: preset, d, s: r[0], iat: now, id: r[1].toString(36) + r[2].toString(36) };
}

// the shared checks: a known board, the times strictly increasing (at least minGap apart) and inside the run, and the
// run submitted after it could have ended but not too long after. ms: the run's real length.
export function checkRun(game, run, answers, times, ms, now) {
  if (!run || run.g !== game.id || !game.presets.includes(run.p) || !game.durations.includes(run.d)) return "bad run";
  if (!Array.isArray(answers) || !Array.isArray(times) || answers.length !== times.length || answers.length > 5000) return "bad answers";
  let last = -Infinity;
  for (const t of times) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > ms + 1000 || t - last < game.minGap) return "bad timing";
    last = t;
  }
  if (now < run.iat + ms - LIMITS.slack) return "the run isn't over yet";
  if (now > run.iat + run.d * 1000 + LIMITS.expires) return "this run has expired";
  return null;
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
  if (text.length > 128e3) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function top(env, g, preset, d, n = 10) {
  const { results } = await env.DB.prepare(
    "SELECT name, score FROM lb_best WHERE game = ? AND board = ? AND dur = ? ORDER BY score DESC, created ASC LIMIT ?").bind(g, preset, d, n).all();
  return results;
}

export async function handle(game, req, env, route, url) {
  if (!env.OMEGAMAC_SECRET || !env.DB) return json({ error: "leaderboard not configured" }, 503);
  const g = game.id;

  if (route === "top" && req.method === "GET") {
    const preset = url.searchParams.get("preset"), d = +url.searchParams.get("d");
    if (!game.presets.includes(preset) || !game.durations.includes(d)) return json({ error: "no such board" }, 400);
    return json({ top: await top(env, g, preset, d) }, 200, { "cache-control": "public, max-age=10" });
  }

  if (route === "start") {
    const b = await body(req), run = b && newRun(game, b.preset, b.d);
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
    const v = game.verify(run, b.answers, b.times);
    if (!v.ok) return json({ error: v.why }, 422);
    const now = Date.now();
    try {
      await env.DB.prepare("INSERT INTO lb_runs (id, game, created) VALUES (?, ?, ?)").bind(run.id, g, now).run();
    } catch { return json({ error: "this run was already submitted" }, 409); }
    await env.DB.prepare(
      `INSERT INTO lb_best (game, board, dur, name, score, created) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (game, board, dur, name) DO UPDATE SET score = excluded.score, created = excluded.created WHERE excluded.score > lb_best.score`)
      .bind(g, run.p, run.d, name, v.score, now).run();
    const best = await env.DB.prepare("SELECT score FROM lb_best WHERE game = ? AND board = ? AND dur = ? AND name = ?").bind(g, run.p, run.d, name).first("score");
    const rank = await env.DB.prepare("SELECT COUNT(*) AS n FROM lb_best WHERE game = ? AND board = ? AND dur = ? AND score > ?").bind(g, run.p, run.d, best).first("n");
    return json({ score: v.score, best, rank: rank + 1, top: await top(env, g, run.p, run.d) });
  }

  return json({ error: "not found" }, 404);
}
