/* Mathcraft proof engine (#33). Pure: no DOM, runs in the page and in Node.
 *
 * Terms are arrays: ["0"], ["S", t], ["+", a, b], ["v", "a"]; a statement is ["=", l, r].
 * A path is a list of child indexes (0-based), so [1, 0] in a statement is the first child of the right side.
 *
 * A variable means two different things depending on where it sits:
 *   - in a machine (axiom or proved theorem) it is a SLOT that matches any term;
 *   - on the bench and in a hypothesis it is one fixed unknown number, matching only itself.
 * That difference is the whole soundness story of the induction workshop: inside, 0+a=a is a fact about
 * this a; once the quest is done it becomes a machine with a slot.
 *
 * Machines: { id, name, stmt } is an equality machine, usable in either direction on any subterm.
 *           { id, name, premises: [stmt], concl } is a rule: blocks matching the premises give the conclusion.
 *
 * A proof is a list of steps replayed by `replay`, each aimed at a workshop `at`: "" is the quest itself,
 * "b" / "s" the base and step workshops of its induction, "sb" the base inside the step, and so on.
 *   { op: "refl", at, t }                 new block t = t (t: term or string)
 *   { op: "hyp", at, i }                  copy hypothesis i onto the bench (tagged as depending on it)
 *   { op: "stamp", at, m }                copy a slotless equality machine onto the bench
 *   { op: "rw", at, b, path, m, dir }     rewrite block b at path with machine m ("h0" = hypothesis 0), dir "lr" | "rl"
 *   { op: "rule", at, b, m, others }      apply rule m to block b (+ other blocks); b becomes the conclusion
 *   { op: "induct", at, v }               split the workshop's goal by induction on v
 *   { op: "dup" | "del", at, b }          housekeeping, not counted as steps
 * A workshop is done when a block on its bench equals its goal, or both halves of its induction are done.
 */
(function (root) {
  "use strict";

  const Z = ["0"];
  const S = t => ["S", t];
  const plus = (a, b) => ["+", a, b];
  const V = n => ["v", n];
  const eq = (l, r) => ["=", l, r];
  const isVar = t => t[0] === "v";
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
  /* match pattern against a term; with slots, pattern variables bind (consistently); without, they must be identical */
  function match(pat, t, b, slots) {
    if (isVar(pat)) {
      if (!slots) return isVar(t) && t[1] === pat[1] ? b : null;
      if (Object.prototype.hasOwnProperty.call(b, pat[1])) return same(b[pat[1]], t) ? b : null;
      return { ...b, [pat[1]]: t };
    }
    if (pat[0] !== t[0] || pat.length !== t.length) return null;
    for (let i = 1; i < pat.length && b; i++) b = match(pat[i], t[i], b, slots);
    return b;
  }

  /* ---------- text ---------- */
  function show(t) {
    switch (t[0]) {
      case "0": return "0";
      case "v": return t[1];
      case "S": return "S(" + show(t[1]) + ")";
      case "+": return t.slice(1).map(k => (k[0] === "+" ? "(" + show(k) + ")" : show(k))).join("+");
      case "=": return show(t[1]) + " = " + show(t[2]);
    }
    throw new Error("bad term");
  }
  function parse(src) {
    const s = String(src).replace(/\s+/g, "");
    let i = 0;
    const fail = msg => { throw new Error(msg); };
    function atom() {
      const c = s[i];
      if (c === undefined) fail("that ends too early");
      if (c === "(") { i++; const e = sum(); if (s[i] !== ")") fail("missing )"); i++; return e; }
      if (c === "S") {
        i++;
        if (s[i] !== "(") fail("write S(…) with brackets");
        i++; const e = sum(); if (s[i] !== ")") fail("missing )"); i++;
        return S(e);
      }
      if (/[0-9]/.test(c)) {
        let j = i; while (/[0-9]/.test(s[j] || "")) j++;
        const n = +s.slice(i, j); i = j;
        if (n > 20) fail("numbers above 20 are a lot of S's; build them yourself");
        let t = Z; for (let k = 0; k < n; k++) t = S(t);
        return t;
      }
      if (/[a-z]/.test(c)) { i++; return V(c); }
      fail("I can't read “" + c + "”");
    }
    function sum() { let t = atom(); while (s[i] === "+") { i++; t = plus(t, atom()); } return t; }
    let t = sum();
    if (s[i] === "=") { i++; t = eq(t, sum()); }
    if (i < s.length) fail("I can't read “" + s[i] + "”");
    return t;
  }
  const term = t => (typeof t === "string" ? parse(t) : t);
  const isStmt = t => t[0] === "=";

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
  function ctxAt(game, where) {
    let c = game.root;
    for (const ch of where || "") {
      if (!c.kids) throw new Error("there is no such workshop");
      c = ch === "b" ? c.kids.base : ch === "s" ? c.kids.step : null;
      if (!c) throw new Error("there is no such workshop");
    }
    return c;
  }
  function refresh(c) {
    if (c.kids) { refresh(c.kids.base); refresh(c.kids.step); }
    c.done = c.bench.some(b => same(b.s, c.goal)) || !!(c.kids && c.kids.base.done && c.kids.step.done);
  }
  const union = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x - y);

  /* the equation a machine id stands for in this workshop: { l, r, slots, dep } */
  function equation(game, c, id) {
    const h = /^h(\d+)$/.exec(id);
    if (h) {
      const s = c.hyps[+h[1]];
      if (!s) throw new Error("no such hypothesis");
      return { l: s[1], r: s[2], slots: false, dep: [+h[1]] };
    }
    const m = game.machines.find(x => x.id === id);
    if (!m) throw new Error("you don't have that machine");
    if (!m.stmt) throw new Error(m.name + " is a rule, not an equality");
    return { l: m.stmt[1], r: m.stmt[2], slots: true, dep: [] };
  }

  /* work out what a step does without doing it: returns a function that applies it */
  function plan(game, st) {
    const c = ctxAt(game, st.at);
    const block = i => { const b = c.bench[i]; if (!b) throw new Error("no such block"); return b; };
    switch (st.op) {
      case "refl": {
        const t = term(st.t);
        if (isStmt(t)) throw new Error("give a term, not an equation");
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
      case "rw": {
        const b = block(st.b), e = equation(game, c, st.m);
        if (!st.path || !st.path.length) throw new Error("pick a part of one side");
        const sub = at(b.s, st.path);
        if (!sub) throw new Error("no such part");
        const [from, to] = st.dir === "rl" ? [e.r, e.l] : [e.l, e.r];
        const bind = match(from, sub, {}, e.slots);
        if (!bind) throw new Error("that machine doesn't fit there");
        if (e.slots) for (const v of vars(to)) if (!(v in bind)) throw new Error("that direction needs a term for " + v);
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
        if (!game.machines.some(m => m.id === "induct")) throw new Error("you don't have the induction machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        if (!vars(c.goal).has(st.v)) throw new Error(st.v + " isn't in the goal");
        if (c.hyps.some(h => vars(h).has(st.v))) throw new Error("a hypothesis already says something about " + st.v + ", so it can't vary");
        const v = V(st.v);
        return () => { c.kids = { v: st.v, base: newCtx(subst(c.goal, { [st.v]: Z }), c.hyps), step: newCtx(subst(c.goal, { [st.v]: S(v) }), [...c.hyps, c.goal]) }; };
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
  const COUNTED = new Set(["refl", "hyp", "stamp", "rw", "rule", "induct"]);
  const count = steps => steps.filter(s => COUNTED.has(s.op)).length;

  /* every move available on the selected part of block b: [{ step, result, from, to, name, hyp }] */
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
      const eqs = [...c.hyps.map((h, i) => ({ id: "h" + i, name: "given", stmt: h, hyp: true })), ...game.machines.filter(m => m.stmt)];
      for (const m of eqs) for (const dir of ["lr", "rl"]) {
        const [from, to] = dir === "lr" ? [m.stmt[1], m.stmt[2]] : [m.stmt[2], m.stmt[1]];
        add({ op: "rw", at: where || "", b, path, m: m.id, dir }, { name: m.name, from, to, hyp: !!m.hyp });
      }
    }
    for (const m of game.machines.filter(x => x.premises)) {
      const n = m.premises.length;
      const rest = c.bench.map((_, i) => i).filter(i => i !== b);
      const picks = n === 1 ? [[]] : n === 2 ? rest.map(i => [i]) : [];
      for (const others of picks) add({ op: "rule", at: where || "", b, m: m.id, others }, { name: m.name, rule: m, others });
    }
    // moves that fit anything (a → a+0) go last: they are always there and rarely the one you want
    const loose = o => (o.from && isVar(o.from) && !o.hyp ? 1 : 0);
    return out.sort((x, y) => loose(x) - loose(y));
  }

  /* number of a ground-ish term under an assignment of its variables (tests use this to check every block is true) */
  function value(t, env) {
    switch (t[0]) {
      case "0": return 0;
      case "v": return env[t[1]];
      case "S": return value(t[1], env) + 1;
      case "+": return value(t[1], env) + value(t[2], env);
    }
    throw new Error("not a number");
  }
  const holds = (s, env) => value(s[1], env) === value(s[2], env);

  root.MathcraftLogic = {
    Z, S, plus, V, eq, same, vars, at, put, subst, match, show, parse, term, machine, questMachine,
    start, ctxAt, step, replay, count, options, value, holds,
  };
})(typeof window !== "undefined" ? window : globalThis);
