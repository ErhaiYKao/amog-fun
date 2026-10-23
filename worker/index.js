// amog.fun Worker. The site is static files in public/; this only runs for /api/* (run_worker_first in wrangler.jsonc).
import { handle as omegamac } from "./omegamac.js";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/omegamac/")) return omegamac(req, env, url);
    if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 });
    return env.ASSETS.fetch(req);
  },
};
