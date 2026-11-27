/* Online two-player rooms, shared by the Coefficient Game (coefficients.js) and Dots & Boxes (dotsandboxes.js).
 * One SQLite-backed Durable Object per room (free plan) holding the game and the players' WebSockets (hibernation
 * API, so an idle room costs nothing). The host's seat token comes from /new; the first other token to connect
 * becomes the guest; anyone else watches. Rooms are deleted after a week without a move.
 * A subclass stores its game in this.s next to {seat, guest, at} and implements
 *   view()                -> what every socket is sent: {t: "state", you: "host" | "guest" | "watch", s: view}
 *   act(role, m, no)      -> handle a parsed message from a player (role "host"/"guest"); return true to save and
 *                            broadcast, or call no(msg) to send that socket {t: "error", msg}. */
import { DurableObject } from "cloudflare:workers";

export const ROOM = /^[a-z0-9]{8}$/, SEAT = /^[A-Za-z0-9_-]{16,40}$/;
const TTL = 7 * 24 * 3600 * 1000;
export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
export const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

// The /ws route: hand the upgrade to the room's Durable Object.
export function connectRoom(req, ns, url) {
  const room = url.searchParams.get("room") || "";
  if (!ROOM.test(room)) return json({ error: "no such room" }, 404);
  if (req.headers.get("Upgrade") !== "websocket") return json({ error: "expected a websocket" }, 426);
  return ns.get(ns.idFromName(room)).fetch(req);
}

export class Room extends DurableObject {
  async load() { if (this.s === undefined) this.s = (await this.ctx.storage.get("s")) || null; return this.s; }
  async save() { this.s.at = Date.now(); await this.ctx.storage.put("s", this.s); await this.ctx.storage.setAlarm(this.s.at + TTL); }

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
    if (!m || typeof m !== "object") return;
    const { role } = ws.deserializeAttachment() || {};
    const no = msg => ws.send(JSON.stringify({ t: "error", msg }));
    if (role !== "host" && role !== "guest") return no("you're watching this game");
    if (await this.act(role, m, no)) { await this.save(); this.broadcast(); }
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
    if (!this.s) return;
    const socks = this.ctx.getWebSockets().filter(w => w !== gone);
    const roles = socks.map(w => (w.deserializeAttachment() || {}).role);
    const view = { ...this.view(), online: { host: roles.includes("host"), guest: roles.includes("guest") }, joined: !!this.s.guest };
    socks.forEach((w, i) => { try { w.send(JSON.stringify({ t: "state", you: roles[i], s: view })); } catch {} });
  }
}
