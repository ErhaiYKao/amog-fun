/* Online rooms for the Coefficient Choosing Game (public/coefficient-game/). One Durable Object per room, holding
 * the game and the two players' WebSockets (hibernation API, so an idle room costs nothing). The DO referees with the
 * page's own ring.js: it parses every value, checks the move and decides the winner.
 *   POST /api/coefficient-game/new {ring, d, first, side}  -> {room, seat}   (side = the host's side, A or S)
 *   GET  /api/coefficient-game/ws?room=&seat=              -> WebSocket. The host's seat comes from /new; the first
 *        other seat to connect becomes the guest; anyone else watches.
 *   client -> {t: "move", k, v} | {t: "again"}   (again: after a game, swap sides and reset)
 *   server -> {t: "state", you: "host" | "guest" | "watch", s} | {t: "error", msg}
 * Rooms are deleted after a week without a move. */
import { DurableObject } from "cloudflare:workers";
import "../public/coefficient-game/ring.js";

const G = globalThis.CoeffGame;
const ROOM = /^[a-z0-9]{8}$/, SEAT = /^[A-Za-z0-9_-]{16,40}$/;
const TTL = 7 * 24 * 3600 * 1000, MAX_ONLINE_SIZE = 20000; // keep the referee's root test well inside the CPU limit
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

export async function handleCoeff(req, env, route, url) {
  if (route === "new" && req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    let spec;
    try {
      const r = G.parseRing(b && b.ring);
      if (r.finite && r.size > MAX_ONLINE_SIZE) return json({ error: `online rings go up to ${MAX_ONLINE_SIZE} elements` }, 400);
      G.newGame(b.d, "A");
      spec = r.spec;
    } catch (e) { return json({ error: e.message }, 400); }
    const room = rid(8), seat = rid(24);
    await env.ROOMS.get(env.ROOMS.idFromName(room)).init({ spec, d: b.d, first: b.first === "S" ? "S" : "A", host: b.side === "S" ? "S" : "A", seat });
    return json({ room, seat });
  }
  if (route === "ws") {
    const room = url.searchParams.get("room") || "";
    if (!ROOM.test(room)) return json({ error: "no such room" }, 404);
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "expected a websocket" }, 426);
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
  }
  return json({ error: "not found" }, 404);
}

const fresh = s => Object.assign(s, { c: new Array(s.d + 1).fill(null), turn: s.first, log: [], winner: null, root: null });

export class CoeffRoom extends DurableObject {
  async init(o) {
    this.s = fresh({ ...o, guest: null, round: 1, at: Date.now() });
    await this.save();
  }
  async load() { if (this.s === undefined) this.s = (await this.ctx.storage.get("s")) || null; return this.s; }
  async save() { this.s.at = Date.now(); await this.ctx.storage.put("s", this.s); await this.ctx.storage.setAlarm(this.s.at + TTL); }
  ring() { if (!this.r) this.r = G.parseRing(this.s.spec); return this.r; }

  async fetch(req) {
    const s = await this.load();
    const [client, server] = Object.values(new WebSocketPair());
    if (!s) { server.accept(); server.close(4404, "no such room"); return new Response(null, { status: 101, webSocket: client }); }
    const t = new URL(req.url).searchParams.get("seat") || "";
    let role = "watch";
    if (SEAT.test(t)) {
      if (t === s.seat) role = "host";
      else if (t === s.guest) role = "guest";
      else if (!s.guest) { s.guest = t; role = "guest"; await this.save(); }
    }
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role });
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    const s = await this.load();
    if (!s || typeof msg !== "string" || msg.length > 400) return;
    let m;
    try { m = JSON.parse(msg); } catch { return; }
    const { role } = ws.deserializeAttachment() || {};
    const side = role === "host" ? s.host : role === "guest" ? G.other(s.host) : null;
    const no = msg => ws.send(JSON.stringify({ t: "error", msg }));
    if (!side) return no("you're watching this game");
    if (m.t === "again") {
      if (!s.winner) return no("the game isn't over yet");
      s.host = G.other(s.host); s.round++; fresh(s);
      await this.save(); return this.broadcast();
    }
    if (m.t !== "move") return;
    if (s.winner) return no("the game is over");
    if (s.turn !== side) return no("it's not your turn");
    const r = this.ring(), k = m.k;
    let v;
    try { v = r.parse(String(m.v).slice(0, 120)); } catch (e) { return no(e.message); }
    const g = { d: s.d, first: s.first, turn: s.turn, c: s.c.map(x => (x === null ? null : r.parse(x))), log: [], winner: null, root: null };
    const bad = G.moveError(r, g, k, v);
    if (bad) return no(bad);
    G.play(r, g, k, v);
    s.c[k] = r.show(v); s.log.push({ k, v: s.c[k], by: side }); s.turn = g.turn;
    if (g.winner) { s.winner = g.winner; s.root = g.root && { show: g.root.show, tex: g.root.tex, approx: !!g.root.approx }; }
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
    await this.load();
    this.broadcast(ws);
  }
  async webSocketError(ws) { await this.load(); this.broadcast(ws); }

  async alarm() {
    const s = await this.load();
    if (s && Date.now() - s.at < TTL) return this.ctx.storage.setAlarm(s.at + TTL);
    await this.ctx.storage.deleteAll();
    this.s = null;
  }

  broadcast(gone) {
    const s = this.s;
    if (!s) return;
    const socks = this.ctx.getWebSockets().filter(w => w !== gone);
    const online = { host: socks.some(w => (w.deserializeAttachment() || {}).role === "host"), guest: socks.some(w => (w.deserializeAttachment() || {}).role === "guest") };
    const view = { spec: s.spec, d: s.d, first: s.first, host: s.host, c: s.c, turn: s.turn, log: s.log, winner: s.winner, root: s.root, round: s.round, online, joined: !!s.guest };
    for (const w of socks) {
      const { role } = w.deserializeAttachment() || {};
      try { w.send(JSON.stringify({ t: "state", you: role, s: view })); } catch {}
    }
  }
}
