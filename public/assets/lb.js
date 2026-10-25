/* amog.fun shared leaderboard client (server: worker/leaderboard.js). Used by Omegamac and Fermimac.
 *   const lb = AmogLB(game, { head, list, getName, setName })
 *   lb.api(path, payload?, timeout?)  -> parsed JSON, {error} for an error response, null if unreachable
 *   lb.start(preset, d)               -> {token, seed} or null (then play the run unranked)
 *   lb.show(board | null, note)       board = {preset, name, d}; note is shown when there's no board
 *   lb.submit(row, run, data, onDone) run = {token, preset, name, d}; data = {answers, times}. Asks for a name
 *                                     the first time, then submits automatically (and asks again if the server refuses the name). */
(function () {
  "use strict";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = n => Number(n).toLocaleString("en-US");
  const dur = d => (+d ? `${d} s` : "untimed"); // d = 0: an untimed board
  const TTL = 20000;
  const css = document.createElement("style");
  css.textContent = `.lb-list { list-style: none; margin: 0; padding: 0; font-family: var(--mono); font-size: 14px; max-width: 420px; }
    .lb-list li { display: grid; grid-template-columns: 2.5em minmax(0, 1fr) auto; gap: 10px; padding: 6px 4px; border-bottom: 1px solid var(--line); }
    .lb-list .n { color: var(--faint); }
    .lb-list .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--serif); font-size: 16px; }
    .lb-list li.me, .lb-list li.me .who, .lb-on { color: var(--g1); }
    .lb-name { width: 150px; }`;
  document.head.append(css);

  window.AmogLB = function (game, { head, list, getName, setName }) {
    async function api(path, payload, timeout = 6000) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
      try {
        const opt = payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {};
        const r = await fetch(`/api/${game}/${path}`, { ...opt, signal: ctl.signal });
        const j = await r.json().catch(() => ({}));
        return r.ok ? j : { ...j, error: j.error || "error " + r.status };
      } catch { return null; } finally { clearTimeout(t); }
    }
    const start = async (preset, d) => { const r = await api("start", { preset, d }, 2500); return r && r.token ? r : null; };

    const cache = new Map();
    let shown = "", pending = "";
    function draw(key, top, label) {
      if (key !== shown) return;
      const me = (getName() || "").toLowerCase();
      head.innerHTML = `<span class="lb-on">${esc(label)}</span>, best score per player. Runs are replayed on the server before they count.`;
      list.innerHTML = !top ? `<p class="meta">Couldn't load the leaderboard.</p>` : !top.length ? `<p class="meta">Nobody yet. Be the first.</p>`
        : `<ol class="lb-list">${top.map((r, i) => `<li class="${r.name.toLowerCase() === me ? "me" : ""}"><span class="n">${i + 1}</span><span class="who">${esc(r.name)}</span><b>${num(r.score)}</b></li>`).join("")}</ol>`;
    }
    async function show(b, note, fresh) {
      if (!b) { shown = ""; head.textContent = ""; list.innerHTML = `<p class="meta">${note || ""}</p>`; return; }
      const key = b.preset + "|" + b.d, label = `${b.name} · ${dur(b.d)}`, c = cache.get(key), same = key === shown;
      shown = key;
      if (fresh) { cache.set(key, { at: Date.now(), top: fresh }); return draw(key, fresh, label); }
      if (c && Date.now() - c.at < TTL) { if (!same) draw(key, c.top, label); return; }
      if (pending === key) return;
      if (!c) list.innerHTML = `<p class="meta">Loading…</p>`;
      pending = key;
      const r = await api(`top?preset=${encodeURIComponent(b.preset)}&d=${b.d}`);
      pending = "";
      if (r && r.top) cache.set(key, { at: Date.now(), top: r.top });
      draw(key, (r && r.top) || (c && c.top) || null, label);
    }

    function submit(row, run, data, onDone) {
      const retry = name => { const b = document.createElement("button"); b.className = "mini"; b.textContent = "retry"; b.onclick = () => send(name); return b; };
      async function send(name) {
        row.textContent = "Submitting…";
        const r = await api("submit", { token: run.token, answers: data.answers, times: data.times, name });
        if (r && r.name) { setName(null); return ask(r.error); } // the server refused the name: pick another, same run
        if (!r || r.error) { row.innerHTML = `Not submitted: ${esc(r ? r.error : "couldn't reach the server")}. `; if (!r) row.append(retry(name)); return; }
        setName(name);
        row.innerHTML = `<span class="lb-on">#${r.rank}</span> on ${esc(run.name)} · ${dur(run.d)} as <b>${esc(name)}</b>${r.best > r.score ? ` (your best there is ${num(r.best)})` : ""}. <a href="#" class="lb-notme">not you?</a>`;
        row.querySelector(".lb-notme").onclick = e => { e.preventDefault(); setName(null); row.textContent = "Next time you'll be asked for a name."; };
        show({ preset: run.preset, name: run.name, d: run.d }, "", r.top);
        if (onDone) onDone(r);
      }
      function ask(why) {
        row.innerHTML = `${why ? esc(why) + ": " : ""}<input class="txt lb-name" maxlength="20" placeholder="your name"> <button class="mini lb-send">submit to leaderboard</button>`;
        const input = row.querySelector(".lb-name");
        const go = () => { const n = input.value.trim(); if (n) send(n); else input.focus(); };
        row.querySelector(".lb-send").onclick = go;
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); go(); } });
        if (why) input.focus();
      }
      if (getName()) return send(getName());
      ask();
    }

    return { api, start, show, submit, esc };
  };
})();
