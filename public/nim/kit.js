/* NimKit — shared engine for the Nim family: turns, Amog's AI, scores, hints, game over.
 *
 * A variant calls NimKit.start({
 *   id, options: [{ key, label, choices: [[value, label]], def }],
 *   create(opts)            -> state
 *   moves(s, who)           -> legal moves for who (0 = you, 1 = Amog)
 *   apply(s, move, who)     -> new state (don't mutate s)
 *   isP(s, who, opts)       -> true if `who`, to move, loses with perfect play
 *   render(el, s, ctx)      -> draw the board; ctx.play(move) makes your move, ctx.isGood(move) for hints
 *   describe(move, who, s)  -> text for the log
 *   math(s, who, opts)      -> HTML (LaTeX ok) for the "show the math" panel
 *   misere(opts)            -> true if the last player to move loses (optional)
 *   prefer(move, s, who)    -> true for moves to favour when several are equally good (optional, Amog level only)
 *   symmetric(s)            -> true if a position is "mirrored" (easy to read); Amog avoids leaving these (optional)
 *   verdict(s, who, opts)   -> HTML replacing the P/N-position line in the math panel (optional; partizan games)
 *   custom: { placeholder, help, parse(text, opts) -> state or error string }  (optional: "custom start" box)
 *   inkKey(s)               -> which annotation sheet goes with this board (optional; e.g. the board size)
 * })
 *
 * Annotations (the ✎ bar under every board): pen strokes on a canvas over the board, saved per variant
 * (and per inkKey) in localStorage `amog.nim.<id>.ink.<key>`. Strokes are stored relative to the board's
 * `[data-ink-anchor]` element (else the board), so they stay put when the page reflows. Cells with a
 * `data-note="<key>"` attribute can also hold typed labels (the "label" tool: tap a cell, type, arrows move).
 */
(function () {
  "use strict";
  const VARIANTS = [["/nim/", "Nim"], ["/nim/fibonacci/", "Fibonacci"], ["/nim/wythoff/", "Wythoff"], ["/nim/kayles/", "Kayles"], ["/nim/staircase/", "Staircase"], ["/nim/northcott/", "Northcott"], ["/nim/subtraction/", "Subtraction"], ["/nim/hackenbush/", "Hackenbush"]];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function nav() {
    const el = document.getElementById("nk-nav");
    if (!el) return;
    const here = location.pathname.replace(/\/?$/, "/");
    el.innerHTML = VARIANTS.map(([href, name]) => `<a href="${href}" class="${here === href ? "on" : ""}">${name}</a>`).join("");
  }

  // theory sections are spoilers: blur everything under the heading until asked
  function spoilers() {
    document.querySelectorAll(".theory").forEach(sec => {
      const body = document.createElement("div");
      body.className = "spoiler-body";
      [...sec.children].filter(el => el.tagName !== "H2").forEach(el => body.appendChild(el));
      const btn = document.createElement("button");
      btn.className = "btn spoiler-btn";
      sec.classList.add("spoiler", "hidden");
      const sync = () => { btn.textContent = sec.classList.contains("hidden") ? "Show the solution (spoiler)" : "Hide the solution"; };
      btn.addEventListener("click", () => { sec.classList.toggle("hidden"); sync(); });
      sync();
      sec.append(body, btn);
    });
  }

  function start(cfg) {
    nav();
    spoilers();
    const root = document.getElementById("nim");
    const K = "amog.nim." + cfg.id;
    const baseOpts = [
      { key: "level", label: "Amog's level", choices: [["easy", "novice"], ["hard", "Amog"]], def: "hard" },
      { key: "first", label: "First move", choices: [["you", "you"], ["amog", "amog"]], def: "you" },
    ];
    const allOpts = (cfg.options || []).concat(baseOpts);
    const opts = Object.assign(Object.fromEntries(allOpts.map(o => [o.key, o.def])), store.get(K + ".opts", {}));
    const score = store.get(K + ".score", [0, 0]);
    let s, turn, over, gid = 0, timer, log = [], hint = store.get(K + ".hint", false), peeked = false;

    root.innerHTML = `<div class="nk">
      <div class="nk-board-wrap"><div class="nk-stage" id="nk-stage"><div class="nk-board" id="nk-board"></div><canvas class="nk-ink" id="nk-ink"></canvas>
        <div class="nk-over" id="nk-over"><div class="card"><h2 id="nk-ot"></h2><p id="nk-op"></p><button class="btn primary" id="nk-again">Play again</button></div></div></div>
        <div class="nk-tools" id="nk-tools"></div></div>
      <aside class="nk-panel">
        <div class="nk-scores"><div class="nk-score you" id="nk-you"><div class="who">you</div><div class="n" id="nk-wy">0</div></div><div class="nk-score amog" id="nk-amog"><div class="who">amog</div><div class="n" id="nk-wa">0</div></div></div>
        <div class="nk-status" id="nk-status"></div>
        <div class="nk-controls">${allOpts.map(o => `<div class="nk-field"><span>${esc(o.label)}</span><div class="seg" data-key="${o.key}">${o.choices.map(([v, l]) => `<button data-v="${esc(v)}">${esc(l)}</button>`).join("")}</div></div>`).join("")}
          ${cfg.custom ? `<div class="nk-field"><span>Custom start</span><form class="nk-custom" id="nk-cform"><input id="nk-cin" spellcheck="false" autocomplete="off" placeholder="${esc(cfg.custom.placeholder)}"><button class="btn">Play</button></form><div class="nk-chelp" id="nk-chelp">${esc(cfg.custom.help || "")}</div></div>` : ""}
          <button class="btn" id="nk-new">New game</button></div>
        <label class="nk-hint"><input type="checkbox" id="nk-hintbox"> show the math</label>
        <div class="nk-math" id="nk-math"></div>
        <ol class="nk-log" id="nk-log"></ol>
      </aside></div>`;
    const $ = id => document.getElementById(id);
    const board = $("nk-board");
    const ink = Ink(cfg, K, $("nk-stage"), board, $("nk-ink"), $("nk-tools"), () => s);

    root.querySelectorAll(".nk-controls .seg").forEach(seg => {
      const key = seg.dataset.key;
      const sync = () => seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v == opts[key])));
      seg.addEventListener("click", e => {
        const b = e.target.closest("button");
        if (!b) return;
        const o = allOpts.find(x => x.key === key);
        opts[key] = typeof o.def === "number" ? +b.dataset.v : b.dataset.v;
        store.set(K + ".opts", opts);
        sync();
        newGame(key === "first" || key === "level" ? lastCustom : null); // a custom start survives who-goes-first changes
      });
      sync();
    });
    $("nk-hintbox").checked = hint;
    $("nk-hintbox").addEventListener("change", e => { hint = e.target.checked; if (hint && !over) peeked = true; store.set(K + ".hint", hint); render(); });
    $("nk-new").addEventListener("click", () => newGame());
    $("nk-again").addEventListener("click", () => newGame(lastCustom));
    let lastCustom = null;
    if (cfg.custom) {
      $("nk-cin").value = store.get(K + ".custom", "");
      $("nk-cform").addEventListener("submit", e => {
        e.preventDefault();
        const text = $("nk-cin").value.trim(), help = $("nk-chelp");
        let r = text ? cfg.custom.parse(text, opts) : "Type a position first.";
        if (typeof r !== "string" && !cfg.moves(r, opts.first === "you" ? 0 : 1).length) r = "Nothing to play from there.";
        help.classList.toggle("err", typeof r === "string");
        help.textContent = typeof r === "string" ? r : cfg.custom.help || "";
        if (typeof r === "string") return;
        store.set(K + ".custom", text);
        lastCustom = r;
        newGame(r);
      });
    }

    const misere = () => !!(cfg.misere && cfg.misere(opts));
    const good = m => cfg.isP(cfg.apply(s, m, 0), 1, opts);
    const favour = (ms, who) => { if (!cfg.prefer) return ms; const p = ms.filter(m => cfg.prefer(m, s, who)); return p.length ? p : ms; };

    function newGame(from) {
      clearTimeout(timer);
      gid++;
      if (!from) lastCustom = null;
      s = from ? structuredClone(from) : cfg.create(opts);
      turn = opts.first === "you" ? 0 : 1;
      over = false;
      log = [];
      peeked = hint;
      $("nk-over").classList.remove("show");
      render();
      if (turn === 1) later();
    }

    function doMove(m, who) {
      log.unshift({ who, text: cfg.describe(m, who, s) });
      s = cfg.apply(s, m, who);
      turn = 1 - who;
      if (!cfg.moves(s, turn).length) return finish();
      render();
      if (turn === 1) later();
    }

    function later() {
      const id = gid;
      render();
      timer = setTimeout(() => {
        if (id !== gid || over) return;
        const ms = cfg.moves(s, 1);
        doMove(opts.level === "hard" ? amogMove(ms) : noviceMove(ms), 1);
      }, 550 + Math.random() * 250);
    }

    // who has won if `toMove` is stuck here (null if they still have moves)
    const stuckWinner = (st, toMove) => (cfg.moves(st, toMove).length ? null : misere() ? toMove : 1 - toMove);
    // novice: looks two plies ahead. Takes an instant win, avoids handing you one, otherwise plays at random.
    function noviceMove(ms) {
      const after = m => cfg.apply(s, m, 1);
      const wins = ms.filter(m => stuckWinner(after(m), 0) === 1);
      if (wins.length) return pick(wins);
      const safe = ms.filter(m => {
        const n = after(m);
        if (stuckWinner(n, 0) === 0) return false;
        return !cfg.moves(n, 0).some(r => stuckWinner(cfg.apply(n, r, 0), 1) === 0);
      });
      return pick(safe.length ? safe : ms);
    }
    // Amog: plays perfectly. Among winning moves it avoids mirrored positions; when it's losing, it makes you work
    // for it: no instant wins, no mirrored positions, and as few winning replies as possible.
    function amogMove(ms) {
      const sym = m => !!(cfg.symmetric && cfg.symmetric(cfg.apply(s, m, 1)));
      const wins = favour(ms.filter(m => cfg.isP(cfg.apply(s, m, 1), 0, opts)), 1);
      if (wins.length) { const plain = wins.filter(m => !sym(m)); return pick(plain.length ? plain : wins); }
      const scored = ms.map(m => {
        const n = cfg.apply(s, m, 1), replies = cfg.moves(n, 0);
        const instant = stuckWinner(n, 0) === 0 || replies.some(r => stuckWinner(cfg.apply(n, r, 0), 1) === 0);
        const good = replies.filter(r => cfg.isP(cfg.apply(n, r, 0), 1, opts)).length;
        return { m, score: (instant ? 1e6 : 0) + (sym(m) ? 1e4 : 0) + good };
      });
      const best = Math.min(...scored.map(x => x.score));
      return pick(scored.filter(x => x.score === best).map(x => x.m));
    }

    function finish() {
      over = true;
      const winner = misere() ? turn : 1 - turn;
      score[winner]++;
      if (winner === 0 && window.AmogAch) achieve();
      store.set(K + ".score", score);
      const lastWho = 1 - turn;
      const how = misere() ? `${lastWho === 0 ? "You" : "Amog"} made the last move, which loses in misère play.` : `${lastWho === 0 ? "You" : "Amog"} made the last move.`;
      $("nk-ot").textContent = winner === 0 ? "You win." : "Amog wins.";
      $("nk-op").textContent = how + (winner === 0 ? " The Order will hear of this." : " As the theorem predicted.");
      $("nk-over").classList.add("show");
      render();
    }

    // achievements: any win over the novice; full-strength Amog from a dealt start, without peeking at the math
    function achieve() {
      const A = window.AmogAch;
      if (opts.level === "easy") return A.unlock("nim.novice");
      if (lastCustom || peeked) return;
      A.unlock("nim." + cfg.id);
      if (A.NIM.every(([k]) => A.has("nim." + k))) A.unlock("nim.all");
    }

    function render() {
      // when a variant prefers some winning moves (e.g. advancing), only hint those
      const prefWin = hint && !over && turn === 0 && cfg.prefer && cfg.moves(s, 0).some(m => cfg.prefer(m, s, 0) && good(m));
      const ctx = {
        turn, over, opts, locked: over || turn !== 0,
        hint: hint && !over && turn === 0,
        isGood: m => hint && !over && turn === 0 && good(m) && (!prefWin || cfg.prefer(m, s, 0)),
        play: m => { if (!over && turn === 0) doMove(m, 0); },
      };
      board.classList.toggle("locked", ctx.locked);
      cfg.render(board, s, ctx);
      ink.render();
      $("nk-wy").textContent = score[0];
      $("nk-wa").textContent = score[1];
      $("nk-you").classList.toggle("active", !over && turn === 0);
      $("nk-amog").classList.toggle("active", !over && turn === 1);
      $("nk-status").textContent = over ? $("nk-ot").textContent + " " + $("nk-op").textContent
        : turn === 0 ? "Your move." + (misere() ? " (Misère: don't take the last one.)" : "") : "Amog is thinking…";
      const mathEl = $("nk-math");
      if (hint && !over) {
        const p = cfg.isP(s, turn, opts);
        const tail = turn === 0 && !p ? " Moves that win are outlined in green." : "";
        mathEl.innerHTML = cfg.math(s, turn, opts) + (cfg.verdict
          ? `<div class="verdict ${p ? "p" : "n"}">${cfg.verdict(s, turn, opts)}${tail}</div>`
          : `<div class="verdict ${p ? "p" : "n"}">${p ? "P-position: whoever moves now loses with perfect play." : "N-position: whoever moves now can win."}${tail}</div>`);
        if (window.amogMath) window.amogMath(mathEl);
      } else mathEl.innerHTML = "";
      $("nk-log").innerHTML = log.slice(0, 30).map(l => `<li class="${l.who ? "amog" : "you"}">${l.who ? "Amog" : "You"}: ${esc(l.text)}</li>`).join("");
    }

    newGame();
  }

  // ---- annotations ----
  const COLORS = [["c", "var(--g1)", "#4fd6e8"], ["r", "var(--g2)", "#ff5d6c"], ["l", "var(--g3)", "#b6f26b"], ["w", "var(--ink)", "#ece8de"]];
  function Ink(cfg, K, stage, board, canvas, bar, getS) {
    let mode = "play", color = store.get(K + ".inkColor", "c"), hidden = false, sel = null, sheet, key, hist = [];
    const notesOn = !!cfg.notes;
    const load = () => {
      const k = K + ".ink." + (cfg.inkKey ? cfg.inkKey(getS()) : "0");
      if (k === key) return;
      key = k; hist = []; sel = null;
      sheet = store.get(key, null) || { strokes: [], notes: {} };
    };
    const save = () => store.set(key, sheet);
    const snap = () => { hist.push(JSON.stringify(sheet)); if (hist.length > 80) hist.shift(); };
    const anchor = () => board.querySelector("[data-ink-anchor]") || board;
    // board-relative frame: origin at the anchor's top-left, unit = anchor width
    const frame = () => {
      const a = anchor().getBoundingClientRect(), b = stage.getBoundingClientRect();
      return { x0: a.left - b.left, y0: a.top - b.top, u: a.width || 1, cx: b.left, cy: b.top };
    };

    bar.innerHTML = `<div class="seg nk-mode">
        <button data-m="play" title="play moves">play</button>
        <button data-m="pen" title="draw on the board">✎ pen</button>
        ${notesOn ? `<button data-m="label" title="tap a square and type"># label</button>` : ""}
        <button data-m="erase" title="rub out strokes">erase</button></div>
      <div class="nk-colors">${COLORS.map(([k, v]) => `<button data-c="${k}" style="--c:${v}" aria-label="colour"></button>`).join("")}</div>
      <div class="nk-acts"><button class="nk-tb" data-a="undo">undo</button><button class="nk-tb" data-a="hide">hide</button><button class="nk-tb" data-a="clear">clear</button></div>
      <div class="nk-pad">${"1234567890".split("").map(d => `<button class="nk-tb" data-k="${d}">${d}</button>`).join("")}<button class="nk-tb" data-k="Backspace">⌫</button><button class="nk-tb" data-k="Delete">✕</button></div>`;

    function sync() {
      bar.querySelectorAll("[data-m]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === mode)));
      bar.querySelectorAll("[data-c]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.c === color)));
      bar.querySelector('[data-a="hide"]').textContent = hidden ? "show" : "hide";
      bar.dataset.mode = mode;
      stage.dataset.mode = mode;
      stage.classList.toggle("ink-hidden", hidden);
      if (mode !== "label") sel = null;
    }
    bar.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.m) { mode = b.dataset.m; if (mode !== "play") hidden = false; }
      else if (b.dataset.c) { color = b.dataset.c; store.set(K + ".inkColor", color); if (mode === "play" || mode === "erase") mode = "pen"; }
      else if (b.dataset.a === "undo") { if (hist.length) { sheet = JSON.parse(hist.pop()); save(); } }
      else if (b.dataset.a === "hide") hidden = !hidden;
      else if (b.dataset.a === "clear") { if (sheet.strokes.length || Object.keys(sheet.notes).length) { snap(); sheet = { strokes: [], notes: {} }; save(); } }
      else if (b.dataset.k) return key_(b.dataset.k);
      sync(); render();
    });

    // ---- pen and eraser ----
    let cur = null;
    const pt = e => { const f = frame(); return [+((e.clientX - f.cx - f.x0) / f.u).toFixed(4), +((e.clientY - f.cy - f.y0) / f.u).toFixed(4)]; };
    function rub(p) {
      const r = 0.025, n = sheet.strokes.length;
      const keep = sheet.strokes.filter(st => !st.p.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r));
      if (keep.length !== n) { if (!cur.rubbed) { snap(); cur.rubbed = true; } sheet.strokes = keep; draw(); }
    }
    canvas.addEventListener("pointerdown", e => {
      if (mode !== "pen" && mode !== "erase") return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      if (mode === "pen") { snap(); cur = { c: color, p: [pt(e)] }; sheet.strokes.push(cur); draw(); }
      else { cur = { erase: true }; rub(pt(e)); }
    });
    canvas.addEventListener("pointermove", e => {
      if (!cur) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) { if (cur.erase) rub(pt(ev)); else cur.p.push(pt(ev)); }
      if (!cur.erase) draw();
    });
    const end = () => { if (!cur) return; if (!cur.erase && cur.p.length === 1) cur.p.push([cur.p[0][0] + 0.0005, cur.p[0][1]]); cur = null; save(); draw(); };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    function draw() {
      const dpr = window.devicePixelRatio || 1, w = stage.clientWidth, h = stage.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (hidden) return;
      const f = frame(), ox = f.x0, oy = f.y0;
      g.lineCap = g.lineJoin = "round";
      g.lineWidth = Math.max(2, f.u * 0.006);
      for (const st of sheet.strokes) {
        g.strokeStyle = (COLORS.find(c => c[0] === st.c) || COLORS[0])[2];
        g.beginPath();
        st.p.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, ox + x * f.u, oy + y * f.u));
        g.stroke();
      }
    }
    new ResizeObserver(() => draw()).observe(stage);

    // ---- typed labels on [data-note] cells ----
    stage.addEventListener("click", e => {
      if (mode !== "label" || !board.contains(e.target)) return;
      e.stopPropagation(); e.preventDefault();
      const c = e.target.closest("[data-note]");
      sel = c ? c.dataset.note : null;
      render();
    }, true);
    function move(dir) {
      const cells = [...board.querySelectorAll("[data-note]")], at = cells.find(c => c.dataset.note === sel);
      if (!at) return;
      const r = at.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let best = null, bd = Infinity;
      for (const c of cells) {
        if (c === at) continue;
        const q = c.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
        const along = { ArrowLeft: -dx, ArrowRight: dx, ArrowUp: -dy, ArrowDown: dy }[dir], across = dir === "ArrowLeft" || dir === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
        if (along <= 1) continue;
        const d = along + across * 3;
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { sel = best.dataset.note; render(); }
    }
    function key_(k) {
      if (mode !== "label" || sel == null) return false;
      if (k.startsWith("Arrow")) { move(k); return true; }
      if (k === "Escape" || k === "Enter") { sel = null; render(); return true; }
      const old = sheet.notes[sel] || "";
      let nu = old;
      if (k === "Backspace") nu = old.slice(0, -1);
      else if (k === "Delete") nu = "";
      else if (/^[0-9a-zA-Z*+?\-]$/.test(k)) nu = (old + k).slice(-4);
      else return false;
      if (nu !== old) { snap(); if (nu) sheet.notes[sel] = nu; else delete sheet.notes[sel]; save(); render(); }
      return true;
    }
    document.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
      if (key_(e.key)) e.preventDefault();
    });

    function render() {
      load();
      sync();
      board.querySelectorAll("[data-note]").forEach(c => {
        const t = sheet.notes[c.dataset.note];
        c.querySelector(".nk-note")?.remove();
        if (t && !hidden) { const n = document.createElement("span"); n.className = "nk-note"; n.textContent = t; c.appendChild(n); }
        c.classList.toggle("nk-sel", c.dataset.note === sel);
      });
      draw();
    }
    sync();
    return { render };
  }

  // "1 3, 5 7" -> [1, 3, 5, 7]; null if there's anything but numbers and separators
  const nums = t => (/^[\d\s,;·.\-]*$/.test(t) ? (t.match(/\d+/g) || []).map(Number) : null);

  window.NimKit = { start, pick, nums };
})();
