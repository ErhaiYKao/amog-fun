/* Mathcraft proof engine (#33). Pure: no DOM, runs in the page and in Node.
 *
 * Terms are arrays. Numbers: ["0"], ["S", t], ["+", a, b], ["*", a, b], ["v", "a"] (lowercase letter).
 * Statements: ["=", l, r] between numbers, ["→", A, B] between statements, ["v", "P"] (capital letter).
 * A path is a list of child indexes (0-based), so [1, 0] in an equation is the first child of the right side.
 *
 * A variable means two different things depending on where it sits:
 *   - in a machine (axiom or proved theorem) it is a SLOT that matches any term of its kind;
 *   - on the bench and in a hypothesis it is one fixed unknown number (or statement), matching only itself.
 * That difference is the whole soundness story of the workshops: inside, 0+a=a is a fact about this a; once the
 * quest is done it becomes a machine with a slot.
 *
 * Machines: { id, name, stmt } states a theorem. If it is an equation it rewrites numbers in either direction on
 *             any subterm; any stmt can be put on the bench with its slots filled (`make`).
 *           { id, name, premises: [stmt], concl } is a rule: blocks matching the premises give the conclusion.
 *           { id: "induct" } and { id: "assume" } open workshops.
 *
 * A proof is a list of steps replayed by `replay`, each aimed at a workshop `at`: "" is the quest itself, "b" / "s"
 * the base and step workshops of its induction, "a" the workshop of its assumption, "sb" the base inside the step...
 *   { op: "refl", at, t }                     new block t = t (t: number term or string)
 *   { op: "hyp", at, i }                      copy hypothesis i onto the bench (tagged as depending on it)
 *   { op: "make", at, m, fill }               put machine m's statement on the bench, its slots filled from
 *                                             fill = { a: term, ... } ("stamp" is the old name for the slotless case)
 *   { op: "rw", at, b, path, m, dir, fill }   rewrite block b at path with equality m ("h0" = hypothesis 0),
 *                                             dir "lr" | "rl"; fill gives the slots that direction leaves open
 *                                             (0 → a·0 needs an a)
 *   { op: "rule", at, b, m, others }          apply rule m to block b (+ other blocks); b becomes the conclusion
 *   { op: "induct", at, v }                   split the goal by induction on the number v: workshops for 0 and S(v)
 *   { op: "assume", at }                      for a goal A → B: a workshop that holds A and has goal B
 *   { op: "dup" | "del", at, b }              housekeeping, not counted as steps
 * A workshop is done when a block on its bench equals its goal, or its sub-workshops are all done.
 */
(function (root) {
  "use strict";

  const Z = ["0"];
  const S = t => ["S", t];
  const plus = (a, b) => ["+", a, b];
  const V = n => ["v", n];
  const eq = (l, r) => ["=", l, r];
  const isVar = t => t[0] === "v";
  const upper = n => n >= "A" && n <= "Z";
  /* statements (as opposed to numbers) */
  const isForm = t => t[0] === "=" || t[0] === "→" || (isVar(t) && upper(t[1]));
  const kids = t => (isVar(t) || t[0] === "0" ? [] : t.slice(1));

  function same(a, b) {
    if (a[0] !== b[0]) return false;
    if (isVar(a)) return a[1] === b[1];
    for (let i = 1; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return a.length === b.length;
  }
  function vars(t, out = new Set()) {
    if (isVar(t)) out.add(t[1]); else for (const k of kids(t)) vars(k, out);
    return out;
  }
  function at(t, path) {
    for (const i of path) { t = kids(t)[i]; if (!t) return null; }
    return t;
  }
  function put(t, path, sub) {
    if (!path.length) return sub;
    const c = t.slice();
    c[path[0] + 1] = put(t[path[0] + 1], path.slice(1), sub);
    return c;
  }
  function subst(t, b) {
    if (isVar(t)) return Object.prototype.hasOwnProperty.call(b, t[1]) ? b[t[1]] : t;
    if (t[0] === "0") return t;
    return [t[0], ...kids(t).map(k => subst(k, b))];
  }
  /* match pattern against a term; with slots, pattern variables bind (consistently, numbers to lowercase and
     statements to capitals); without, they must be identical */
  function match(pat, t, b, slots) {
    if (isVar(pat)) {
      if (!slots) return isVar(t) && t[1] === pat[1] ? b : null;
      if (upper(pat[1]) !== isForm(t)) return null;
      if (Object.prototype.hasOwnProperty.call(b, pat[1])) return same(b[pat[1]], t) ? b : null;
      return { ...b, [pat[1]]: t };
    }
    if (pat[0] !== t[0] || pat.length !== t.length) return null;
    for (let i = 1; i < pat.length && b; i++) b = match(pat[i], t[i], b, slots);
    return b;
  }

  /* ---------- text ---------- */
  function show(t) {
    const wrap = (k, ops) => (ops.includes(k[0]) ? "(" + show(k) + ")" : show(k));
    switch (t[0]) {
      case "0": return "0";
      case "v": return t[1];
      case "S": return "S(" + show(t[1]) + ")";
      case "+": return wrap(t[1], "+") + "+" + wrap(t[2], "+");
      case "*": return wrap(t[1], "+*") + "·" + wrap(t[2], "+*");
      case "=": return show(t[1]) + " = " + show(t[2]);
      case "→": return wrap(t[1], "→") + " → " + wrap(t[2], "→");
    }
    throw new Error("bad term");
  }
  function parse(src) {
    const s = String(src).replace(/\s+/g, "").replace(/->|⇒|=>/g, "→").replace(/[·×]/g, "*");
    let i = 0;
    const fail = msg => { throw new Error(msg); };
    const num = (t, what) => { if (isForm(t)) fail(what + " takes numbers, not statements"); return t; };
    function atom() {
      const c = s[i];
      if (c === undefined) fail("that ends too early");
      if (c === "(") { i++; const e = imp(); if (s[i] !== ")") fail("missing )"); i++; return e; }
      if (c === "S") {
        i++;
        if (s[i] !== "(") fail("write S(…) with brackets");
        i++; const e = num(imp(), "S"); if (s[i] !== ")") fail("missing )"); i++;
        return S(e);
      }
      if (/[0-9]/.test(c)) {
        let j = i; while (/[0-9]/.test(s[j] || "")) j++;
        const n = +s.slice(i, j); i = j;
        if (n > 20) fail("numbers above 20 are a lot of S's; build them yourself");
        let t = Z; for (let k = 0; k < n; k++) t = S(t);
        return t;
      }
      if (/[a-zA-Z]/.test(c)) { i++; return V(c); }
      fail("I can't read “" + c + "”");
    }
    function prod() { let t = atom(); while (s[i] === "*") { i++; t = ["*", num(t, "·"), num(atom(), "·")]; } return t; }
    function sum() { let t = prod(); while (s[i] === "+") { i++; t = plus(num(t, "+"), num(prod(), "+")); } return t; }
    function cmp() { const t = sum(); if (s[i] !== "=") return t; i++; return eq(num(t, "="), num(sum(), "=")); }
    function imp() {
      const t = cmp();
      if (s[i] !== "→") return t;
      i++;
      const r = imp();
      if (!isForm(t) || !isForm(r)) fail("→ joins statements, not numbers");
      return ["→", t, r];
    }
    const t = imp();
    if (i < s.length) fail("I can't read “" + s[i] + "”");
    return t;
  }
  const term = t => (typeof t === "string" ? parse(t) : t);

  /* ---------- machines ---------- */
  function machine(def) {
    const m = { id: def.id, name: def.name };
    if (def.premises && def.premises.length) { m.premises = def.premises.map(term); m.concl = term(def.concl || def.stmt); }
    else m.stmt = term(def.stmt || def.concl);
    return m;
  }
  /* the theorem a finished quest turns into */
  const questMachine = q => machine({ id: q.id, name: q.name, premises: q.given || [], concl: q.goal });

  /* ---------- workshops ---------- */
  const newCtx = (goal, hyps) => ({ goal, hyps, bench: [], kids: null, done: false });
  function start(quest, machines) {
    const goal = term(quest.goal), hyps = (quest.given || []).map(term);
    const names = new Set(); [goal, ...hyps].forEach(t => vars(t, names));
    return { quest, machines: machines.slice(), root: newCtx(goal, hyps), names, steps: [] };
  }
  /* the sub-workshops of a split workshop, as [letter, workshop] */
  const subs = c => (!c.kids ? [] : c.kids.assume ? [["a", c.kids.assume]] : [["b", c.kids.base], ["s", c.kids.step]]);
  function ctxAt(game, where) {
    let c = game.root;
    for (const ch of where || "") {
      const hit = subs(c).find(x => x[0] === ch);
      if (!hit) throw new Error("there is no such workshop");
      c = hit[1];
    }
    return c;
  }
  function refresh(c) {
    const ss = subs(c);
    ss.forEach(x => refresh(x[1]));
    c.done = c.bench.some(b => same(b.s, c.goal)) || (ss.length > 0 && ss.every(x => x[1].done));
  }
  const union = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x - y);

  /* what a machine id states in this workshop: { s, slots, dep, name } */
  function statement(game, c, id) {
    const h = /^h(\d+)$/.exec(id);
    if (h) {
      const s = c.hyps[+h[1]];
      if (!s) throw new Error("no such hypothesis");
      return { s, slots: false, dep: [+h[1]], name: "that fact" };
    }
    const m = game.machines.find(x => x.id === id);
    if (!m) throw new Error("you don't have that machine");
    if (!m.stmt) throw new Error(m.name + (m.premises ? " is a rule, not an equality" : " doesn't state anything"));
    return { s: m.stmt, slots: true, dep: [], name: m.name };
  }
  /* ... as an equation { l, r, slots, dep } */
  function equation(game, c, id) {
    const e = statement(game, c, id);
    if (e.s[0] !== "=") throw new Error(e.name + " isn't an equality, so it can't rewrite");
    return { l: e.s[1], r: e.s[2], slots: e.slots, dep: e.dep };
  }
  /* a term the player supplies for slot v: right kind, and only about the numbers and statements in play */
  function supplied(game, v, raw) {
    if (raw == null || raw === "") throw new Error("give a term for " + v);
    const t = term(raw);
    if (upper(v) !== isForm(t)) throw new Error(upper(v) ? v + " stands for a statement" : "give a number for " + v + ", not a statement");
    for (const x of vars(t)) if (!game.names.has(x)) throw new Error("there is nothing called " + x + " here");
    return t;
  }

  /* work out what a step does without doing it: returns a function that applies it */
  function plan(game, st) {
    const c = ctxAt(game, st.at);
    const block = i => { const b = c.bench[i]; if (!b) throw new Error("no such block"); return b; };
    const have = id => game.machines.some(m => m.id === id);
    switch (st.op) {
      case "refl": {
        const t = term(st.t);
        if (isForm(t)) throw new Error("give a term, not an equation");
        for (const v of vars(t)) if (!game.names.has(v)) throw new Error("there is no number called " + v + " here");
        return () => c.bench.push({ s: eq(t, t), deps: [] });
      }
      case "hyp": {
        const s = c.hyps[st.i];
        if (!s) throw new Error("no such hypothesis");
        return () => c.bench.push({ s, deps: [st.i] });
      }
      case "stamp": {
        const e = equation(game, c, st.m);
        if (vars(e.l).size || vars(e.r).size) throw new Error("that machine needs inputs");
        return () => c.bench.push({ s: eq(e.l, e.r), deps: [] });
      }
      case "make": {
        const e = statement(game, c, st.m);
        if (!e.slots) throw new Error("a given fact goes on the bench as it is");
        const fill = {};
        for (const v of vars(e.s)) fill[v] = supplied(game, v, st.fill && st.fill[v]);
        return () => c.bench.push({ s: subst(e.s, fill), deps: [] });
      }
      case "rw": {
        const b = block(st.b), e = equation(game, c, st.m);
        if (!st.path || !st.path.length) throw new Error("pick a part of one side");
        const sub = at(b.s, st.path);
        if (!sub) throw new Error("no such part");
        if (isForm(sub)) throw new Error("equalities rewrite numbers, not whole statements");
        const [from, to] = st.dir === "rl" ? [e.r, e.l] : [e.l, e.r];
        let bind = match(from, sub, {}, e.slots);
        if (!bind) throw new Error("that machine doesn't fit there");
        if (e.slots) for (const v of vars(to)) if (!(v in bind)) {
          if (!st.fill || st.fill[v] == null || st.fill[v] === "") throw new Error("that direction needs a term for " + v);
          bind = { ...bind, [v]: supplied(game, v, st.fill[v]) };
        }
        const s = put(b.s, st.path, e.slots ? subst(to, bind) : to);
        return () => { c.bench[st.b] = { s, deps: union(b.deps, e.dep) }; };
      }
      case "rule": {
        const m = game.machines.find(x => x.id === st.m);
        if (!m || !m.premises) throw new Error("you don't have that rule");
        const idx = [st.b, ...(st.others || [])];
        if (idx.length !== m.premises.length || new Set(idx).size !== idx.length) throw new Error(m.name + " needs " + m.premises.length + " different blocks");
        let bind = {}, deps = [];
        idx.forEach((i, k) => { const b = block(i); bind = bind && match(m.premises[k], b.s, bind, true); deps = union(deps, b.deps); });
        if (!bind) throw new Error("those blocks don't fit " + m.name);
        for (const v of vars(m.concl)) if (!(v in bind)) throw new Error("that rule needs a term for " + v);
        const s = subst(m.concl, bind);
        return () => { c.bench[st.b] = { s, deps }; };
      }
      case "induct": {
        if (!have("induct")) throw new Error("you don't have the induction machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        if (!st.v || upper(st.v)) throw new Error("induction runs over a number: give a small letter");
        if (!vars(c.goal).has(st.v)) throw new Error(st.v + " isn't in the goal");
        if (c.hyps.some(h => vars(h).has(st.v))) throw new Error("a hypothesis already says something about " + st.v + ", so it can't vary");
        const v = V(st.v);
        return () => { c.kids = { v: st.v, base: newCtx(subst(c.goal, { [st.v]: Z }), c.hyps), step: newCtx(subst(c.goal, { [st.v]: S(v) }), [...c.hyps, c.goal]) }; };
      }
      case "assume": {
        if (!have("assume")) throw new Error("you don't have the Assume machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        if (c.goal[0] !== "→") throw new Error("Assume needs a goal of the form A → B");
        return () => { c.kids = { assume: newCtx(c.goal[2], [...c.hyps, c.goal[1]]) }; };
      }
      case "dup": { const b = block(st.b); return () => c.bench.splice(st.b + 1, 0, { s: b.s, deps: b.deps }); }
      case "del": { block(st.b); return () => c.bench.splice(st.b, 1); }
    }
    throw new Error("unknown step");
  }
  function step(game, st) {
    plan(game, st)();
    game.steps.push(st);
    refresh(game.root);
    return game;
  }
  function replay(quest, machines, steps) {
    const g = start(quest, machines);
    for (const st of steps) step(g, st);
    return g;
  }
  const COUNTED = new Set(["refl", "hyp", "stamp", "make", "rw", "rule", "induct", "assume"]);
  const count = steps => steps.filter(s => COUNTED.has(s.op)).length;

  /* every move available on the selection in block b: a part (path non-empty) offers the equality machines that
   * fit there, the whole block (path []) offers the rules. Each is { step, result, name, from, to, hyp, loose } or
   * { step, result, name, rule, others }. `loose` marks rewrites whose pattern is a bare slot (a → a+0): they fit
   * everywhere, so they sort last and the page keeps them behind "more". Directions that leave a slot open
   * (0 → a·0) are not listed: the machine's own interface asks for the missing term. */
  function options(game, where, b, path) {
    const c = ctxAt(game, where), blk = c.bench[b], out = [], seen = new Set();
    if (!blk) return out;
    const add = (st, info) => {
      let apply;
      try { apply = plan(game, st); } catch (e) { return; }
      const keep = c.bench[b]; apply(); const result = c.bench[b].s; c.bench[b] = keep;
      const key = show(result);
      if (same(result, blk.s) || seen.has(key)) return;
      seen.add(key);
      out.push({ step: st, result, ...info });
    };
    if (path && path.length) {
      const sub = at(blk.s, path);
      if (!sub || isForm(sub)) return out;
      const isEq = s => s && s[0] === "=";
      const eqs = [...c.hyps.map((h, i) => ({ id: "h" + i, name: "given", stmt: h, hyp: true })), ...game.machines].filter(m => isEq(m.stmt));
      for (const m of eqs) for (const dir of ["lr", "rl"]) {
        const [from, to] = dir === "lr" ? [m.stmt[1], m.stmt[2]] : [m.stmt[2], m.stmt[1]];
        add({ op: "rw", at: where || "", b, path, m: m.id, dir }, { name: m.name, from, to, hyp: !!m.hyp, loose: !m.hyp && isVar(from) });
      }
    } else for (const m of game.machines.filter(x => x.premises)) {
      const n = m.premises.length;
      const rest = c.bench.map((_, i) => i).filter(i => i !== b);
      const picks = n === 1 ? [[]] : n === 2 ? rest.map(i => [i]) : [];
      for (const others of picks) add({ op: "rule", at: where || "", b, m: m.id, others }, { name: m.name, rule: m, others });
    }
    return out.sort((x, y) => (x.loose ? 1 : 0) - (y.loose ? 1 : 0));
  }
  function paths(t, p = [], out = []) {
    if (p.length) out.push(p);
    kids(t).forEach((k, i) => paths(k, [...p, i], out));
    return out;
  }
  /* where machine m does something on this workshop's bench: [{ b, path }] (path [] for a rule; loose fits left out) */
  function fits(game, where, m) {
    const c = ctxAt(game, where), out = [];
    c.bench.forEach((blk, b) => {
      for (const path of [[], ...paths(blk.s)]) if (options(game, where, b, path).some(o => o.step.m === m && !o.loose)) out.push({ b, path });
    });
    return out;
  }
  /* every workshop of a game, as [{ at, c }], parents before children */
  function shops(game) {
    const out = [];
    (function walk(c, at) { out.push({ at, c }); subs(c).forEach(x => walk(x[1], at + x[0])); })(game.root, "");
    return out;
  }

  /* numbers and truth under an assignment (numbers for small letters, booleans for capitals): the tests use this
     to check that every block is true whenever its workshop's hypotheses are */
  function value(t, env) {
    switch (t[0]) {
      case "0": return 0;
      case "v": return env[t[1]];
      case "S": return value(t[1], env) + 1;
      case "+": return value(t[1], env) + value(t[2], env);
      case "*": return value(t[1], env) * value(t[2], env);
    }
    throw new Error("not a number");
  }
  function holds(s, env) {
    if (s[0] === "=") return value(s[1], env) === value(s[2], env);
    if (s[0] === "→") return !holds(s[1], env) || holds(s[2], env);
    if (isVar(s) && upper(s[1])) return !!env[s[1]];
    throw new Error("not a statement");
  }

  root.MathcraftLogic = {
    Z, S, plus, V, eq, same, vars, at, put, subst, match, show, parse, term, isForm, upper, machine, questMachine,
    start, ctxAt, subs, shops, step, replay, count, options, fits, paths, value, holds,
  };
})(typeof window !== "undefined" ? window : globalThis);
