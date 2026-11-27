/* AmogInk: scribble on any page. A small ✎ button (bottom right) opens a bar with pen, text and eraser.
 * Notes stay in this browser, one sheet per page: localStorage `amog.ink.<path>` = {s: [{c, p: [[x, y]...]}], t: [{c, x, y, t}]}.
 * Coordinates are CSS px relative to the page's `.wrap` (else <body>), so notes stay with the content when the
 * centred column moves on a wider window. While drawing, the canvas takes every click; "done" (or Esc) gives the page back.
 * Include on any page: <script src="/assets/ink.js" defer></script>. Boards with their own ink (Nim's kit.js) keep it.
 */
(function () {
  "use strict";
  if (window.AmogInk) return;
  const KEY = "amog.ink." + (location.pathname.replace(/index\.html$/, "").replace(/\/?$/, "/"));
  const COLORS = { c: "#4fd6e8", r: "#ff5d6c", l: "#b6f26b", w: "#ece8de" };
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const put = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch {} };

  let sheet = get(KEY, null) || { s: [], t: [] };
  let mode = null, color = get("amog.ink.color", "c"), hidden = false, hist = [], cur = null, editing = null;
  const empty = () => !sheet.s.length && !sheet.t.length;
  const save = () => put(KEY, empty() ? null : sheet);
  const snap = () => { hist.push(JSON.stringify(sheet)); if (hist.length > 100) hist.shift(); };

  const css = document.createElement("style");
  css.textContent = `
.ink-cv{position:fixed;inset:0;width:100vw;height:100vh;z-index:9980;pointer-events:none}
.ink-on .ink-cv{pointer-events:auto;touch-action:none;cursor:crosshair}
.ink-on[data-ink="text"] .ink-cv{cursor:text}.ink-on[data-ink="erase"] .ink-cv{cursor:cell}
.ink-fab,.ink-bar{position:fixed;right:14px;bottom:14px;z-index:9990;font:12px "JetBrains Mono",ui-monospace,Menlo,monospace}
.ink-fab{width:36px;height:36px;border-radius:50%;border:1px solid #34333f;background:#111118;color:#9a97a6;cursor:pointer;opacity:.7;font-size:16px;line-height:1}
.ink-fab:hover{opacity:1;color:#ece8de}.ink-fab.has::after{content:"";position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:#4fd6e8}
.ink-bar{display:none;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100vw - 28px);background:#111118ee;border:1px solid #34333f;border-radius:12px;padding:6px;backdrop-filter:blur(6px)}
.ink-on .ink-bar{display:flex}.ink-on .ink-fab{display:none}
.ink-bar button{font:inherit;color:#9a97a6;background:transparent;border:1px solid transparent;border-radius:7px;padding:4px 8px;cursor:pointer}
.ink-bar button:hover{color:#ece8de}.ink-bar button[aria-pressed=true]{color:#ece8de;background:#181822;border-color:#34333f}
.ink-bar .sw{width:18px;height:18px;padding:0;border-radius:50%;background:var(--c);opacity:.5}
.ink-bar .sw[aria-pressed=true]{opacity:1;box-shadow:0 0 0 2px #111118,0 0 0 3px var(--c)}
.ink-bar .done{color:#0a0a0f;background:#ece8de}.ink-bar .done:hover{color:#0a0a0f}
.ink-txt{position:fixed;z-index:9991;font:15px "JetBrains Mono",ui-monospace,Menlo,monospace;background:#0a0a0fdd;border:1px solid #4fd6e8;border-radius:5px;padding:2px 5px;outline:none;min-width:80px}
@media print{.ink-fab,.ink-bar{display:none}}`;

  const cv = document.createElement("canvas");
  cv.className = "ink-cv";
  const fab = document.createElement("button");
  fab.className = "ink-fab";
  fab.textContent = "✎";
  fab.title = "Annotate this page";
  fab.setAttribute("aria-label", "Annotate this page");
  const bar = document.createElement("div");
  bar.className = "ink-bar";
  bar.innerHTML = `${Object.entries(COLORS).map(([k, v]) => `<button class="sw" data-c="${k}" style="--c:${v}" aria-label="colour"></button>`).join("")}
    <button data-m="pen">✎ pen</button><button data-m="text">T text</button><button data-m="erase">erase</button>
    <button data-a="undo">undo</button><button data-a="hide">hide</button><button data-a="clear">clear</button><button class="done" data-a="done">done</button>`;

  function sync() {
    const root = document.documentElement;
    root.classList.toggle("ink-on", !!mode);
    if (mode) root.dataset.ink = mode; else delete root.dataset.ink;
    bar.querySelectorAll("[data-m]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === mode)));
    bar.querySelectorAll("[data-c]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.c === color)));
    bar.querySelector('[data-a="hide"]').textContent = hidden ? "show" : "hide";
    fab.classList.toggle("has", !empty());
    draw();
  }
  fab.addEventListener("click", () => { mode = "pen"; hidden = false; sync(); });
  bar.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    commitText();
    if (b.dataset.m) mode = b.dataset.m;
    else if (b.dataset.c) { color = b.dataset.c; put("amog.ink.color", color); if (mode === "erase") mode = "pen"; }
    else if (b.dataset.a === "undo") { if (hist.length) { sheet = JSON.parse(hist.pop()); save(); } }
    else if (b.dataset.a === "hide") hidden = !hidden;
    else if (b.dataset.a === "clear") { if (!empty()) { snap(); sheet = { s: [], t: [] }; save(); } }
    else if (b.dataset.a === "done") mode = null;
    sync();
  });

  // page frame: origin at the anchor's top-left in document coordinates
  const anchor = () => document.querySelector(".wrap") || document.body;
  const frame = () => { const r = anchor().getBoundingClientRect(); return { x: r.left, y: r.top }; };
  const at = e => { const f = frame(); return [Math.round(e.clientX - f.x), Math.round(e.clientY - f.y)]; };

  function draw() {
    const dpr = window.devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (hidden) return;
    const f = frame();
    g.lineCap = g.lineJoin = "round";
    g.lineWidth = 2.5;
    for (const st of sheet.s) {
      g.strokeStyle = COLORS[st.c] || COLORS.c;
      g.beginPath();
      st.p.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, f.x + x, f.y + y));
      g.stroke();
    }
    g.font = '15px "JetBrains Mono", ui-monospace, Menlo, monospace';
    g.textBaseline = "middle";
    for (const t of sheet.t) {
      if (t === editing) continue;
      g.lineWidth = 3; g.strokeStyle = "#0a0a0f"; g.strokeText(t.t, f.x + t.x, f.y + t.y);
      g.fillStyle = COLORS[t.c] || COLORS.c; g.fillText(t.t, f.x + t.x, f.y + t.y);
    }
    g.lineWidth = 2.5;
  }
  let queued = false;
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };

  function rub(p) {
    const near = q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 12;
    const s = sheet.s.filter(st => !st.p.some(near));
    const g = cv.getContext("2d");
    g.font = '15px "JetBrains Mono", ui-monospace, Menlo, monospace';
    const t = sheet.t.filter(x => !(p[0] > x.x - 6 && p[0] < x.x + g.measureText(x.t).width + 6 && Math.abs(p[1] - x.y) < 12));
    if (s.length !== sheet.s.length || t.length !== sheet.t.length) { if (!cur.rubbed) { snap(); cur.rubbed = true; } sheet.s = s; sheet.t = t; draw(); }
  }
  cv.addEventListener("pointerdown", e => {
    if (!mode) return;
    e.preventDefault();
    if (mode === "text") return startText(e);
    cv.setPointerCapture(e.pointerId);
    if (mode === "pen") { snap(); cur = { c: color, p: [at(e)] }; sheet.s.push(cur); draw(); }
    else { cur = { erase: true }; rub(at(e)); }
  });
  cv.addEventListener("pointermove", e => {
    if (!cur) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of evs.length ? evs : [e]) {
      const p = at(ev);
      if (cur.erase) rub(p);
      else { const l = cur.p[cur.p.length - 1]; if (l[0] !== p[0] || l[1] !== p[1]) cur.p.push(p); }
    }
    if (!cur.erase) later();
  });
  const end = () => { if (!cur) return; if (!cur.erase && cur.p.length === 1) cur.p.push([cur.p[0][0] + 1, cur.p[0][1]]); cur = null; save(); sync(); };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);

  // text: click places a box, Enter or clicking elsewhere keeps it, Esc drops it
  let box = null;
  function startText(e) {
    commitText();
    const f = frame(), p = at(e);
    // clicking an existing note edits it
    const g = cv.getContext("2d");
    g.font = '15px "JetBrains Mono", ui-monospace, Menlo, monospace';
    const old = sheet.t.find(x => p[0] > x.x - 4 && p[0] < x.x + g.measureText(x.t).width + 4 && Math.abs(p[1] - x.y) < 11);
    editing = old || { c: color, x: p[0], y: p[1], t: "" };
    box = document.createElement("input");
    box.className = "ink-txt";
    box.value = editing.t;
    box.style.color = COLORS[editing.c] || COLORS.c;
    box.style.left = f.x + editing.x - 6 + "px";
    box.style.top = f.y + editing.y - 13 + "px";
    box.addEventListener("keydown", ev => {
      ev.stopPropagation();
      if (ev.key === "Enter") commitText();
      if (ev.key === "Escape") { commitText(true); }
    });
    box.addEventListener("blur", () => commitText());
    document.body.appendChild(box);
    draw();
    setTimeout(() => box && box.focus(), 0);
  }
  function commitText(cancel) {
    if (!box) return;
    const t = box.value.trim().slice(0, 200), was = editing;
    box.remove(); box = null; editing = null;
    if (!cancel && t !== was.t) {
      snap();
      if (!sheet.t.includes(was)) { if (t) sheet.t.push(was); }
      if (t) was.t = t; else sheet.t = sheet.t.filter(x => x !== was);
      save();
    }
    sync();
  }

  document.addEventListener("keydown", e => { if (mode && e.key === "Escape" && !box) { mode = null; sync(); } });
  addEventListener("scroll", later, { passive: true });
  addEventListener("resize", later);
  // other tabs on this page
  addEventListener("storage", e => { if (e.key === KEY) { sheet = get(KEY, null) || { s: [], t: [] }; sync(); } });

  function mount() {
    document.head.appendChild(css);
    document.body.append(cv, fab, bar);
    new ResizeObserver(later).observe(anchor());
    sync();
  }
  if (document.body) mount(); else addEventListener("DOMContentLoaded", mount);
  window.AmogInk = { redraw: later };
})();
