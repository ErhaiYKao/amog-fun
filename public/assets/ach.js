/* AmogAch: sitewide achievements, kept in this browser (localStorage `amog.ach.v1` = {u: {id: unlocked ms}, v: [slugs opened], n: {per-game notes}}).
 *
 * Include on any page: <script src="/assets/ach.js" defer></script>. Opening a page counts as visiting its project.
 * A game calls AmogAch.unlock("dab.undergrad") when you earn one (unknown or already-held ids are ignored) and a
 * toast pops up. Typo-proof helpers: AmogAch.score(game, board, value) unlocks every `score` rule it meets.
 *
 * LIST entries: { id: "<game>.<key>", tier, name, desc, math (revealed once unlocked: show the math off),
 *   secret (name and task hidden until unlocked; `hint` shown instead), score: [board, at least] (for score()) }.
 * Tiers are difficulty: lemma 1, proposition 3, theorem 10, conjecture 30 points. Page: amog.fun/achievements.
 * GAMES lists the objects in display order; SLUGS (every path counted for "Open Cover") must match projects.json.
 */
(function () {
  "use strict";
  const KEY = "amog.ach.v1";
  const TIERS = {
    lemma: { name: "Lemma", pts: 1, color: "#c8f04a", note: "a warm-up" },
    prop: { name: "Proposition", pts: 3, color: "#4fd6e8", note: "takes some doing" },
    thm: { name: "Theorem", pts: 10, color: "#ffb347", note: "hard" },
    conj: { name: "Conjecture", pts: 30, color: "#ff5a5f", note: "open problem: may need real devotion" },
  };
  const SLUGS = ["cgt", "coefficient-game", "fermimac", "omegamac", "palinode", "alchemy", "coin-flips", "blog", "dotsandboxes", "nim", "whack-a-moni", "amog-space-program", "axis-order-incremental"];
  const GAMES = [
    ["site", "amog.fun", "/"],
    ["dab", "Dots & Boxes", "/dotsandboxes/"],
    ["nim", "Nim & Friends", "/nim/"],
    ["coef", "Coefficient Game", "/coefficient-game/"],
    ["wam", "Whack-a-Moni", "/whack-a-moni/"],
    ["omega", "Omegamac", "/omegamac/"],
    ["fermi", "Fermimac", "/fermimac/"],
    ["alc", "Alchemy", "/alchemy/"],
    ["asp", "Amog Space Program", "/amog-space-program/"],
    ["pal", "Palinode", "/palinode/"],
  ];
  const NIM = [
    ["classic", "Nim", "Take That", "Bouton (1901): the player to move loses exactly when the heap sizes XOR to $0$."],
    ["fibonacci", "Fibonacci Nim", "Rabbit Season", "The losing piles are the Fibonacci numbers; otherwise take the smallest term of the pile's Zeckendorf representation."],
    ["wythoff", "Wythoff", "Golden Ratio", "The losing squares are $(\\lfloor n\\varphi \\rfloor, \\lfloor n\\varphi^2 \\rfloor)$ and their mirror images."],
    ["kayles", "Kayles", "Bowled Over", "By Sprague–Grundy every run of pins is a Nim heap; Kayles' values are periodic with period $12$ from $n = 71$ on."],
    ["staircase", "Staircase Nim", "Odd One Out", "Only the odd steps count: it's Nim on $c_1, c_3, c_5, \\dots$"],
    ["northcott", "Northcott's Game", "No Retreat", "Each row is a Nim heap the size of the gap between the pieces; backing off is undone by a chase."],
    ["subtraction", "Subtraction games", "Subtract This", "Every subtraction game with a finite set has eventually periodic Grundy values."],
    ["hackenbush", "Hackenbush", "Lumberjack", "Partizan, so no Sprague–Grundy: every stack is a surreal number, and you win when the sum favours you."],
  ];
  const LIST = [
    // the site itself
    { id: "site.tourist", tier: "lemma", name: "Tourist", desc: "Open 5 different objects." },
    { id: "site.cover", tier: "prop", name: "Open Cover", desc: "Open every object in the catalog.", math: "A space is compact if every open cover has a finite subcover. amog.fun is finite, so you only had to try." },
    { id: "site.blog", tier: "lemma", name: "Peer Review", desc: "Read one of Amog's math notes on the blog." },
    { id: "site.latex", tier: "lemma", secret: true, hint: "Some pages aren't in the catalog.", name: "Typeset", desc: "Find the page that documents the site's LaTeX." },
    { id: "site.404", tier: "lemma", secret: true, hint: "Go somewhere that doesn't exist.", name: "Not Full", desc: "Apply a functor that isn't full: find a page that isn't there." },
    { id: "site.ten", tier: "prop", name: "Generating Set", desc: "Unlock 10 achievements." },
    { id: "site.century", tier: "thm", name: "Centurion", desc: "Reach 100 points." },
    { id: "site.qed", tier: "conj", name: "Q.E.D.", desc: "Unlock every lemma, proposition and theorem on the site." },
    // Dots & Boxes
    { id: "dab.undergrad", tier: "lemma", name: "Defended Thesis", desc: "Beat Amog at undergrad level." },
    { id: "dab.postdoc", tier: "prop", name: "Tenure Track", desc: "Beat Amog at postdoc level on a 4×4 board or bigger." },
    { id: "dab.magnussen", tier: "thm", name: "Magnussen's Bound", desc: "Beat Amog at Magnussen level on a 5×5 board or bigger.", math: "The long chain rule: the first player wants (dots + long chains) even. Whoever controls the parity of long chains controls the endgame." },
    { id: "dab.second", tier: "conj", name: "Second Mover Advantage", desc: "Beat Magnussen on 6×6 with Amog moving first." },
    { id: "dab.shutout", tier: "thm", name: "Empty Set", desc: "Win on 4×4 or bigger against postdoc or Magnussen without Amog closing a single box." },
    { id: "dab.decline", tier: "prop", secret: true, hint: "Sometimes the best box is the one you don't take.", name: "All But Two", desc: "Beat postdoc or Magnussen after turning down boxes you could have taken.", math: "The double-cross: take all but the last two boxes of a chain and leave them as a domino, so your opponent has to open the next chain." },
    // Nim & Friends
    { id: "nim.novice", tier: "lemma", name: "Warm-Up", desc: "Beat the novice at any Nim variant." },
    ...NIM.map(([k, g, name, math]) => ({ id: "nim." + k, tier: "prop", name, desc: `Beat Amog at full strength at ${g}, from a dealt start, without “show the math”.`, math })),
    { id: "nim.all", tier: "thm", name: "Nim & Friends", desc: "Beat Amog at full strength at all eight variants.", math: "Sprague–Grundy: every impartial game is a Nim heap in disguise. Hackenbush isn't impartial, which is why it needed Conway." },
    // Coefficient game
    { id: "coef.win", tier: "lemma", name: "Root Access", desc: "Beat Amog at the Coefficient Game." },
    { id: "coef.both", tier: "prop", name: "Both Sides Now", desc: "Over finite rings, beat Amog once wanting a root and once wanting none." },
    { id: "coef.online", tier: "lemma", name: "Pen Pals", desc: "Finish an online game with a friend." },
    // Whack-a-Moni
    { id: "wam.golden", tier: "lemma", name: "Midas Bonk", desc: "Bonk a golden Moni." },
    { id: "wam.1000", tier: "lemma", name: "Bonk", desc: "Score 1,000 in one round.", score: ["round", 1000] },
    { id: "wam.2000", tier: "prop", name: "Restraining Order", desc: "Score 2,000 in one round.", score: ["round", 2000] },
    { id: "wam.3200", tier: "thm", name: "Banana Embargo", desc: "Score 3,200 in one round.", score: ["round", 3200] },
    { id: "wam.4200", tier: "conj", name: "Bonk Supremum", desc: "Score 4,200 in one round.", score: ["round", 4200] },
    { id: "wam.flawless", tier: "conj", name: "Flawless", desc: "A whole round where no Moni escapes, you never miss, and you never touch Megumin or Shiro." },
    { id: "wam.shiro", tier: "prop", secret: true, hint: "Do the thing the rules say not to, thoroughly.", name: "Blank Never Loses", desc: "Bonk every Shiro that shows up in a round (at least 5)." },
    { id: "wam.megumin", tier: "lemma", secret: true, hint: "EXPLOSION!!", name: "Archwizard", desc: "Bonk Megumin 5 times in one round." },
    // Omegamac (built-in presets, 120 s)
    { id: "omega.tour", tier: "lemma", name: "Basis", desc: "Finish a round of every built-in preset." },
    { id: "omega.basic60", tier: "prop", name: "Zetamac Graduate", desc: "Score 60 on Basic at 120 s.", score: ["basic@120", 60] },
    { id: "omega.basic90", tier: "thm", name: "Human Calculator", desc: "Score 90 on Basic at 120 s.", score: ["basic@120", 90] },
    { id: "omega.basic120", tier: "conj", name: "One Per Second", desc: "Score 120 on Basic at 120 s.", score: ["basic@120", 120] },
    { id: "omega.alpha", tier: "prop", name: "Alpha Test", desc: "Score 50 on Alphamac at 120 s.", score: ["alpha@120", 50] },
    { id: "omega.everything", tier: "thm", name: "Theory of Everything", desc: "Score 70 on Everything at 120 s.", score: ["everything@120", 70] },
    { id: "omega.nt", tier: "thm", name: "Number Theorist", desc: "Score 40 on Number theorist at 120 s.", score: ["nt@120", 40] },
    { id: "omega.comb", tier: "thm", name: "Combinatorialist", desc: "Score 40 on Combinatorialist at 120 s.", score: ["comb@120", 40] },
    // Fermimac
    { id: "fermi.feynman", tier: "prop", name: "Order of Magnitude", desc: "Score 15 on Feynman at 120 s.", score: ["feynman@120", 15] },
    { id: "fermi.feynman2", tier: "thm", name: "Surely You're Joking", desc: "Score 30 on Feynman at 120 s.", score: ["feynman@120", 30] },
    { id: "fermi.sharp", tier: "thm", name: "Two Percent", desc: "Score 15 on Sharp at 120 s.", score: ["sharp@120", 15] },
    { id: "fermi.guessr", tier: "prop", name: "Well Travelled", desc: "Score 30,000 in Guessr (any time limit).", score: ["guessr", 30000] },
    { id: "fermi.guessr2", tier: "thm", name: "Fermi's Paradox", desc: "Score 42,000 in Guessr (any time limit).", score: ["guessr", 42000] },
    { id: "fermi.mathguessr", tier: "prop", name: "Ballpark", desc: "Score 35,000 in MathGuessr (any time limit).", score: ["mathguessr", 35000] },
    { id: "fermi.mathguessr2", tier: "thm", name: "Within Epsilon", desc: "Score 45,000 in MathGuessr (any time limit).", score: ["mathguessr", 45000] },
    // Alchemy
    { id: "alc.table", tier: "lemma", name: "Initial Object", desc: "Build a crafting table in the void." },
    { id: "alc.clips", tier: "prop", name: "Paperclip Enthusiast", desc: "Make 1,000 paperclips.", score: ["paperclips", 1000] },
    { id: "alc.clips2", tier: "conj", name: "Universal Paperclips", desc: "Make 100,000 paperclips.", score: ["paperclips", 100000] },
    { id: "alc.nether", tier: "prop", name: "Through the Portal", desc: "Reach the Nether." },
    { id: "alc.nightmare", tier: "thm", name: "Nightmare Mode", desc: "Build the Nightmare arena." },
    { id: "alc.terminal", tier: "thm", name: "Terminal Object", desc: "Craft the Terminal Object.", math: "An object $T$ is terminal when every object has exactly one arrow to $T$." },
    // Amog Space Program
    { id: "asp.orbit", tier: "lemma", name: "Low Earth Orbit", desc: "Reach orbit." },
    { id: "asp.moon", tier: "prop", name: "One Small Step", desc: "Land on the Moon." },
    { id: "asp.voyager", tier: "prop", name: "Escape Velocity", desc: "Leave the Solar System." },
    { id: "asp.andromeda", tier: "thm", name: "Andromeda", desc: "Reach Andromeda." },
    // Palinode
    { id: "pal.end", tier: "prop", name: "Return to Sender", desc: "Reach an ending of Palinode." },
    { id: "pal.all", tier: "thm", name: "Palinode", desc: "Find all five endings." },
  ];
  const BY = Object.fromEntries(LIST.map(a => [a.id, a]));

  // ---------- storage ----------
  function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && typeof d === "object") return { u: d.u || {}, v: d.v || [], n: d.n || {} }; } catch {}
    return { u: {}, v: [], n: {} };
  }
  function store(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }
  const has = id => !!load().u[id];
  const points = (d = load()) => Object.keys(d.u).reduce((n, id) => n + (BY[id] ? TIERS[BY[id].tier].pts : 0), 0);

  // ---------- unlocking ----------
  function unlock(id) {
    const a = BY[id];
    if (!a) return false;
    const d = load();
    if (d.u[id]) return false;
    d.u[id] = Date.now();
    store(d);
    toast(a);
    try { window.dispatchEvent(new CustomEvent("amog-ach", { detail: { id } })); } catch {}
    meta(d);
    return true;
  }
  // the achievements about achievements
  function meta(d) {
    const ids = Object.keys(d.u).filter(id => BY[id]);
    if (ids.length >= 10) unlock("site.ten");
    if (points(d) >= 100) unlock("site.century");
    if (LIST.every(a => a.tier === "conj" || d.u[a.id])) unlock("site.qed");
  }
  // every `score` rule on this board that `value` reaches
  function score(game, board, value) {
    for (const a of LIST) if (a.score && a.id.startsWith(game + ".") && a.score[0] === board && value >= a.score[1]) unlock(a.id);
  }
  // a little scratch space for per-game progress (e.g. which presets you've played); kept under amog.ach.v1
  function note(key, val) {
    const d = load();
    if (val === undefined) return d.n[key];
    d.n[key] = val;
    store(d);
    return val;
  }

  // ---------- toasts ----------
  let tray = null;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toast(a) {
    if (!document.body) return document.addEventListener("DOMContentLoaded", () => toast(a), { once: true });
    if (!tray) {
      const st = document.createElement("style");
      st.textContent = `.ach-tray{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px;width:min(360px,calc(100vw - 32px));pointer-events:none}
.ach-toast{pointer-events:auto;display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:12px;background:#111118f2;border:1px solid var(--c);box-shadow:0 8px 30px #000a,0 0 0 1px #0006;color:#ece8de;text-decoration:none;font-family:"STIX Two Text",Georgia,serif;animation:ach-in .35s ease-out;transition:opacity .4s,transform .4s}
.ach-toast.out{opacity:0;transform:translateY(10px)}
.ach-toast .ach-q{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--c);color:var(--c);font-family:"JetBrains Mono",monospace;font-size:15px}
.ach-toast .ach-k{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.04em;color:var(--c);text-transform:uppercase}
.ach-toast .ach-n{font-size:17px;line-height:1.25}
.ach-toast .ach-d{font-size:13px;color:#9c99a8;line-height:1.3}
@keyframes ach-in{from{opacity:0;transform:translateY(14px)}}`;
      document.head.appendChild(st);
      tray = document.createElement("div");
      tray.className = "ach-tray";
      tray.setAttribute("role", "status");
      tray.setAttribute("aria-live", "polite");
      document.body.appendChild(tray);
    }
    const t = TIERS[a.tier], el = document.createElement("a");
    el.className = "ach-toast no-math";
    el.href = "/achievements/#" + a.id;
    el.style.setProperty("--c", t.color);
    el.innerHTML = `<span class="ach-q">∎</span><span><div class="ach-k">${t.name} unlocked · +${t.pts}</div><div class="ach-n">${esc(a.name)}</div><div class="ach-d">${esc(a.desc)}</div></span>`;
    tray.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 450); }, 5200);
  }

  // ---------- visiting ----------
  function visit() {
    const p = location.pathname, seg = p.split("/")[1] || "";
    if (document.querySelector("meta[name=amog-404]")) unlock("site.404");
    if (seg === "latex") unlock("site.latex");
    if (seg === "blog" && p.split("/").filter(Boolean).length >= 2) unlock("site.blog");
    if (!SLUGS.includes(seg)) return;
    const d = load();
    if (!d.v.includes(seg)) { d.v.push(seg); store(d); }
    if (d.v.length >= 5) unlock("site.tourist");
    if (SLUGS.every(s => d.v.includes(s))) unlock("site.cover");
  }

  window.AmogAch = { TIERS, GAMES, LIST, NIM, SLUGS, unlock, has, score, note, points, load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", visit, { once: true });
  else visit();
})();
