/* CGT playground engine (amog.fun/cgt): short partizan games under normal play. Pure: runs in the page, in a Web
 * Worker ("think harder", cgt-worker.js) and in Node (tools/cgt/cgt.test.mjs).
 *
 * Games are interned nodes: id -> sorted Left and Right option ids, so equal option sets share an id. Everything is
 * memoised across calls: leq(g, h) ("g ≤ h": no g^L ≥ h and no h^R ≤ g), neg, sums (addC keeps every partial sum in
 * canonical form), and canon (remove dominated options, bypass reversible ones, repeat). Canonical forms are unique,
 * so two games are equal exactly when their canonical ids match.
 * Work is counted in steps; budget(steps, ms) caps the next computation, which throws ABORT when it runs out. Results
 * finished before that stay memoised, so a later, bigger budget picks up where the last one stopped.
 * Expressions (parse): numbers (3, -1/2, 0.75: dyadic only), *, *3, ^ (↑), ^^ (⇑), v (↓), ±x, x* (x + *), {a, b | c},
 * {0||0|-1} (more bars bind looser), + and -, parentheses, names from the library, nim(n), dom(rows, cols).
 * parse returns the terms of the sum (see below); sum() adds them up. */
(function (root) {
  "use strict";
  const ABORT = { abort: true };
  const err = m => { throw new Error(m); };

  // ---------- nodes ----------
  const Ls = [], Rs = [], index = new Map();
  let steps = 0, limit = Infinity, deadline = Infinity;
  function tick() {
    if (++steps > limit) throw ABORT;
    if ((steps & 0x3fff) === 0 && Date.now() > deadline) throw ABORT;
  }
  function budget(n = Infinity, ms = 0) { steps = 0; limit = n; deadline = ms ? Date.now() + ms : Infinity; }
  const uniq = xs => [...new Set(xs)].sort((a, b) => a - b);
  function make(L, R) {
    const l = uniq(L), r = uniq(R), key = l.join(",") + "|" + r.join(",");
    let id = index.get(key);
    if (id === undefined) { id = Ls.length; Ls.push(l); Rs.push(r); index.set(key, id); }
    return id;
  }
  const ZERO = make([], []);
  const K = 4194304, pair = (g, h) => g * K + h; // ids stay far below 4M here

  const negMemo = new Map();
  function neg(g) {
    let n = negMemo.get(g);
    if (n === undefined) { tick(); n = make(Rs[g].map(neg), Ls[g].map(neg)); negMemo.set(g, n); negMemo.set(n, g); }
    return n;
  }
  const leqMemo = new Map();
  function leq(g, h) {
    if (g === h) return true;
    const k = pair(g, h), m = leqMemo.get(k);
    if (m !== undefined) return m;
    tick();
    let r = true;
    for (const gl of Ls[g]) if (leq(h, gl)) { r = false; break; }
    if (r) for (const hr of Rs[h]) if (leq(hr, g)) { r = false; break; }
    leqMemo.set(k, r);
    return r;
  }
  // keep the options nobody beats: the largest for Left, the smallest for Right
  const best = (xs, better) => { xs = uniq(xs); return xs.filter((a, i) => !xs.some((b, j) => j !== i && better(a, b) && (!better(b, a) || j < i))); };
  const canonMemo = new Map();
  function canon(g) {
    let c = canonMemo.get(g);
    if (c !== undefined) return c;
    tick();
    let L = Ls[g].map(canon), R = Rs[g].map(canon);
    for (;;) {
      L = best(L, (a, b) => leq(a, b)); R = best(R, (a, b) => leq(b, a));
      const cur = make(L, R);
      let changed = false;
      // a Left option A reverses through some A^R ≤ G: replace A by A^R's Left options (dually for Right)
      const L2 = [], R2 = [];
      for (const a of L) { const ar = Rs[a].find(x => leq(x, cur)); if (ar !== undefined) { L2.push(...Ls[ar]); changed = true; } else L2.push(a); }
      for (const b of R) { const bl = Ls[b].find(x => leq(cur, x)); if (bl !== undefined) { R2.push(...Rs[bl]); changed = true; } else R2.push(b); }
      if (!changed) { c = cur; break; }
      L = L2; R = R2;
    }
    canonMemo.set(g, c); canonMemo.set(c, c);
    return c;
  }
  // the sum, in canonical form (every partial sum is canonicalised, which keeps things small)
  const addMemo = new Map();
  function addC(g, h) {
    g = canon(g); h = canon(h);
    if (g === ZERO) return h;
    if (h === ZERO) return g;
    if (g > h) [g, h] = [h, g];
    const k = pair(g, h);
    let s = addMemo.get(k);
    if (s !== undefined) return s;
    tick();
    s = canon(make([...Ls[g].map(x => addC(x, h)), ...Ls[h].map(y => addC(g, y))], [...Rs[g].map(x => addC(x, h)), ...Rs[h].map(y => addC(g, y))]));
    addMemo.set(k, s);
    return s;
  }
  // the sum as a game tree, options and all (for playing; not simplified)
  const rawMemo = new Map();
  function addRaw(g, h) {
    if (g === ZERO) return h;
    if (h === ZERO) return g;
    if (g > h) [g, h] = [h, g];
    const k = pair(g, h);
    let s = rawMemo.get(k);
    if (s !== undefined) return s;
    tick();
    s = make([...Ls[g].map(x => addRaw(x, h)), ...Ls[h].map(y => addRaw(g, y))], [...Rs[g].map(x => addRaw(x, h)), ...Rs[h].map(y => addRaw(g, y))]);
    rawMemo.set(k, s);
    return s;
  }

  // ---------- outcomes and comparison (on any game; canonical forms make them faster) ----------
  // positive: Left wins whoever starts; negative: Right does; zero: the second player; fuzzy: the first player
  function outcome(g) {
    const ge = leq(ZERO, g), le = leq(g, ZERO);
    return ge && le ? "zero" : ge ? "positive" : le ? "negative" : "fuzzy";
  }
  // a vs b, by the sign of a − b: ">" "<" "=" or "∥" (confused)
  function compare(a, b) {
    const ab = leq(a, b), ba = leq(b, a);
    return ab && ba ? "=" : ab ? "<" : ba ? ">" : "∥";
  }

  // ---------- well-known values ----------
  const numMemo = new Map();
  function number(x) { // x a dyadic rational
    if (numMemo.has(x)) return numMemo.get(x);
    let g;
    if (x === 0) g = ZERO;
    else if (Number.isInteger(x)) g = x > 0 ? make([number(x - 1)], []) : make([], [number(x + 1)]);
    else { let d = 1; while (!Number.isInteger(x * d)) { d *= 2; if (d > 2 ** 40) err("only dyadic numbers (denominator a power of 2) are short games"); } g = make([number((x * d - 1) / d)], [number((x * d + 1) / d)]); }
    numMemo.set(x, g);
    return g;
  }
  const nimMemo = [ZERO];
  function nimber(n) {
    if (n > 64) err("nimbers go up to *64 here");
    while (nimMemo.length <= n) { const opts = nimMemo.slice(); nimMemo.push(make(opts, opts)); }
    return nimMemo[n];
  }
  const STAR = nimber(1), UP = make([ZERO], [STAR]), DOWN = neg(UP);
  // Domineering on an r×c board: Left places vertical dominoes, Right horizontal ones
  function dom(r, c) {
    if (!(r >= 1 && c >= 1 && r * c <= 16)) err("dom(rows, cols) goes up to 16 squares");
    const memo = new Map();
    const go = mask => {
      let id = memo.get(mask);
      if (id !== undefined) return id;
      const L = [], R = [];
      for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
        const a = i * c + j;
        if (mask & (1 << a)) continue;
        if (i + 1 < r && !(mask & (1 << (a + c)))) L.push(go(mask | (1 << a) | (1 << (a + c))));
        if (j + 1 < c && !(mask & (1 << (a + 1)))) R.push(go(mask | (1 << a) | (1 << (a + 1))));
      }
      id = make(L, R); memo.set(mask, id);
      return id;
    };
    return go(0);
  }

  // ---------- names for canonical forms ----------
  const valMemo = new Map();
  function numVal(g) { // the number a canonical g is, or null
    if (valMemo.has(g)) return valMemo.get(g);
    const L = Ls[g], R = Rs[g];
    let v = null;
    if (!L.length && !R.length) v = 0;
    else if (L.length === 1 && !R.length) { const a = numVal(L[0]); if (a !== null && Number.isInteger(a) && a >= 0) v = a + 1; }
    else if (!L.length && R.length === 1) { const b = numVal(R[0]); if (b !== null && Number.isInteger(b) && b <= 0) v = b - 1; }
    else if (L.length === 1 && R.length === 1) { const a = numVal(L[0]), b = numVal(R[0]); if (a !== null && b !== null && a < b) v = (a + b) / 2; }
    valMemo.set(g, v);
    return v;
  }
  const nimInfoMemo = new Map();
  function nimInfo(g) { // [x, n] when a canonical g is the number x plus *n
    if (nimInfoMemo.has(g)) return nimInfoMemo.get(g);
    let r = null;
    const v = numVal(g);
    if (v !== null) r = [v, 0];
    else if (Ls[g].length && Ls[g].join() === Rs[g].join()) {
      const parts = Ls[g].map(nimInfo);
      if (parts.every(p => p && p[0] === parts[0][0])) {
        const ks = parts.map(p => p[1]).sort((a, b) => a - b);
        if (ks.every((k, i) => k === i)) r = [parts[0][0], ks.length];
      }
    }
    nimInfoMemo.set(g, r);
    return r;
  }
  function fmtNum(x) {
    if (Number.isInteger(x)) return String(x);
    let d = 1; while (!Number.isInteger(x * d)) d *= 2;
    return `${x * d}/${d}`;
  }
  const nimName = n => (n === 0 ? "" : n === 1 ? "*" : `*${n}`);
  let ups = null; // canonical id -> name, for k·↑ and k·↑ + * (|k| ≤ 4)
  function upNames() {
    if (ups) return ups;
    const m = new Map(), save = [steps, limit, deadline];
    budget();
    let u = ZERO, d = ZERO;
    const nm = ["", "↑", "⇑", "3·↑", "4·↑"], dn = ["", "↓", "⇓", "3·↓", "4·↓"];
    for (let k = 1; k <= 4; k++) {
      u = addC(u, UP); d = addC(d, DOWN);
      m.set(u, nm[k]); m.set(d, dn[k]); m.set(addC(u, STAR), nm[k] + "*"); m.set(addC(d, STAR), dn[k] + "*");
    }
    [steps, limit, deadline] = save;
    return (ups = m);
  }
  // a short name for a canonical game: numbers, x*n, ↑ multiples, ±x, otherwise {L | R} (nested, cut off when deep)
  function show(g, depth = 0) {
    const ni = nimInfo(g);
    if (ni) return ni[0] === 0 && ni[1] ? nimName(ni[1]) : fmtNum(ni[0]) + nimName(ni[1]);
    const u = upNames().get(g);
    if (u) return u;
    const L = Ls[g], R = Rs[g];
    if (L.length === 1 && R.length === 1) {
      const a = numVal(L[0]), b = numVal(R[0]);
      if (a !== null && b !== null && a === -b && a > 0) return "±" + fmtNum(a);
    }
    // tiny(x) = {0 || 0 | -x} and miny(x) = {x | 0 || 0}, for numbers x > 0
    if (L.length === 1 && R.length === 1 && L[0] === ZERO && Ls[R[0]].length === 1 && Ls[R[0]][0] === ZERO && Rs[R[0]].length === 1) {
      const x = numVal(Rs[R[0]][0]); if (x !== null && x < 0) return `tiny(${fmtNum(-x)})`;
    }
    if (L.length === 1 && R.length === 1 && R[0] === ZERO && Rs[L[0]].length === 1 && Rs[L[0]][0] === ZERO && Ls[L[0]].length === 1) {
      const x = numVal(Ls[L[0]][0]); if (x !== null && x > 0) return `miny(${fmtNum(x)})`;
    }
    if (depth >= 3) return "…";
    // a side that is one unnamed game drops its braces and the bars grow instead: {0 || 0 | -2}
    const side = xs => {
      const strs = xs.map(x => show(x, depth + 1));
      if (strs.length === 1 && /^\{.*\}$/.test(strs[0])) { const inner = strs[0].slice(1, -1); return [inner, Math.max(...(inner.match(/\|+/g) || [""]).map(b => b.length))]; }
      return [strs.join(", "), 0];
    };
    const [l, lb] = side(L), [r, rb] = side(R), bar = "|".repeat(Math.max(lb, rb) + 1);
    return `{${l}${l ? " " : ""}${bar}${r ? " " : ""}${r}}`;
  }

  // ---------- expressions ----------
  // An expression is a sum, and parse returns its terms: a list of game ids (each negated as needed). Sums of real
  // games are never built as trees (dom(4,4) + dom(4,4) would be enormous): the playground plays the terms side by
  // side, and sum() adds them in canonical form. An option inside braces must be one game, so its terms are added
  // there and then (canonically, under whatever budget is running). env: name -> list of terms.
  function parse(text, env = {}) {
    const s = String(text).replace(/\s+/g, " ").trim().replace(/−/g, "-").replace(/↑/g, "^").replace(/⇑/g, "^^").replace(/↓/g, "v").replace(/⇓/g, "vv");
    if (!s) err("type a game, like {0 | *} or up + star");
    if (s.length > 400) err("that's too long");
    let i = 0;
    const ws = () => { while (s[i] === " ") i++; };
    const peek = () => (ws(), s[i]);
    const expr = () => {
      let gs = term();
      for (;;) {
        const c = peek();
        if (c === "+") { i++; gs = gs.concat(term()); }
        else if (c === "-") { i++; gs = gs.concat(term().map(neg)); }
        else return gs;
      }
    };
    const term = () => (peek() === "-" ? (i++, term().map(neg)) : postfix());
    const postfix = () => {
      let gs = atom();
      // x* or x*3 right after something means "plus a nimber"
      while (peek() === "*") { i++; const m = s.slice(i).match(/^\d+/); if (m) i += m[0].length; gs = gs.concat([nimber(m ? +m[0] : 1)]); }
      return gs;
    };
    const intArg = () => { ws(); const m = s.slice(i).match(/^\d+/) || err("expected a whole number"); i += m[0].length; return +m[0]; };
    const atom = () => {
      const c = peek();
      if (c === "(") { i++; const gs = expr(); if (peek() !== ")") err("missing )"); i++; return gs; }
      if (c === "{") return [braces()];
      if (c === "*") { i++; const m = s.slice(i).match(/^\d+/); if (m) i += m[0].length; return [nimber(m ? +m[0] : 1)]; }
      if (c === "^") { let k = 0; while (s[i] === "^") { k++; i++; } return Array(k).fill(UP); }
      if (c === "±") { i++; const g = sum(postfix()); return [make([g], [neg(g)])]; }
      let m = s.slice(i).match(/^(\d+(?:\.\d+)?)(?:\/(\d+))?/);
      if (m) {
        i += m[0].length;
        const x = m[2] ? +m[1] / +m[2] : +m[1];
        if (m[2] && (!Number.isInteger(+m[1]) || (+m[2] & (+m[2] - 1)))) err(`${m[0]} isn't dyadic: the denominator must be a power of 2`);
        return [number(x)];
      }
      m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_']*/);
      if (m) {
        const name = m[0];
        i += name.length;
        if ((name === "nim" || name === "dom") && peek() === "(") {
          i++;
          const a = intArg();
          if (name === "nim") { if (peek() !== ")") err("nim(n) takes one number"); i++; return [nimber(a)]; }
          if (peek() !== ",") err("dom(rows, cols)"); i++;
          const b = intArg();
          if (peek() !== ")") err("missing )"); i++;
          return [dom(a, b)];
        }
        if (/^v+$/.test(name) && name.length <= 4) return Array(name.length).fill(DOWN);
        if (Object.prototype.hasOwnProperty.call(env, name)) return [].concat(env[name]);
        err(`no game called "${name}"`);
      }
      err(c ? `can't read "${s.slice(i, i + 10)}"` : "unfinished expression");
    };
    // {A | B}: the longest run of bars splits Left from Right, and shorter runs inside a side make a game of their own
    const braces = () => {
      i++;
      let depth = 0;
      const start = i;
      for (; i < s.length; i++) {
        const ch = s[i];
        if (ch === "{" || ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "}") { if (!depth) break; depth--; }
      }
      if (s[i] !== "}") err("missing }");
      const inner = s.slice(start, i);
      i++;
      return fromInner(inner, env);
    };
    const gs = expr();
    if (peek() !== undefined) err(`can't read "${s.slice(i, i + 10)}"`);
    return gs;
  }
  // the terms of a sum, added up in canonical form (one term stays as it is, options and all)
  const sum = gs => (Array.isArray(gs) ? (gs.length === 1 ? gs[0] : gs.reduce((a, g) => addC(a, g), ZERO)) : gs);
  function fromInner(inner, env) {
    const bars = []; // [position, run length] of top-level bar runs
    let depth = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "{" || ch === "(") depth++;
      else if (ch === "}" || ch === ")") depth--;
      else if (ch === "|" && !depth) { let n = 1; while (inner[i + n] === "|") n++; bars.push([i, n]); i += n - 1; }
    }
    if (!bars.length) err("a game needs a | between Left's and Right's options");
    const top = Math.max(...bars.map(b => b[1])), at = bars.filter(b => b[1] === top);
    if (at.length > 1) err("ambiguous bars: use braces or a longer run of |");
    const [pos, n] = at[0], left = inner.slice(0, pos), right = inner.slice(pos + n);
    const side = part => {
      const t = part.trim();
      if (!t) return [];
      return hasTopBar(t) ? [fromInner(t, env)] : splitTop(t).map(x => sum(parse(x, env))); // 0|-1 inside {0||0|-1} is one game
    };
    return make(side(left), side(right));
  }
  function hasTopBar(t) {
    let depth = 0;
    for (const ch of t) { if (ch === "{" || ch === "(") depth++; else if (ch === "}" || ch === ")") depth--; else if (ch === "|" && !depth) return true; }
    return false;
  }
  function splitTop(t) {
    const out = []; let depth = 0, cur = "";
    for (const ch of t) {
      if (ch === "{" || ch === "(") depth++;
      if (ch === "}" || ch === ")") depth--;
      if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    if (out.some(x => !x.trim())) err("an empty option");
    return out;
  }

  // ---------- quick or patient analysis ----------
  // run f with a budget; null if it ran out
  function tryWith(f, n, ms) {
    budget(n, ms);
    try { return f(); } catch (e) { if (e === ABORT) return null; throw e; } finally { budget(); }
  }
  // value: {canon, name, outcome} or null (ran out)
  // g: a game id or a list of terms
  const analyse = (g, n = 2e5, ms = 0) => tryWith(() => { const c = canon(sum(g)); return { canon: c, name: show(c), outcome: outcome(c) }; }, n, ms);
  const relate = (a, b, n = 2e5, ms = 0) => tryWith(() => compare(canon(sum(a)), canon(sum(b))), n, ms);
  const L = g => Ls[g], R = g => Rs[g];
  const size = () => Ls.length;

  root.CGT = { ABORT, ZERO, STAR, UP, DOWN, make, neg, leq, canon, addC, addRaw, outcome, compare, number, nimber, dom, numVal, show, parse, sum,
    budget, tryWith, analyse, relate, L, R, size };
})(typeof globalThis !== "undefined" ? globalThis : this);
