/* Online rooms for the Coefficient Choosing Game (public/coefficient-game/), on the shared Room (worker/room.js:
 * seats, hibernating WebSockets, week-long expiry). The DO referees with the page's own ring.js: it parses every
 * value, checks the move and decides the winner.
 *   POST /api/coefficient-game/new {ring, d, first, side}  -> {room, seat}   (side = the host's side, A or S)
 *   GET  /api/coefficient-game/ws?room=&seat=              -> WebSocket
 *   client -> {t: "move", k, v} | {t: "again"}   (again: after a game, swap sides and reset)
 *   server -> {t: "state", you: "host" | "guest" | "watch", s} | {t: "error", msg} */
import { Room, connectRoom, json, rid } from "./room.js";
import "../public/coefficient-game/ring.js";

const G = globalThis.CoeffGame;
const MAX_ONLINE_SIZE = 20000; // keep the referee's root test well inside the CPU limit

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
  if (route === "ws") return connectRoom(req, env.ROOMS, url);
  return json({ error: "not found" }, 404);
}

const fresh = s => Object.assign(s, { c: new Array(s.d + 1).fill(null), turn: s.first, log: [], winner: null, root: null });

export class CoeffRoom extends Room {
  async init(o) {
    this.s = fresh({ ...o, guest: null, round: 1, at: Date.now() });
    await this.save();
  }
  ring() { if (!this.r) this.r = G.parseRing(this.s.spec); return this.r; }

  act(role, m, no) {
    const s = this.s, side = role === "host" ? s.host : G.other(s.host);
    if (m.t === "again") {
      if (!s.winner) return no("the game isn't over yet");
      s.host = G.other(s.host); s.round++; fresh(s);
      return true;
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
    return true;
  }

  view() {
    const s = this.s;
    return { spec: s.spec, d: s.d, first: s.first, host: s.host, c: s.c, turn: s.turn, log: s.log, winner: s.winner, root: s.root, round: s.round };
  }
}
