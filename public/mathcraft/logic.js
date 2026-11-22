/* Mathcraft proof engine (#33). Pure: no DOM, runs in the page and in Node.
 *
 * Terms are arrays. Numbers: ["0"], ["S", t], ["+", a, b], ["*", a, b], ["v", "a"] (lowercase letter).
 * Statements: ["=", l, r] between numbers; ["→", A, B], ["∧", A, B], ["∨", A, B] between statements; ["⊥"] (false),
 * ["⊤"] (true); ["v", "P"] (capital letter). "not A" is A → ⊥ and has no node of its own: `show` (and the page)
 * just write A → ⊥ as ¬A, as notation (#33), so ¬(P → ¬Q) is how the definition of P ∧ Q reads.
 * Definitions (#33): A ∨ B is ¬A → B, A ∧ B is ¬(A → ¬B), ⊤ is ⊥ → ⊥ (`unfold`, `folds`). The engine sees through
 * them one way only: wherever a pattern wants an implication (modus ponens, Assume, Apply, any → in a machine), a
 * ∧ / ∨ / ⊤ is read as its definition; a machine about ∨ never matches a plain ¬A → B until it is folded. A goal
 * counts as reached by a block that is the same once both are unfolded (`sameDef`).
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
 *           { id, name, premises: [stmt], concl } is a rule: blocks matching the premises, in order, are used up
 *             and the conclusion takes the first one's place. A proved implication A → (B → C) becomes the rule
 *             A, B gives C (questMachine), and keeps `stmt` so the implication itself can still be made as a block.
 *             A quest's `takes` says how many of its arrows are hypotheses (default: all): Swapping assumptions,
 *             (P → (Q → R)) → (Q → (P → R)), takes 1 and gives Q → (P → R), not R from three blocks.
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
 *   { op: "rule", at, b, m, others, fill }    apply rule m to block b (+ other blocks, in premise order): they are
 *                                             used up and the conclusion replaces b; fill gives slots of the
 *                                             conclusion that the premises don't fix (⊥ gives P, for any P)
 *   { op: "induct", at, v }                   split the goal by induction on the number v: workshops for 0 and S(v)
 *   { op: "assume", at }                      for a goal A → B: a workshop that holds A (already on its bench) with
 *                                             goal B
 *   { op: "apply", at, b | m, fill }          work backwards: block b (or held fact m = "h0") of the form P → goal,
 *                                             used up, leaves the goal P; a rule m whose conclusion fits the goal
 *                                             leaves one workshop per premise ("1", "2", ...); fill = open slots
 *   { op: "have", at, s }                     a lemma mid-proof: workshop "l" with goal s, then "c" with the old goal
 *                                             that holds s
 *   { op: "rwg", at, path, m, dir, fill }     rewrite the goal itself with an equality (the Goal lever upgrade)
 *   { op: "unfold", at, b, path, as }         free: replace a ∧ / ∨ / ⊤ by its definition, or with `as` fold a
 *                                             definition back into that connective
 *   { op: "unfoldg", at, path, as }           free: the same on the goal
 *   { op: "byc", at }                         proof by contradiction: a workshop "x" that holds ¬goal with goal ⊥
 *                                             (Apply Double negation + Assume in one go, so it counts as 2 steps)
 *   { op: "qed", at, b }                      free: block b is the goal, so this workshop is done. Nothing finishes
 *                                             by itself (airetho): the player says when. `withQed` adds these to
 *                                             step lists written before it existed.
 * New workshops start with a copy of the bench they split from (with 0 for v in an induction's base case): those
 * blocks hold for every value of v, since induction refuses a v that a hypothesis mentions.
 *   { op: "dup", at, b }                      a copy of block b next to it (a step: rules use blocks up)
 *   { op: "del", at, b }                      throw block b away, not counted as a step
 * A workshop is done once a qed step closes it, or when its sub-workshops are all done.
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
  const CONNECTIVES = "→∧∨";
  const isForm = t => t[0] === "=" || CONNECTIVES.includes(t[0]) || t[0] === "⊥" || t[0] === "⊤" || (isVar(t) && upper(t[1]));
  const kids = t => (isVar(t) || t[0] === "0" ? [] : t.slice(1));
  /* ¬A, i.e. A → ⊥ */
  const neg = t => t[0] === "→" && t[2][0] === "⊥";

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
    if (pat[0] === "→" && DEFS.includes(t[0])) t = unfold(t);           // a definition is read as what it stands for
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

  /* ---------- definitions ---------- */
  const DEFS = "∧∨⊤", F = ["⊥"], isF = t => t[0] === "⊥";
  function unfold(t) {
    if (t[0] === "∨") return ["→", ["→", t[1], F], t[2]];
    if (t[0] === "∧") return ["→", ["→", t[1], ["→", t[2], F]], F];
    if (t[0] === "⊤") return ["→", F, F];
    return null;
  }
  /* the connectives a statement can be folded back into, as terms (¬¬A is both A ∨ ⊥ and nothing else) */
  function folds(t) {
    const out = [];
    if (t[0] !== "→") return out;
    const [a, b] = [t[1], t[2]];
    if (isF(b) && a[0] === "→" && a[2][0] === "→" && isF(a[2][2])) out.push(["∧", a[1], a[2][1]]);
    if (a[0] === "→" && isF(a[2])) out.push(["∨", a[1], b]);
    if (isF(a) && isF(b)) out.push(["⊤"]);
    return out;
  }
  function expand(t) {
    const u = unfold(t);
    if (u) return expand(u);
    return isVar(t) || t[0] === "0" ? t : [t[0], ...kids(t).map(expand)];
  }
  const sameDef = (a, b) => same(a, b) || same(expand(a), expand(b));

  /* ---------- text ---------- */
  function show(t) {
    const wrap = (k, ops) => (ops.includes(k[0]) && !neg(k) ? "(" + show(k) + ")" : show(k));
    if (neg(t)) return "¬" + wrap(t[1], "=" + CONNECTIVES);
    switch (t[0]) {
      case "0": return "0";
      case "v": return t[1];
      case "S": return "S(" + show(t[1]) + ")";
      case "+": return wrap(t[1], "+") + "+" + wrap(t[2], "+");
      case "*": return wrap(t[1], "+*") + "·" + wrap(t[2], "+*");
      case "=": return show(t[1]) + " = " + show(t[2]);
      case "→": return wrap(t[1], "→") + " → " + wrap(t[2], "→");
      case "∧": return wrap(t[1], CONNECTIVES) + " ∧ " + wrap(t[2], CONNECTIVES);
      case "∨": return wrap(t[1], CONNECTIVES) + " ∨ " + wrap(t[2], CONNECTIVES);
      case "⊥": case "⊤": return t[0];
    }
    throw new Error("bad term");
  }
  function parse(src) {
    const s = String(src).replace(/\band\b/gi, "∧").replace(/\bor\b/gi, "∨").replace(/\bnot\b/gi, "¬").replace(/\bfalse\b/gi, "⊥").replace(/\btrue\b/gi, "⊤")
      .replace(/\s+/g, "").replace(/->|⇒|=>/g, "→").replace(/[·×]/g, "*").replace(/&+|\/\\/g, "∧").replace(/\|+|\\\//g, "∨").replace(/[~!]/g, "¬");
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
      if (c === "⊥" || c === "⊤") { i++; return [c]; }
      if (c === "¬") { i++; const e = atom(); if (!isForm(e)) fail("not takes a statement"); return ["→", e, ["⊥"]]; }
      if (/[a-zA-Z]/.test(c)) { i++; return V(c); }
      fail("I can't read “" + c + "”");
    }
    function prod() { let t = atom(); while (s[i] === "*") { i++; t = ["*", num(t, "·"), num(atom(), "·")]; } return t; }
    function sum() { let t = prod(); while (s[i] === "+") { i++; t = plus(num(t, "+"), num(prod(), "+")); } return t; }
    function cmp() { const t = sum(); if (s[i] !== "=") return t; i++; return eq(num(t, "="), num(sum(), "=")); }
    const join = (next, op, word) => function level() {
      let t = next();
      while (s[i] === op) { i++; const r = next(); if (!isForm(t) || !isForm(r)) fail(word + " joins statements, not numbers"); t = [op, t, r]; }
      return t;
    };
    const conj = join(cmp, "∧", "and"), disj = join(conj, "∨", "or");
    function imp() {
      const t = disj();
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
  /* The theorem a finished quest turns into. An implication becomes a rule that takes its hypotheses as blocks and
     gives the consequent (so nothing has to go through modus ponens), and keeps the whole statement as `stmt`. */
  function questMachine(q) {
    const given = (q.given || []).map(term), goal = term(q.goal), premises = given.slice();
    let concl = goal, n = q.takes == null ? Infinity : q.takes;
    while (concl[0] === "→" && n-- > 0) { premises.push(concl[1]); concl = concl[2]; }
    if (!premises.length) return { id: q.id, name: q.name, stmt: goal };
    return { id: q.id, name: q.name, premises, concl, ...(given.length ? {} : { stmt: goal }) };
  }

  /* ---------- workshops ---------- */
  const newCtx = (goal, hyps) => ({ goal, hyps, bench: [], kids: null, done: false, closed: false });
  function start(quest, machines) {
    const goal = term(quest.goal), hyps = (quest.given || []).map(term);
    const names = new Set(); [goal, ...hyps].forEach(t => vars(t, names));
    return { quest, machines: machines.slice(), root: newCtx(goal, hyps), names, steps: [] };
  }
  /* the sub-workshops of a split workshop, as [letter, workshop] */
  const subs = c => (c.kids ? c.kids.list : []);
  const carry = (bench, f = s => s) => bench.map(b => ({ s: f(b.s), deps: b.deps }));
  const child = (goal, hyps, bench) => Object.assign(newCtx(goal, hyps), { bench });
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
    c.done = c.closed || (ss.length > 0 && ss.every(x => x[1].done));
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
    if (m.premises && m.stmt[0] === "=") throw new Error(m.name + " is a rule, not an equality");
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

  /* the definition of a statement part, or with `as` what it folds into */
  function translate(sub, as) {
    if (!sub || !isForm(sub)) throw new Error("only statements have definitions to unfold");
    const to = as ? folds(sub).find(f => f[0] === as) : unfold(sub);
    if (!to) throw new Error(as ? "that isn't the definition of " + as : "only ∧, ∨ and ⊤ unfold");
    return to;
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
      case "rw": case "rwg": {
        const goal = st.op === "rwg";
        if (goal && c.kids) throw new Error("this workshop is already split");
        const b = goal ? { s: c.goal, deps: [] } : block(st.b), e = equation(game, c, st.m);
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
        if (goal) return () => { c.goal = s; };
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
        for (const v of vars(m.concl)) if (!(v in bind)) {
          if (!st.fill || st.fill[v] == null || st.fill[v] === "") throw new Error(m.name + " needs to be told what " + v + " is");
          bind = { ...bind, [v]: supplied(game, v, st.fill[v]) };
        }
        const s = subst(m.concl, bind), used = idx.slice(1);
        return () => { c.bench = c.bench.map((x, i) => (i === st.b ? { s, deps } : x)).filter((x, i) => !used.includes(i)); };
      }
      case "induct": {
        if (!have("induct")) throw new Error("you don't have the induction machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        if (!st.v || upper(st.v)) throw new Error("induction runs over a number: give a small letter");
        if (!vars(c.goal).has(st.v)) throw new Error(st.v + " isn't in the goal");
        if (c.hyps.some(h => vars(h).has(st.v))) throw new Error("a hypothesis already says something about " + st.v + ", so it can't vary");
        const v = V(st.v), zero = s => subst(s, { [st.v]: Z });
        return () => {
          c.kids = { kind: "induct", v: st.v, list: [
            ["b", child(zero(c.goal), c.hyps, carry(c.bench, zero))],
            ["s", child(subst(c.goal, { [st.v]: S(v) }), [...c.hyps, c.goal], carry(c.bench))]] };
        };
      }
      case "assume": {
        if (!have("assume")) throw new Error("you don't have the Assume machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        const g = DEFS.includes(c.goal[0]) ? unfold(c.goal) : c.goal;
        if (g[0] !== "→") throw new Error("Assume needs a goal of the form A → B");
        return () => { c.kids = { kind: "assume", list: [["a", child(g[2], [...c.hyps, g[1]], [...carry(c.bench), { s: g[1], deps: [c.hyps.length] }])]] }; };
      }
      case "apply": {
        if (!have("apply")) throw new Error("you don't have the Apply machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        let goals, used = -1;
        const h = st.m != null && /^h(\d+)$/.exec(st.m);
        if (st.b != null || h) {
          let s;
          if (h) { s = c.hyps[+h[1]]; if (!s) throw new Error("no such hypothesis"); }
          else { s = block(st.b).s; used = st.b; }
          if (DEFS.includes(s[0])) s = unfold(s);
          if (s[0] !== "→") throw new Error("Apply works backwards from a block of the form P → Q");
          if (!sameDef(s[2], c.goal)) throw new Error("that ends in " + show(s[2]) + ", not in the goal");
          goals = [s[1]];
        } else {
          const m = game.machines.find(x => x.id === st.m);
          if (!m || !m.premises) throw new Error("Apply takes a block, a fact you hold, or a rule");
          let bind = match(m.concl, c.goal, {}, true);
          if (!bind) throw new Error(m.name + " doesn't conclude anything shaped like the goal");
          const seen = vars(m.concl);
          for (const p of m.premises) for (const v of vars(p)) if (!seen.has(v) && !(v in bind)) {
            if (!st.fill || st.fill[v] == null || st.fill[v] === "") throw new Error("working backwards, " + m.name + " needs to be told what " + v + " is");
            bind = { ...bind, [v]: supplied(game, v, st.fill[v]) };
          }
          goals = m.premises.map(p => subst(p, bind));
        }
        const rest = c.bench.filter((_, i) => i !== used);
        const f = () => { c.kids = { kind: "apply", list: goals.map((g, k) => [String(k + 1), child(g, c.hyps, carry(rest))]) }; };
        f.goals = goals;
        return f;
      }
      case "have": {
        if (!have("have")) throw new Error("you don't have the Lemma machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        const s = term(st.s);
        if (!isForm(s)) throw new Error("a lemma is a statement, like a+0 = 0+a or P → Q");
        for (const v of vars(s)) if (!game.names.has(v)) throw new Error("there is nothing called " + v + " here");
        return () => {
          c.kids = { kind: "have", list: [["l", child(s, c.hyps, carry(c.bench))],
            ["c", child(c.goal, [...c.hyps, s], [...carry(c.bench), { s, deps: [c.hyps.length] }])]] };
        };
      }
      case "unfold": {
        const b = block(st.b), s = put(b.s, st.path || [], translate(at(b.s, st.path || []), st.as));
        return () => { c.bench[st.b] = { s, deps: b.deps }; };
      }
      case "unfoldg": {
        if (c.kids) throw new Error("this workshop is already split");
        const s = put(c.goal, st.path || [], translate(at(c.goal, st.path || []), st.as));
        return () => { c.goal = s; };
      }
      case "byc": {
        if (!have("byc")) throw new Error("you don't have the Contradiction machine yet");
        if (!have("dne")) throw new Error("proof by contradiction needs Double negation");
        if (c.kids) throw new Error("this workshop is already split");
        const n = ["→", c.goal, F];
        return () => { c.kids = { kind: "byc", list: [["x", child(F, [...c.hyps, n], [...carry(c.bench), { s: n, deps: [c.hyps.length] }])]] }; };
      }
      case "qed": {
        if (c.kids) throw new Error("this workshop is split: finish its parts");
        if (c.closed) throw new Error("this workshop is already done");
        if (!sameDef(block(st.b).s, c.goal)) throw new Error("that block isn't the goal");
        return () => { c.closed = true; };
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
  const COUNTED = new Set(["refl", "hyp", "stamp", "make", "rw", "rule", "induct", "assume", "dup", "apply", "have", "rwg", "byc"]);
  const WEIGHT = { byc: 2 };                                              // a convenience: it is two steps in one
  const count = steps => steps.reduce((n, s) => n + (COUNTED.has(s.op) ? WEIGHT[s.op] || 1 : 0), 0);
  /* close every open workshop that has its goal on the bench (tests, and step lists from before qed) */
  function closeAll(game) {
    for (const { at: w, c } of shops(game)) if (!c.kids && !c.closed) {
      const b = c.bench.findIndex(x => sameDef(x.s, c.goal));
      if (b >= 0) step(game, { op: "qed", at: w, b });
    }
    return game;
  }
  /* a step list with a qed after each step that brings a workshop's goal onto its bench */
  function withQed(quest, machines, steps) {
    const g = closeAll(start(quest, machines));
    for (const st of steps) { if (st.op !== "qed") step(g, st); closeAll(g); }
    return g.steps;
  }

  /* every move available on the selection in block b: a part (path non-empty) offers the equality machines that
   * fit there, the whole block (path []) offers the rules. Each is { step, result, name, from, to, hyp, loose } or
   * { step, result, name, rule, others }. `loose` marks rewrites whose pattern is a bare slot (a → a+0): they fit
   * everywhere, so they sort last and the page keeps them behind "more". A move that leaves a slot open (0 → a·0,
   * ⊥ gives P) comes with `open`: the slots, filled in the step with a guess (guess) the player can change. */
  function guess(game, v) {
    if (game.names.has(v)) return v;
    const pick = [...game.names].sort().find(x => upper(x) === upper(v));
    return pick || (upper(v) ? "⊤" : "0");
  }
  /* the block a step would leave where it acted, without doing it (throws if the step is refused) */
  function preview(game, st) {
    const c = ctxAt(game, st.at), apply = plan(game, st), before = c.bench;
    if (st.op === "rwg" || st.op === "unfoldg") { const g = c.goal; try { apply(); return c.goal; } finally { c.goal = g; } }
    c.bench = before.slice();
    try { apply(); return c.bench[st.op === "rule" ? st.b - st.others.filter(o => o < st.b).length : st.b].s; }
    finally { c.bench = before; }
  }
  /* b = "g" scans the goal instead: translations and rewrites, no rules */
  function options(game, where, b, path) {
    const c = ctxAt(game, where), onGoal = b === "g", blk = onGoal ? (c.kids ? null : { s: c.goal }) : c.bench[b], out = [], seen = new Set();
    if (!blk) return out;
    const add = (st, info, open) => {
      if (open.length) st = { ...st, fill: Object.fromEntries(open.map(v => [v, guess(game, v)])) };
      let result;
      try { result = preview(game, st); } catch (e) { return; }
      const key = show(result);
      if (same(result, blk.s) || seen.has(key)) return;
      seen.add(key);
      out.push({ step: st, result, ...info, ...(open.length ? { open } : {}) });
    };
    const left = (to, from) => [...vars(to)].filter(v => !from.some(f => vars(f).has(v))).sort();
    const node = at(blk.s, path || []);
    if (node && isForm(node)) {
      const to = [unfold(node), ...folds(node)].filter(Boolean);
      for (const t of to) add({ op: onGoal ? "unfoldg" : "unfold", at: where || "", ...(onGoal ? {} : { b }), path: path || [], ...(DEFS.includes(node[0]) ? {} : { as: t[0] }) },
        { name: DEFS.includes(node[0]) ? "unfold the definition" : "fold into " + t[0], from: node, to: t, free: true }, []);
    }
    if (path && path.length) {
      const sub = at(blk.s, path);
      if (!sub || isForm(sub)) return out;
      const isEq = s => s && s[0] === "=";
      const eqs = [...c.hyps.map((h, i) => ({ id: "h" + i, name: "given", stmt: h, hyp: true })), ...game.machines].filter(m => isEq(m.stmt));
      for (const m of eqs) for (const dir of ["lr", "rl"]) {
        const [from, to] = dir === "lr" ? [m.stmt[1], m.stmt[2]] : [m.stmt[2], m.stmt[1]];
        add(onGoal ? { op: "rwg", at: where || "", path, m: m.id, dir } : { op: "rw", at: where || "", b, path, m: m.id, dir }, { name: m.name, from, to, hyp: !!m.hyp, loose: !m.hyp && isVar(from) }, m.hyp ? [] : left(to, [from]));
      }
    } else if (!onGoal) for (const m of game.machines.filter(x => x.premises)) {
      const n = m.premises.length;
      const rest = c.bench.map((_, i) => i).filter(i => i !== b);
      const picks = n === 1 ? [[]] : n === 2 ? rest.map(i => [i]) : n === 3 ? rest.flatMap(i => rest.filter(j => j !== i).map(j => [i, j])) : [];
      for (const others of picks) add({ op: "rule", at: where || "", b, m: m.id, others }, { name: m.name, rule: m, others }, left(m.concl, m.premises));
    }
    return out.sort((x, y) => (x.loose ? 1 : 0) - (y.loose ? 1 : 0));
  }
  /* the ways to work backwards from this workshop's goal: [{ step, goals, name, open?, loose? }]. A rule whose
     conclusion is a bare slot (Double negation, modus ponens) fits any goal: `loose`. */
  function applies(game, where) {
    const c = ctxAt(game, where), out = [];
    if (!c || c.kids || !game.machines.some(m => m.id === "apply")) return out;
    const tryIt = (st, info) => {
      let goals;
      try { goals = plan(game, st).goals; } catch (e) { return; }
      if (goals.length === 1 && sameDef(goals[0], c.goal)) return;          // no progress (Identity backwards)
      out.push({ step: st, goals, ...info });
    };
    c.bench.forEach((blk, b) => tryIt({ op: "apply", at: where, b }, { name: "block " + (b + 1) }));
    for (const m of game.machines.filter(x => x.premises)) {
      const bind = match(m.concl, c.goal, {}, true);
      if (!bind) continue;
      const seen = vars(m.concl), open = [...new Set(m.premises.flatMap(p => [...vars(p)]))].filter(v => !seen.has(v) && !(v in bind)).sort();
      tryIt({ op: "apply", at: where, m: m.id, ...(open.length ? { fill: Object.fromEntries(open.map(v => [v, guess(game, v)])) } : {}) },
        { name: m.name, ...(open.length ? { open } : {}), loose: isVar(m.concl) });
    }
    return out.sort((x, y) => (x.loose ? 1 : 0) - (y.loose ? 1 : 0));
  }
  /* the goals an apply step would leave, without doing it */
  const applyGoals = (game, st) => plan(game, st).goals;
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
    if (s[0] === "∧") return holds(s[1], env) && holds(s[2], env);
    if (s[0] === "∨") return holds(s[1], env) || holds(s[2], env);
    if (s[0] === "⊥") return false;
    if (s[0] === "⊤") return true;
    if (isVar(s) && upper(s[1])) return !!env[s[1]];
    throw new Error("not a statement");
  }

  root.MathcraftLogic = {
    Z, S, plus, V, eq, same, vars, at, put, subst, match, show, parse, term, isForm, upper, neg, machine, questMachine,
    start, ctxAt, subs, shops, step, replay, count, closeAll, withQed, options, preview, guess, applies, applyGoals, unfold, folds, expand, sameDef, fits, paths, value, holds,
  };
})(typeof window !== "undefined" ? window : globalThis);
