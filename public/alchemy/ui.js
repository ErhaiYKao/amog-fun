/* Alchemy — UI core: game loop, saving, events, tooltips, log, quest card.
 * panels.js and island.js add their renderers to AlchemyUI before boot runs. */
(function () {
  "use strict";
  const A = window.Alchemy, D = A.DATA, I = window.AlchemyIcons;
  const $ = id => document.getElementById(id);
  const UI = (window.AlchemyUI = { A, D, I, $, s: null, renderers: [], selected: -1, filter: "all" });

  // ---------- helpers shared by the panels ----------
  UI.esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  UI.name = id => (D.ITEMS[id] ? D.ITEMS[id].name : id);
  UI.img = (id, cls = "") => `<img class="px ${cls}" src="${I.url(id)}" alt="">`;
  UI.fmt = n => (n >= 1e5 ? Math.round(n / 1000) + "k" : n >= 1e4 ? (n / 1000).toFixed(1) + "k" : String(Math.floor(n)));
  UI.secs = t => (t >= 3600 ? `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m` : t >= 60 ? `${Math.floor(t / 60)}m ${Math.floor(t % 60)}s` : `${Math.ceil(t)}s`);
  const html = {};
  UI.setHTML = (el, key, h) => { if (html[key] !== h) { html[key] = h; el.innerHTML = h; } };

  // live values: elements carry data-v (text), data-w (bar fraction) or data-d (disabled)
  const V = {};
  UI.v = (k, x) => (V[k] = x);
  function applyBindings() {
    document.querySelectorAll("[data-v]").forEach(el => { const x = V[el.dataset.v]; if (x !== undefined && el.textContent !== String(x)) el.textContent = x; });
    document.querySelectorAll("[data-w]").forEach(el => { const x = V[el.dataset.w]; if (x !== undefined) el.style.width = (Math.max(0, Math.min(1, x)) * 100).toFixed(1) + "%"; });
    document.querySelectorAll("[data-d]").forEach(el => { const x = !!V[el.dataset.d]; if (el.disabled !== x) el.disabled = x; });
  }

  // ---------- log ----------
  const logItems = [];
  UI.log = (text, cls = "", icon = null) => {
    logItems.unshift({ text, cls, icon });
    logItems.length = Math.min(logItems.length, 9);
    UI.setHTML($("log"), "log", logItems.map(l => `<li class="${l.cls}">${l.icon ? UI.img(l.icon, "sm") : ""}<span>${UI.esc(l.text)}</span></li>`).join(""));
  };
  const RARE = new Set(["silkworm", "diamond", "glowstone"]);
  function drainEvents() {
    const s = UI.s;
    for (const e of s.ev.splice(0)) {
      if (e.type === "quest") UI.log(`Quest complete: ${e.text}`, "quest");
      if (e.type === "new") UI.log(`New: ${e.text}`, "new", e.id);
    }
  }
  UI.noteGains = gains => {
    for (const id in gains) if (RARE.has(id) && UI.s.got[id] > gains[id]) UI.log(`Found ${gains[id] > 1 ? gains[id] + " × " : "a "}${UI.name(id)}!`, "new", id);
  };

  // ---------- quest + stats ----------
  function renderQuest() {
    const s = UI.s, q = A.currentQuest(s), n = D.QUESTS.filter(x => s.quests[x.id]).length;
    const list = D.QUESTS.map(x => `<li class="${s.quests[x.id] ? "done" : ""}">${UI.esc(x.title)}</li>`).join("");
    UI.setHTML($("quest"), "quest", q
      ? `<div class="num">Quest ${n + 1} of ${D.QUESTS.length}</div><h2>${UI.esc(q.title)}</h2><p>${UI.esc(q.text)}</p><details><summary>all quests</summary><ol>${list}</ol></details>`
      : `<div class="num">All ${D.QUESTS.length} quests done</div><h2>Everything</h2><p>The void has been fully factored. Keep automating, or reset and speedrun it.</p><details><summary>all quests</summary><ol>${list}</ol></details>`);
    UI.setHTML($("stats"), "stats", `<span>played <b data-v="st:time"></b></span><span>clicks <b data-v="st:clicks"></b></span><span>quests <b>${n}/${D.QUESTS.length}</b></span>`);
    UI.v("st:time", UI.secs(((s.won || Date.now()) - s.start) / 1000));
    UI.v("st:clicks", UI.fmt(s.clicks));
  }

  // ---------- tooltips ----------
  const tip = $("tip");
  function tipFor(id) {
    const it = D.ITEMS[id];
    if (!it) return "";
    const bits = [];
    if (it.fuel) bits.push(`fuel · heat ${it.fuel[0]} · ${it.fuel[1]} s`);
    if (it.compost) bits.push(`compost · ${it.compost}`);
    if (it.place) bits.push("takes one island tile");
    for (const kind in D.CONFIG.tools) if (D.CONFIG.tools[kind].some(([t]) => t === id)) bits.push(`tool · ${kind}`);
    return `<b>${UI.esc(it.name)}</b>${it.desc ? `<div>${UI.esc(it.desc)}</div>` : ""}${bits.length ? `<small>${bits.join(" · ")}</small>` : ""}`;
  }
  document.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) { tip.style.display = "none"; return; }
    tip.innerHTML = tipFor(el.dataset.tip);
    tip.style.display = tip.innerHTML ? "block" : "none";
  });
  document.addEventListener("mousemove", e => {
    if (tip.style.display !== "block") return;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  });

  // ---------- input ----------
  UI.handlers = {};
  function floatText(el, text) {
    const box = el.closest(".act") || el.parentElement;
    const f = document.createElement("span");
    f.className = "float";
    f.textContent = text;
    f.style.left = 20 + Math.random() * 60 + "px";
    f.style.top = "6px";
    box.appendChild(f);
    setTimeout(() => f.remove(), 900);
  }
  UI.doAct = (id, el) => {
    const r = A.act(UI.s, id);
    if (!r) return;
    if (r.done && el) floatText(el, Object.entries(r.gains).map(([k, n]) => `+${n} ${UI.name(k)}`).join("  ") || "nothing");
    UI.noteGains(r.gains);
    render();
  };
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const [type, ...args] = el.dataset.act.split(":");
    const h = UI.handlers[type];
    if (h) { h(args, el, e); render(); }
  });
  document.addEventListener("change", e => {
    const el = e.target.closest("[data-opt]");
    if (el) { UI.s.opt[el.dataset.opt] = el.checked; render(); }
  });
  let lastKey = 0;
  document.addEventListener("keydown", e => {
    if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    const id = Object.keys(D.ACTIONS).find(k => D.ACTIONS[k].key === e.key);
    if (!id || performance.now() - lastKey < 110) return;
    lastKey = performance.now();
    e.preventDefault();
    UI.doAct(id, document.querySelector(`[data-act="act:${id}"]`));
  });

  Object.assign(UI.handlers, {
    act: ([id], el) => UI.doAct(id, el),
    closewin: () => $("win").classList.remove("show"),
    export: () => {
      const code = btoa(unescape(encodeURIComponent(A.serialize(UI.s))));
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => UI.log("Save copied to clipboard."), () => prompt("Your save:", code));
      else prompt("Your save:", code);
    },
    import: () => {
      const code = prompt("Paste a save:");
      if (!code) return;
      try { UI.s = A.revive(decodeURIComponent(escape(atob(code.trim())))); save(); UI.log("Save imported."); }
      catch { UI.log("That save didn't parse."); }
    },
    reset: () => {
      if (!confirm("Start over from a single tree? This deletes your progress.")) return;
      UI.s = A.create(); UI.selected = -1; save(); UI.log("A new island floats in the void.");
    },
  });

  // ---------- saving ----------
  function save() { try { UI.s.t = Date.now(); localStorage.setItem(A.KEY, A.serialize(UI.s)); } catch {} }
  function load() {
    try {
      const raw = localStorage.getItem(A.KEY);
      if (!raw) return null;
      const s = A.revive(raw);
      const away = A.catchUp(s);
      if (away.secs > 60) {
        const g = Object.entries(away.gains).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${UI.fmt(n)} ${UI.name(k)}`).join(", ");
        setTimeout(() => UI.log(`While you were away (${UI.secs(away.secs)}): ${g || "nothing happened"}.`), 0);
      }
      return s;
    } catch { return null; }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  addEventListener("pagehide", save);

  // ---------- loop ----------
  function render() {
    renderQuest();
    for (const r of UI.renderers) r();
    applyBindings();
    if (UI.s.won && !UI.s.winShown) {
      UI.s.winShown = 1;
      $("win-icon").src = I.url("terminal");
      $("win-text").textContent = `You went from one tree to the terminal object in ${UI.secs((UI.s.won - UI.s.start) / 1000)} and ${UI.fmt(UI.s.clicks)} clicks. Every object in the void now has a unique arrow to you.`;
      $("win").classList.add("show");
    }
  }
  UI.render = render;
  let last = performance.now(), sinceSave = 0;
  function frame() {
    const now = performance.now();
    let dt = Math.min((now - last) / 1000, D.CONFIG.offline);
    last = now;
    while (dt > 0) { const step = Math.min(1, dt); A.tick(UI.s, step); dt -= step; }
    UI.s.t = Date.now();
    drainEvents();
    render();
    if ((sinceSave += 0.1) > 10) { sinceSave = 0; save(); }
  }

  function boot() {
    UI.s = load() || A.create();
    if (!UI.s.clicks) UI.log("You are a tree on a block of dirt in the void. Start chopping.");
    render();
    setInterval(frame, 100);
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
