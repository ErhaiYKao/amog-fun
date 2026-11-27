/* Online rooms for Dots & Boxes (public/dotsandboxes/), on the shared Room (worker/room.js: seats, hibernating
 * WebSockets, week-long expiry). The DO referees with the page's own rules.js. The host is player 0, the guest 1;
 * `first` says who opens and swaps on every rematch.
 *   POST /api/dotsandboxes/new {n, first}  -> {room, seat}   (n = 3..6 boxes a side; first = "host" | "guest")
 *   GET  /api/dotsandboxes/ws?room=&seat=  -> WebSocket
 *   client -> {t: "move", e} | {t: "again"}   (again: after a game, the other player opens a fresh board)
 *   server -> {t: "state", you: "host" | "guest" | "watch", s: {...game, round, online, joined}} | {t: "error", msg} */
import { Room, connectRoom, json, rid } from "./room.js";
import "../public/dotsandboxes/rules.js";

const D = globalThis.DABRules;

export async function handleDab(req, env, route, url) {
  if (route === "new" && req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    let g;
    try { g = D.newGame(b && b.n, b && b.first === "guest" ? 1 : 0); } catch (e) { return json({ error: e.message }, 400); }
    const room = rid(8), seat = rid(24);
    await env.DABROOMS.get(env.DABROOMS.idFromName(room)).init({ g, seat });
    return json({ room, seat });
  }
  if (route === "ws") return connectRoom(req, env.DABROOMS, url);
  return json({ error: "not found" }, 404);
}

export class DabRoom extends Room {
  async init({ g, seat }) {
    this.s = { g, seat, guest: null, round: 1, at: Date.now() };
    await this.save();
  }

  act(role, m, no) {
    const s = this.s, p = role === "host" ? 0 : 1;
    if (m.t === "again") {
      if (!s.g.over) return no("the game isn't over yet");
      s.g = D.newGame(s.g.n, 1 - s.g.first); s.round++;
      return true;
    }
    if (m.t !== "move") return;
    const bad = D.moveError(s.g, p, m.e);
    if (bad) return no(bad);
    D.play(s.g, m.e);
    return true;
  }

  view() { return { ...this.s.g, round: this.s.round }; }
}
