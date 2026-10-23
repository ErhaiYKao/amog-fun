// amog.fun Worker. The site is static files in public/; this only runs for /api/* (run_worker_first in wrangler.jsonc).
import { handle } from "./leaderboard.js";
import { game as omegamac } from "./omegamac.js";
import { game as fermimac } from "./fermimac.js";

const GAMES = { omegamac, fermimac };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/([a-z]+)\/([a-z]+)$/);
    if (m && GAMES[m[1]]) return handle(GAMES[m[1]], req, env, m[2], url);
    if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 });
    return env.ASSETS.fetch(req);
  },
};
