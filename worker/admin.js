/* Leaderboard moderation, for whoever holds ADMIN_SECRET (wrangler secret put ADMIN_SECRET). Every call sends
 * the header  Authorization: Bearer <ADMIN_SECRET>.  Without the secret set, these routes don't exist.
 * GET  /api/admin/names         -> {names: [{name, best, boards, last, ok, why}]}  newest 200 leaderboard names
 *                                  (ok/why: the lb_names verdict, null if it was never checked)
 * POST /api/admin/block {name}  -> {removed}  deletes the name's scores on every board and refuses it from now on
 * POST /api/admin/allow {name}  -> {}         allows it, even past the wordlist and the model (for false positives) */
import { cleanName } from "./leaderboard.js";

const enc = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// compare digests, so the check takes the same time whatever the guess
export async function authorized(req, secret) {
  if (!secret) return false;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [a, b] = await Promise.all([got, secret].map(s => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const setVerdict = (env, name, ok) => env.DB.prepare(
  `INSERT INTO lb_names (name, ok, why, checked) VALUES (?, ?, 'admin', ?)
   ON CONFLICT (name) DO UPDATE SET ok = excluded.ok, why = excluded.why, checked = excluded.checked`).bind(name, ok, Date.now()).run();

export async function handleAdmin(req, env, route) {
  if (!env.ADMIN_SECRET) return new Response("not found", { status: 404 });
  if (!await authorized(req, env.ADMIN_SECRET)) return json({ error: "unauthorized" }, 401);

  if (route === "names" && req.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT b.name AS name, MAX(b.score) AS best, COUNT(*) AS boards, MAX(b.created) AS last, n.ok AS ok, n.why AS why
       FROM lb_best b LEFT JOIN lb_names n ON n.name = b.name GROUP BY b.name COLLATE NOCASE ORDER BY last DESC LIMIT 200`).all();
    return json({ names: results });
  }

  if ((route === "block" || route === "allow") && req.method === "POST") {
    const b = await req.json().catch(() => null), name = cleanName(b && b.name);
    if (!name) return json({ error: "which name?" }, 400);
    await setVerdict(env, name, route === "allow" ? 1 : 0);
    if (route === "allow") return json({});
    const r = await env.DB.prepare("DELETE FROM lb_best WHERE name = ?").bind(name).run();
    return json({ removed: r.meta.changes });
  }

  return json({ error: "not found" }, 404);
}
