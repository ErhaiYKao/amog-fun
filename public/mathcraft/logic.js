/* Mathcraft proof engine (#33). Pure: no DOM, runs in the page and in Node.
 *
 * Terms are arrays. Numbers: ["0"], ["S", t], ["+", a, b], ["*", a, b], ["^", a, b], ["v", "a"] (lowercase letter),
 * and numerals ["#", k] for k ≥ 1: a numeral is a definition, like ∨ (airetho): 1 is S(0), 2 is S(1). A typed 2 stays
 * a 2 (a·1 = a reads as it should); a pattern S(b) sees through it, a pattern 1 never matches a plain S(0) until
 * it is folded, and folding or unfolding one is a free `unfold` step.
 * Quantifiers (#33): ["∀", ["v", "a"], A] and ["∃", ["v", "a"], A] bind a number; ["@", ["v", "P"], t, …] is a
 * predicate P(t, …) about numbers. ∃a. A is a definition, ¬∀a. ¬A. Statements are the same up to the names of
 * bound variables (`same`), `subst` never captures, and `vars` are the free ones. In a machine a predicate is a
 * slot too: P(a) under a ∀a takes whatever statement about a stands there (`match`).
 * Statements: ["=", l, r] between numbers; ["→", A, B], ["∧", A, B], ["∨", A, B], ["↔", A, B] between statements; ["⊥"] (false),
 * ["⊤"] (true); ["v", "P"] (capital letter). "not A" is A → ⊥ and has no node of its own: `show` (and the page)
 * just write A → ⊥ as ¬A, as notation (#33), so ¬(P → ¬Q) is how the definition of P ∧ Q reads.
 * Definitions (#33): A ∨ B is ¬A → B, A ∧ B is ¬(A → ¬B), ⊤ is ⊥ → ⊥, A ↔ B is (A → B) ∧ (B → A) (`unfold`,
 * `folds`). The engine sees through them one way only: wherever a pattern wants an implication (modus ponens,
 * Assume, Apply, any → in a machine), a ∧ / ∨ / ⊤ / ↔ is read as its definition, and where it wants an ∧ so is a
 * ↔ (the and-machines take it apart and make it); a machine about ∨ never matches a plain ¬A → B until it is
 * folded. A goal counts as reached by a block that is the same once both are unfolded (`sameDef`).
 * A path is a list of child indexes (0-based), so [1, 0] in an equation is the first child of the right side.
 *
 * A variable means two different things depending on where it sits:
 *   - in a machine (axiom or proved theorem) it is a SLOT that matches any term of its kind;
 *   - on the bench and in a hypothesis it is one fixed unknown number (or statement), matching only itself.
 * That difference is the whole soundness story of the workshops: inside, 0+a=a is a fact about this a; once the
 * quest is done it becomes a machine with a slot.
 *
 * Machines: { id, name, stmt } states a theorem. If it is an equation it rewrites numbers in either direction on
 *             any subterm; if it is a biconditional A ↔ B it rewrites statements the same way (a part that reads
 *             A becomes B, anywhere, or the whole block); any stmt can be put on the bench with its slots filled
 *             (`make`).
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
 *   { op: "rw", at, b, path, m, dir, fill }   rewrite block b at path with equality or biconditional m ("h0" =
 *                                             hypothesis 0), dir "lr" | "rl"; fill gives the slots that direction
 *                                             leaves open (0 → a·0 needs an a); path [] (the whole block) only
 *                                             for a biconditional
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
 *                                             (Apply Double negation + Assume in one go; one step, airetho)
 *   { op: "fix", at, v }                      for a goal ∀a. A: a workshop "f" whose goal is A about one fixed, arbitrary
 *                                             number (named v, by default the bound letter, fresh if that is taken)
 *   { op: "spec", at, b, t }                  a block ∀a. A becomes A with the number t for a
 *   { op: "witness", at, t }                  for a goal ∃a. A: a workshop "w" whose goal is A with t for a
 *   { op: "obtain", at, b, v }                a block ∃a. A: a workshop "o" with the same goal that holds A about a
 *                                             number v nothing else is known about (fresh)
 *   { op: "cases", at, b }                    take block b apart: P ∧ Q (or P ↔ Q) becomes two blocks; P ∨ Q splits
 *                                             the workshop in two with the same goal, "p" holding P and "q" Q
 *   { op: "qed", at, b }                      free: block b is the goal, so this workshop is done. Nothing finishes
 *                                             by itself (airetho): the player says when. `withQed` adds these to
 *                                             step lists written before it existed.
 * New workshops start with a copy of the bench they split from (with 0 for v in an induction's base case): those
 * blocks hold for every value of v, since induction refuses a v that a hypothesis mentions.
 *   { op: "dup", at, b }                      a copy of block b next to it (a step: rules use blocks up)
 *   { op: "del", at, b }                      throw block b away, not counted as a step
 * A workshop is done once a qed step closes it, or when its sub-workshops are all done.
 * `follow` finds where a player stands on a reference proof, one workshop at a time (the page's hints).
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
  const CONNECTIVES = "→∧∨↔", QUANT = "∀∃";
  const isForm = t => t[0] === "=" || CONNECTIVES.includes(t[0]) || QUANT.includes(t[0]) || t[0] === "@" || t[0] === "⊥" || t[0] === "⊤" || (isVar(t) && upper(t[1]));
  /* the parts of a term, which is what paths count: a quantifier has one (its body, not the variable it binds), a
     predicate P(a, b) has its arguments (not its name) */
  const off = t => (QUANT.includes(t[0]) || t[0] === "@" ? 2 : 1);
  const kids = t => (isVar(t) || t[0] === "0" || t[0] === "#" ? [] : t.slice(off(t)));
  const rebuild = (t, f) => [...t.slice(0, off(t)), ...kids(t).map(f)];
  /* ¬A, i.e. A → ⊥ */
  const neg = t => t[0] === "→" && t[2][0] === "⊥";
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* the same statement, up to the names of bound variables: ∀a. P(a) is ∀b. P(b) */
  function same(a, b, ea = [], eb = []) {
    if (a[0] !== b[0] || a.length !== b.length) return false;
    if (a[0] === "#") return a[1] === b[1];
    if (isVar(a)) { const i = ea.lastIndexOf(a[1]), j = eb.lastIndexOf(b[1]); return i === j && (i >= 0 || a[1] === b[1]); }
    if (QUANT.includes(a[0])) return same(a[2], b[2], [...ea, a[1][1]], [...eb, b[1][1]]);
    if (a[0] === "@" && a[1][1] !== b[1][1]) return false;
    for (let i = off(a); i < a.length; i++) if (!same(a[i], b[i], ea, eb)) return false;
    return true;
  }
  /* the free variables of a term: letters for numbers, capitals for statements and for predicates (P in P(a)) */
  function vars(t, out = new Set(), bound = []) {
    if (isVar(t)) { if (!bound.includes(t[1])) out.add(t[1]); }
    else if (QUANT.includes(t[0])) vars(t[2], out, [...bound, t[1][1]]);
    else { if (t[0] === "@") out.add(t[1][1]); for (const k of kids(t)) vars(k, out, bound); }
    return out;
  }
  /* the predicates a statement applies, with how many arguments: { P: 1, R: 2 } */
  function preds(t, out = {}) {
    if (t[0] === "@") out[t[1][1]] = t.length - 2;
    for (const k of kids(t)) preds(k, out);
    return out;
  }
  function at(t, path) {
    for (const i of path) { t = kids(t)[i]; if (!t) return null; }
    return t;
  }
  /* the variables bound around the part at path (by the quantifiers on the way down to it) */
  function boundAt(t, path) {
    const out = [];
    for (const i of path) { if (QUANT.includes(t[0])) out.push(t[1][1]); t = kids(t)[i]; if (!t) break; }
    return out;
  }
  function put(t, path, sub) {
    if (!path.length) return sub;
    const c = t.slice(), k = path[0] + off(t);
    c[k] = put(t[k], path.slice(1), sub);
    return c;
  }
  const LETTERS = "abcdefghijklmnopqrstuvwxyz";
  const fresh = (want, taken) => (taken.has(want) ? [...LETTERS].find(x => !taken.has(x)) || want + "'" : want);
  /* Replace free variables: b maps a name to a term, or (for a predicate) to { lam: [names], body } or to another
     predicate's variable. Never captures: a bound variable that would catch something put under it is renamed. */
  function subst(t, b) {
    if (isVar(t)) return own(b, t[1]) && !b[t[1]].lam ? b[t[1]] : t;
    if (t[0] === "0" || t[0] === "#") return t;
    if (QUANT.includes(t[0])) {
      const x = t[1][1], inner = {}, incoming = new Set();
      for (const k of vars(t[2])) if (k !== x && own(b, k)) { inner[k] = b[k]; vars(b[k].lam ? b[k].body : b[k], incoming, b[k].lam || []); }
      if (!Object.keys(inner).length) return t;
      if (!incoming.has(x)) return [t[0], t[1], subst(t[2], inner)];
      const y = fresh(x, new Set([...incoming, ...vars(t[2])]));
      return [t[0], V(y), subst(subst(t[2], { [x]: V(y) }), inner)];
    }
    if (t[0] === "@") {
      const args = t.slice(2).map(k => subst(k, b)), h = own(b, t[1][1]) ? b[t[1][1]] : null;
      if (h && h.lam) return subst(h.body, Object.fromEntries(h.lam.map((x, i) => [x, args[i]])));
      return ["@", h && isVar(h) ? h : t[1], ...args];
    }
    return rebuild(t, k => subst(k, b));
  }
  /* Match a pattern against a term. With slots, the pattern's free variables bind, consistently: letters to numbers,
     capitals to statements, and a predicate P(x) whose arguments are variables the pattern binds takes whatever
     stands there, as a statement about x ({ lam, body }); P(…) elsewhere is then checked against that. Without
     slots (a fact held in a workshop) every variable must be itself. Bound variables match by position, and
     nothing bound in the term may leak into a slot. */
  function match(pat, t, b, slots, ep = [], et = []) {
    if (!b) return null;
    if (pat[0] === "→") while (DEFS.includes(t[0])) t = unfold(t);       // a definition is read as what it stands for
    else if (pat[0] === "∧" && t[0] === "↔") t = unfold(t);
    else if (pat[0] === "S" && t[0] === "#") t = unfold(t);              // S(b) fits 2, with b = 1
    const leaks = x => { for (const v of vars(x)) if (et.includes(v)) return true; return false; };
    if (isVar(pat)) {
      const i = ep.lastIndexOf(pat[1]);
      if (i >= 0) return isVar(t) && et.lastIndexOf(t[1]) === i ? b : null;      // bound in the pattern: the same position
      if (!slots) return isVar(t) && t[1] === pat[1] && !et.includes(t[1]) ? b : null;
      if (upper(pat[1]) !== isForm(t) || leaks(t)) return null;
      if (own(b, pat[1])) return !b[pat[1]].lam && same(b[pat[1]], t) ? b : null;
      return { ...b, [pat[1]]: t };
    }
    if (pat[0] === "@") {
      const P = pat[1][1], args = pat.slice(2);
      if (!slots || ep.includes(P)) {
        if (t[0] !== "@" || t[1][1] !== P || t.length !== pat.length) return null;
        for (let i = 2; i < pat.length && b; i++) b = match(pat[i], t[i], b, slots, ep, et);
        return b;
      }
      if (!isForm(t)) return null;
      const here = args.map(a => (isVar(a) ? ep.lastIndexOf(a[1]) : -1));
      if (own(b, P)) {                                                    // known: put the arguments in and compare
        if (!b[P].lam) return null;
        const ren = {};
        ep.forEach((x, i) => { ren[x] = V(et[i]); });
        const filled = args.map(a => subst(subst(a, ren), b));
        for (const a of args) for (const v of vars(a)) if (!ep.includes(v) && !own(b, v)) return null;
        return same(subst(b[P].body, Object.fromEntries(b[P].lam.map((x, i) => [x, filled[i]]))), t) ? b : null;
      }
      if (here.some(i => i < 0) || new Set(here).size !== here.length) return null;   // P(x, y) with x, y bound and different
      const lam = here.map(i => et[i]);
      for (const v of vars(t)) if (et.includes(v) && !lam.includes(v)) return null;   // something else bound would leak
      return { ...b, [P]: { lam, body: t } };
    }
    if (pat[0] !== t[0] || pat.length !== t.length) return null;
    if (pat[0] === "#") return pat[1] === t[1] ? b : null;
    if (QUANT.includes(pat[0])) return match(pat[2], t[2], b, slots, [...ep, pat[1][1]], [...et, t[1][1]]);
    for (let i = 1; i < pat.length && b; i++) b = match(pat[i], t[i], b, slots, ep, et);
    return b;
  }

  /* ---------- definitions ---------- */
  const DEFS = "∧∨⊤↔∃", F = ["⊥"], isF = t => t[0] === "⊥";
  function unfold(t) {
    if (t[0] === "∃") return ["→", ["∀", t[1], ["→", t[2], F]], F];
    if (t[0] === "#") return S(t[1] > 1 ? ["#", t[1] - 1] : Z);
    if (t[0] === "↔") return ["∧", ["→", t[1], t[2]], ["→", t[2], t[1]]];
    if (t[0] === "∨") return ["→", ["→", t[1], F], t[2]];
    if (t[0] === "∧") return ["→", ["→", t[1], ["→", t[2], F]], F];
    if (t[0] === "⊤") return ["→", F, F];
    return null;
  }
  /* the connectives a statement can be folded back into, as terms (¬¬A is both A ∨ ⊥ and nothing else) */
  function folds(t) {
    const out = [];
    if (t[0] === "S" && (t[1][0] === "0" || (t[1][0] === "#" && t[1][1] < 20))) out.push(["#", t[1][0] === "0" ? 1 : t[1][1] + 1]);
    if (t[0] === "∧" && t[1][0] === "→" && t[2][0] === "→" && same(t[1][1], t[2][2]) && same(t[1][2], t[2][1])) out.push(["↔", t[1][1], t[1][2]]);
    if (t[0] !== "→") return out;
    const [a, b] = [t[1], t[2]];
    if (isF(b) && a[0] === "∀" && neg(a[2])) out.push(["∃", a[1], a[2][1]]);
    if (isF(b) && a[0] === "→" && a[2][0] === "→" && isF(a[2][2])) out.push(["∧", a[1], a[2][1]]);
    if (a[0] === "→" && isF(a[2])) out.push(["∨", a[1], b]);
    if (isF(a) && isF(b)) out.push(["⊤"]);
    return out;
  }
  function expand(t) {
    const u = unfold(t);
    if (u) return expand(u);
    return isVar(t) || t[0] === "0" ? t : rebuild(t, expand);   // numerals unfold all the way to S(…S(0))
  }
  const sameDef = (a, b) => same(a, b) || same(expand(a), expand(b));

  /* ---------- text ---------- */
  function show(t) {
    const wrap = (k, ops) => ((ops.includes(k[0]) && !neg(k)) || (QUANT.includes(k[0]) && ops !== "") ? "(" + show(k) + ")" : show(k));
    if (neg(t)) return "¬" + wrap(t[1], "=" + CONNECTIVES);
    switch (t[0]) {
      case "0": return "0";
      case "#": return String(t[1]);
      case "v": return t[1];
      case "S": return "S(" + show(t[1]) + ")";
      case "+": return wrap(t[1], "+") + "+" + wrap(t[2], "+");
      case "*": return wrap(t[1], "+*") + "·" + wrap(t[2], "+*");
      case "^": return wrap(t[1], "+*^") + "^" + wrap(t[2], "+*^");
      case "=": return show(t[1]) + " = " + show(t[2]);
      case "→": return wrap(t[1], "→↔") + " → " + wrap(t[2], "→↔");
      case "↔": return wrap(t[1], "→↔") + " ↔ " + wrap(t[2], "→↔");
      case "∧": return wrap(t[1], CONNECTIVES) + " ∧ " + wrap(t[2], CONNECTIVES);
      case "∨": return wrap(t[1], CONNECTIVES) + " ∨ " + wrap(t[2], CONNECTIVES);
      case "⊥": case "⊤": return t[0];
      case "∀": case "∃": return t[0] + t[1][1] + ". " + show(t[2]);     // reaches as far right as it can; bracketed inside anything else
      case "@": return t[1][1] + "(" + t.slice(2).map(show).join(", ") + ")";
    }
    throw new Error("bad term");
  }
  function parse(src) {
    const s = String(src).replace(/\b(forall|all|every)\b/gi, "∀").replace(/\b(exists|some)\b/gi, "∃").replace(/<->|<=>|⇔|\biff\b/gi, "↔").replace(/\band\b/gi, "∧").replace(/\bor\b/gi, "∨").replace(/\bnot\b/gi, "¬").replace(/\bfalse\b/gi, "⊥").replace(/\btrue\b/gi, "⊤")
      .replace(/\s+/g, "").replace(/->|⇒|=>/g, "→").replace(/[·×]/g, "*").replace(/&+|\/\\/g, "∧").replace(/\|+|\\\//g, "∨").replace(/[~!]/g, "¬");
    let i = 0;
    const fail = msg => { throw new Error(msg); };
    const num = (t, what) => { if (isForm(t)) fail(what + " takes numbers, not statements"); return t; };
    function atom() {
      const c = s[i];
      if (c === undefined) fail("that ends too early");
      if (c === "(") { i++; const e = iff(); if (s[i] !== ")") fail("missing )"); i++; return e; }
      if (c === "S") {
        i++;
        if (s[i] !== "(") fail("write S(…) with brackets");
        i++; const e = num(iff(), "S"); if (s[i] !== ")") fail("missing )"); i++;
        return S(e);
      }
      if (/[0-9]/.test(c)) {
        let j = i; while (/[0-9]/.test(s[j] || "")) j++;
        const n = +s.slice(i, j); i = j;
        if (n > 20) fail("numbers above 20 are a lot of S's; build them yourself");
        return n ? ["#", n] : Z;
      }
      if (c === "⊥" || c === "⊤") { i++; return [c]; }
      if (c === "¬") { i++; const e = atom(); if (!isForm(e)) fail("not takes a statement"); return ["→", e, ["⊥"]]; }
      if (c === "∀" || c === "∃") {                                       // ∀a. … : everything to the right, up to a closing bracket
        i++;
        const x = s[i];
        if (!x || !/[a-z]/.test(x)) fail(c + " needs a small letter: " + c + "a. …");
        i++;
        if (s[i] === "." || s[i] === "," || s[i] === ":") i++;
        const e = iff();
        if (!isForm(e)) fail(c + x + ". has to be followed by a statement");
        return [c, V(x), e];
      }
      if (/[A-Z]/.test(c) && s[i + 1] === "(") {                          // a predicate: P(a), R(a, b)
        i += 2;
        const args = [num(iff(), "a predicate")];
        while (s[i] === ",") { i++; args.push(num(iff(), "a predicate")); }
        if (s[i] !== ")") fail("missing )");
        i++;
        return ["@", V(c), ...args];
      }
      if (/[a-zA-Z]/.test(c)) { i++; return V(c); }
      fail("I can't read “" + c + "”");
    }
    function pow() { const t = atom(); if (s[i] !== "^") return t; i++; return ["^", num(t, "^"), num(pow(), "^")]; }
    function prod() { let t = pow(); while (s[i] === "*") { i++; t = ["*", num(t, "·"), num(pow(), "·")]; } return t; }
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
    function iff() {
      const t = imp();
      if (s[i] !== "↔") return t;
      i++;
      const r = imp();
      if (!isForm(t) || !isForm(r)) fail("↔ joins statements, not numbers");
      return ["↔", t, r];
    }
    const t = iff();
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
  /* ... as something that rewrites, { l, r, slots, dep, iff }: an equation (numbers) or a biconditional (statements) */
  function equation(game, c, id) {
    const e = statement(game, c, id);
    if (e.s[0] !== "=" && e.s[0] !== "↔") throw new Error(e.name + " isn't an equality or a ↔, so it can't rewrite");
    return { l: e.s[1], r: e.s[2], slots: e.slots, dep: e.dep, iff: e.s[0] === "↔" };
  }
  /* a term the player supplies for slot v: right kind, and only about the numbers and statements in play */
  function supplied(game, v, raw, also = []) {
    if (raw == null || raw === "") throw new Error("give a term for " + v);
    const t = term(raw);
    if (upper(v) !== isForm(t)) throw new Error(upper(v) ? v + " stands for a statement" : "give a number for " + v + ", not a statement");
    for (const x of vars(t)) if (!game.names.has(x) && !also.includes(x)) throw new Error("there is nothing called " + x + " here");
    return t;
  }
  /* ... or, for a slot that stmt uses as a predicate, the name of a predicate in play */
  function suppliedFor(game, stmt, v, raw, also) {
    if (!own(preds(stmt), v)) return supplied(game, v, raw, also);
    const name = String(raw == null ? "" : raw).trim();
    if (!/^[A-Z]$/.test(name) || !game.names.has(name)) throw new Error(v + " is a predicate here: give the letter of one in play");
    return V(name);
  }
  /* the names a workshop speaks about: free in what it holds, in its goal or on its bench */
  function spoken(c) {
    const out = new Set();
    for (const t of [...c.hyps, c.goal, ...c.bench.map(b => b.s)]) vars(t, out);
    return out;
  }
  /* a letter for a new fixed number: the one asked for if this workshop doesn't speak about it, else the first free one */
  const newName = (c, want) => fresh(want && /^[a-z]$/.test(want) ? want : "a", spoken(c));

  /* the definition of a statement part, or with `as` what it folds into */
  function translate(sub, as) {
    if (!sub) throw new Error("no such part");
    const to = as ? folds(sub).find(f => f[0] === as) : unfold(sub);
    if (!to) throw new Error(as ? "that isn't the definition of " + (as === "#" ? "a numeral" : as) : "only ∧, ∨, ↔, ⊤ and numerals unfold");
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
        if (e.iff || vars(e.l).size || vars(e.r).size) throw new Error("that machine needs inputs");
        return () => c.bench.push({ s: eq(e.l, e.r), deps: [] });
      }
      case "make": {
        const e = statement(game, c, st.m);
        if (!e.slots) throw new Error("a given fact goes on the bench as it is");
        const fill = {};
        for (const v of vars(e.s)) fill[v] = suppliedFor(game, e.s, v, st.fill && st.fill[v]);
        return () => c.bench.push({ s: subst(e.s, fill), deps: [] });
      }
      case "rw": case "rwg": {
        const goal = st.op === "rwg";
        if (goal && c.kids) throw new Error("this workshop is already split");
        const b = goal ? { s: c.goal, deps: [] } : block(st.b), e = equation(game, c, st.m);
        if (!e.iff && (!st.path || !st.path.length)) throw new Error("pick a part of one side");
        const sub = at(b.s, st.path || []);
        if (!sub) throw new Error("no such part");
        if (!e.iff && isForm(sub)) throw new Error("equalities rewrite numbers, not whole statements");
        if (e.iff && !isForm(sub)) throw new Error("a ↔ rewrites statements, not numbers");
        const [from, to] = st.dir === "rl" ? [e.r, e.l] : [e.l, e.r];
        // under a ∀a the letter a is the bound one: a fact about some other a doesn't speak about it
        const around = boundAt(b.s, st.path || []);
        if (!e.slots) for (const v of [...vars(e.l), ...vars(e.r)]) if (around.includes(v)) throw new Error("the " + v + " there is bound by a quantifier: it isn't the " + v + " that fact is about");
        let bind = match(from, sub, {}, e.slots);
        if (!bind) throw new Error("that machine doesn't fit there");
        if (e.slots) for (const v of vars(to)) if (!(v in bind)) {
          if (!st.fill || st.fill[v] == null || st.fill[v] === "") throw new Error("that direction needs a term for " + v);
          bind = { ...bind, [v]: suppliedFor(game, to, v, st.fill[v], around) };
        }
        const s = put(b.s, st.path || [], e.slots ? subst(to, bind) : to);
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
          bind = { ...bind, [v]: suppliedFor(game, m.concl, v, st.fill[v]) };
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
        let g = c.goal;
        while (DEFS.includes(g[0])) g = unfold(g);
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
          while (DEFS.includes(s[0])) s = unfold(s);
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
      case "fix": {
        if (!have("fix")) throw new Error("you don't have the Fix machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        if (c.goal[0] !== "∀") throw new Error("Fix needs a goal of the form ∀a. …");
        const v = st.v || newName(c, c.goal[1][1]);
        if (!/^[a-z]$/.test(v)) throw new Error("name the number with a small letter");
        // the fixed number has to be arbitrary: nothing held, and nothing else in the goal, may speak about it
        if (c.hyps.some(h => vars(h).has(v)) || vars(c.goal).has(v)) throw new Error("something here already speaks about " + v + ": pick a letter that is new");
        const goal = subst(c.goal[2], { [c.goal[1][1]]: V(v) });
        return () => { game.names.add(v); c.kids = { kind: "fix", v, list: [["f", child(goal, c.hyps, carry(c.bench))]] }; };
      }
      case "spec": {
        if (!have("spec")) throw new Error("you don't have the Specialise machine yet");
        const b = block(st.b);
        if (b.s[0] !== "∀") throw new Error("Specialise takes a block of the form ∀a. …");
        const s = subst(b.s[2], { [b.s[1][1]]: supplied(game, b.s[1][1], st.t) });
        return () => { c.bench[st.b] = { s, deps: b.deps }; };
      }
      case "witness": {
        if (!have("witness")) throw new Error("you don't have the Witness machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        if (c.goal[0] !== "∃") throw new Error("Witness needs a goal of the form ∃a. …");
        const goal = subst(c.goal[2], { [c.goal[1][1]]: supplied(game, c.goal[1][1], st.t) });
        return () => { c.kids = { kind: "witness", list: [["w", child(goal, c.hyps, carry(c.bench))]] }; };
      }
      case "obtain": {
        if (!have("obtain")) throw new Error("you don't have the Take a witness machine yet");
        if (c.kids) throw new Error("this workshop is already split");
        const b = block(st.b);
        if (b.s[0] !== "∃") throw new Error("Take a witness takes a block of the form ∃a. …");
        const v = st.v || newName(c, b.s[1][1]);
        // the witness is a number nothing else is known about: a letter this workshop doesn't speak about
        if (!/^[a-z]$/.test(v) || spoken(c).has(v)) throw new Error("the witness needs a letter that is new here");
        const s = subst(b.s[2], { [b.s[1][1]]: V(v) }), rest = c.bench.filter((_, i) => i !== st.b), n = c.hyps.length;
        return () => { game.names.add(v); c.kids = { kind: "obtain", v, list: [["o", child(c.goal, [...c.hyps, s], [...carry(rest), { s, deps: [n] }])]] }; };
      }
      case "cases": {
        if (!have("cases")) throw new Error("you don't have the Cases machine yet");
        const b = block(st.b), s = b.s[0] === "↔" ? unfold(b.s) : b.s;
        if (s[0] === "∧") return () => { c.bench.splice(st.b, 1, { s: s[1], deps: b.deps }, { s: s[2], deps: b.deps }); };
        if (s[0] !== "∨") throw new Error("Cases takes apart a block of the form P ∧ Q, P ∨ Q or P ↔ Q");
        if (c.kids) throw new Error("this workshop is already split");
        const rest = c.bench.filter((_, i) => i !== st.b), n = c.hyps.length;
        return () => { c.kids = { kind: "cases", list: [1, 2].map(k => ["pq"[k - 1], child(c.goal, [...c.hyps, s[k]], [...carry(rest), { s: s[k], deps: [n] }])]) }; };
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
  const COUNTED = new Set(["refl", "hyp", "stamp", "make", "rw", "rule", "induct", "assume", "dup", "apply", "have", "rwg", "byc", "cases", "fix", "spec", "witness", "obtain"]);
  const count = steps => steps.reduce((n, s) => n + (COUNTED.has(s.op) ? 1 : 0), 0);
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
    if (node) {
      const def = unfold(node), to = [def, ...folds(node)].filter(Boolean);
      for (const t of to) add({ op: onGoal ? "unfoldg" : "unfold", at: where || "", ...(onGoal ? {} : { b }), path: path || [], ...(t === def ? {} : { as: t[0] }) },
        { name: t === def ? "unfold the definition" : "fold into " + (t[0] === "#" ? "a numeral" : t[0]), from: node, to: t, free: true }, []);
    }
    // rewrites: equalities on a number part, biconditionals on a statement part (or on the whole block)
    if (node) {
      const kind = isForm(node) ? "↔" : "=";
      const ms = [...c.hyps.map((h, i) => ({ id: "h" + i, name: "given", stmt: h, hyp: true })), ...game.machines].filter(m => m.stmt && !m.premises && m.stmt[0] === kind);
      for (const m of ms) for (const dir of ["lr", "rl"]) {
        const [from, to] = dir === "lr" ? [m.stmt[1], m.stmt[2]] : [m.stmt[2], m.stmt[1]];
        add(onGoal ? { op: "rwg", at: where || "", path: path || [], m: m.id, dir } : { op: "rw", at: where || "", b, path: path || [], m: m.id, dir }, { name: m.name, from, to, hyp: !!m.hyp, loose: !m.hyp && isVar(from) }, m.hyp ? [] : left(to, [from]));
      }
    }
    if (!(path && path.length) && !onGoal) for (const m of game.machines.filter(x => x.premises)) {
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

  /* Where the player stands on a reference proof, one workshop at a time (the page's hints, #33): the next step
     `proof` takes in workshop `where`, with its block numbers moved to the player's bench, or null if that
     workshop isn't on the proof's route (another goal, other hypotheses, or its blocks aren't there). The player
     may hold extra blocks: the furthest point of the proof whose blocks are all on the bench is where they stand.
     `machines` must hold everything the proof uses, whether or not the player has it yet. */
  function follow(game, where, proof, machines) {
    let me;
    try { me = ctxAt(game, where); } catch (e) { return null; }
    if (me.kids || me.closed) return null;
    const key = c => show(c.goal) + "|" + c.hyps.map(show).join("|");
    const mine = me.bench.map(b => show(b.s)), ref = start(game.quest, machines);
    let best = null;
    for (const st of proof) {
      if (st.at === where) {
        let c = null;
        try { c = ctxAt(ref, where); } catch (e) {}
        if (c && !c.kids && key(c) === key(me)) {
          const used = new Set(), map = [];
          for (let i = 0; i < c.bench.length; i++) {
            const s = show(c.bench[i].s), j = mine[i] === s && !used.has(i) ? i : mine.findIndex((x, k) => x === s && !used.has(k));
            if (j < 0) break;
            used.add(j); map.push(j);
          }
          if (map.length === c.bench.length) best = { st, map };
        }
      }
      try { step(ref, st); } catch (e) { return null; }
    }
    if (!best) return null;
    const { st, map } = best;
    return { ...st, ...(st.b != null ? { b: map[st.b] } : {}), ...(st.others ? { others: st.others.map(o => map[o]) } : {}) };
  }

  /* Numbers (as BigInt, powers get large) and truth under an assignment (numbers for small letters, booleans for
     capitals, functions for predicates): the tests use this to check that every block is true whenever its
     workshop's hypotheses are. With mod, numbers are counted modulo it: the integers mod 5 satisfy every axiom
     here and induction too, and a quantifier can simply try all five (powers have no meaning there). */
  function value(t, env, mod) {
    const m = x => (mod ? ((x % BigInt(mod)) + BigInt(mod)) % BigInt(mod) : x);
    switch (t[0]) {
      case "0": return 0n;
      case "#": return m(BigInt(t[1]));
      case "v": return m(BigInt(env[t[1]]));
      case "S": return m(value(t[1], env, mod) + 1n);
      case "+": return m(value(t[1], env, mod) + value(t[2], env, mod));
      case "*": return m(value(t[1], env, mod) * value(t[2], env, mod));
      case "^": { if (mod) throw new Error("no powers modulo"); const e = value(t[2], env); if (e > 64n) throw new Error("too big"); return value(t[1], env) ** e; }
    }
    throw new Error("not a number");
  }
  function holds(s, env, mod) {
    const h = x => holds(x, env, mod);
    if (s[0] === "=") return value(s[1], env, mod) === value(s[2], env, mod);
    if (s[0] === "→") return !h(s[1]) || h(s[2]);
    if (s[0] === "∧") return h(s[1]) && h(s[2]);
    if (s[0] === "∨") return h(s[1]) || h(s[2]);
    if (s[0] === "↔") return h(s[1]) === h(s[2]);
    if (s[0] === "⊥") return false;
    if (s[0] === "⊤") return true;
    if (s[0] === "@") return !!env[s[1][1]](...s.slice(2).map(a => Number(value(a, env, mod))));
    if (QUANT.includes(s[0])) {
      if (!mod) throw new Error("a quantifier needs a finite model");
      const all = [...Array(mod).keys()].map(k => holds(s[2], { ...env, [s[1][1]]: k }, mod));
      return s[0] === "∀" ? all.every(Boolean) : all.some(Boolean);
    }
    if (isVar(s) && upper(s[1])) return !!env[s[1]];
    throw new Error("not a statement");
  }

  root.MathcraftLogic = {
    Z, S, plus, V, eq, same, vars, preds, at, boundAt, put, subst, match, show, parse, term, isForm, upper, neg, machine, questMachine,
    start, ctxAt, subs, shops, step, replay, count, closeAll, withQed, follow, options, preview, guess, applies, applyGoals, unfold, folds, expand, sameDef, fits, paths, value, holds,
  };
})(typeof window !== "undefined" ? window : globalThis);
