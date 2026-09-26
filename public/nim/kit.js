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
 *   prefer(move, s, who)    -> true for moves to favour when several are equally good (optional)
 *   verdict(s, who, opts)   -> HTML replacing the P/N-position line in the math panel (optional; partizan games)
 *   custom: { placeholder, help, parse(text, opts) -> state or error string }  (optional: "custom start" box)
 * })
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
    let s, turn, over, gid = 0, timer, log = [], hint = store.get(K + ".hint", false);

    root.innerHTML = `<div class="nk">
      <div class="nk-board-wrap"><div class="nk-board" id="nk-board"></div>
        <div class="nk-over" id="nk-over"><div class="card"><h2 id="nk-ot"></h2><p id="nk-op"></p><button class="btn primary" id="nk-again">Play again</button></div></div></div>
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

    root.querySelectorAll(".seg").forEach(seg => {
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
    $("nk-hintbox").addEventListener("change", e => { hint = e.target.checked; store.set(K + ".hint", hint); render(); });
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
        const ms = favour(cfg.moves(s, 1), 1);
        const wins = favour(cfg.moves(s, 1).filter(m => cfg.isP(cfg.apply(s, m, 1), 0, opts)), 1);
        const m = opts.level === "hard" ? (wins.length ? pick(wins) : pick(ms)) : (wins.length && Math.random() < 0.35 ? pick(wins) : pick(ms));
        doMove(m, 1);
      }, 550 + Math.random() * 250);
    }

    function finish() {
      over = true;
      const winner = misere() ? turn : 1 - turn;
      score[winner]++;
      store.set(K + ".score", score);
      const lastWho = 1 - turn;
      const how = misere() ? `${lastWho === 0 ? "You" : "Amog"} made the last move, which loses in misère play.` : `${lastWho === 0 ? "You" : "Amog"} made the last move.`;
      $("nk-ot").textContent = winner === 0 ? "You win." : "Amog wins.";
      $("nk-op").textContent = how + (winner === 0 ? " The Order will hear of this." : " As the theorem predicted.");
      $("nk-over").classList.add("show");
      render();
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

  // "1 3, 5 7" -> [1, 3, 5, 7]; null if there's anything but numbers and separators
  const nums = t => (/^[\d\s,;·.\-]*$/.test(t) ? (t.match(/\d+/g) || []).map(Number) : null);

  window.NimKit = { start, pick, nums };
})();
