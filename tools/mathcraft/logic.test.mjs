// node --test tools/mathcraft/logic.test.mjs — reference proofs replay, the engine refuses unsound moves, every
// block reachable by random play is true whenever its workshop's hypotheses are, and the shop has no dead ends
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/mathcraft/logic.js";
import "../../public/mathcraft/quests.js";
const L = globalThis.MathcraftLogic, Q = globalThis.MathcraftQuests;

const allDone = i => new Set(Q.QUESTS.slice(0, i).map(q => q.id));
const fresh = i => L.start(Q.QUESTS[i], Q.machinesFor(i, allDone(i)));
const idx = id => Q.QUESTS.findIndex(q => q.id === id);
const rw = (g, path, m, dir = "lr", at = "", b = 0) => L.step(g, { op: "rw", at, b, path, m, dir });
const everything = () => Q.playMachines(allDone(Q.QUESTS.length));
const bench = (g, at = "") => L.ctxAt(g, at).bench.map(b => L.show(b.s));
// the quests that must be finished before q opens, all the way back
const prev = q => q.after || (() => { const ch = Q.QUESTS.filter(x => x.world === q.world), k = ch.indexOf(q); return k > 0 ? [ch[k - 1].id] : []; })();
const before = (q, out = new Set()) => { for (const id of prev(q)) if (!out.has(id)) { out.add(id); before(Q.QUESTS[idx(id)], out); } return out; };

test("parse and show round-trip", () => {
  for (const s of ["0", "S(0)", "a+b", "(a+b)+c", "a+(b+c)", "S(a+S(b))+0", "(a+b)+c = a+(b+c)", "a·b+c", "a·(b+c)", "(a·b)·c", "a·(b·c)", "(a+b)·c = a·c+b·c",
    "P", "P → Q", "P → (Q → P)", "(P → Q) → R", "a = b → b = a", "¬P", "¬¬P → P", "¬P → Q", "¬(P → ¬Q)", "¬(a = b)", "¬P ∧ Q", "¬⊥"]) assert.equal(L.show(L.parse(s)), s);
  assert.equal(L.show(L.parse("a+b+c")), "(a+b)+c");
  assert.equal(L.show(L.parse("a*b*c")), "(a·b)·c");
  assert.equal(L.show(L.parse("a+b*c")), "a+b·c");
  assert.equal(L.show(L.parse("2+1")), "S(S(0))+S(0)");
  assert.equal(L.show(L.parse("P->Q->R")), "P → (Q → R)", "→ groups to the right");
  for (const bad of ["", "a+", "S a", "(a", "a)", "a=b=c", "21", "P+a", "S(P)", "P=Q", "a->b", "P->a", "a*P", "?"]) assert.throws(() => L.parse(bad), bad);
});

test("every quest's reference proof replays to done, using only earlier quests and the machines it says it needs", () => {
  Q.QUESTS.forEach((q, i) => {
    const g = L.replay(q, Q.machinesFor(i, allDone(i)), q.proof);
    assert.ok(L.closeAll(g).root.done, q.id);
    assert.ok(Q.par(q) >= 1 && Q.par(q) <= 16, q.id + " par");
    for (let k = 0; k < q.proof.length; k++) assert.ok(!L.replay(q, Q.machinesFor(i, allDone(i)), q.proof.slice(0, k)).root.done, q.id + " done early");
    // `needs` is exactly the shop machines the proof uses that no quest on the way here asked for
    const pre = [...before(q)].map(id => Q.QUESTS[idx(id)]), owned = new Set([...pre, q].flatMap(x => x.needs || []));
    const used = new Set(q.proof.flatMap(s => [Q.TACTICS.includes(s.op) ? s.op : null, s.m]).filter(m => m && Q.gate(m)));
    for (const m of used) assert.ok(owned.has(m), `${q.id} uses ${m}, which no quest on the way to it lists in needs`);
    for (const id of q.needs || []) assert.ok(used.has(id), `${q.id} lists ${id} but doesn't use it`);
    // it only uses theorems that are finished by the time it opens, unless it says so (Amog's shortcuts in logic)
    for (const m of new Set(q.proof.map(s => s.m).filter(m => m && idx(m) >= 0))) assert.ok(idx(m) < i, `${q.id} uses ${m}, listed after it`);
    // and whatever it needs is on sale by the time it opens
    const done = Object.fromEntries(pre.map(x => [x.id, 1]));
    assert.ok(Q.isOpen(q, done), q.id + " opens once what comes before it is done");
    for (const id of q.needs || []) assert.ok(Q.onSale(id, done), `${id} not on sale when ${q.id} opens`);
  });
});

test("a quest cannot use itself or later quests, or quests not yet finished", () => {
  const i = idx("comm"), own = fresh(i);
  L.step(own, { op: "refl", at: "", t: "a+b" });
  for (const m of ["comm", "assoc"]) assert.throws(() => rw(own, [1], m), /don't have/);
  const g = L.start(Q.QUESTS[i], Q.machinesFor(i, new Set()));
  L.step(g, { op: "refl", at: "", t: "a" });
  assert.throws(() => rw(g, [1], "zadd", "rl"), /don't have/);
});

test("the induction hypothesis is a fact about one number, not a machine", () => {
  const g = fresh(idx("zadd"));
  L.step(g, { op: "induct", at: "", v: "a" });
  L.step(g, { op: "refl", at: "s", t: "0+S(a)" });
  // 0+S(a) is not literally 0+a, so the hypothesis must not fit (a slot would match)
  assert.throws(() => rw(g, [1], "h0", "lr", "s"), /doesn't fit/);
  // and the base workshop has no hypothesis at all
  L.step(g, { op: "refl", at: "b", t: "0+0" });
  assert.throws(() => rw(g, [1], "h0", "lr", "b"), /no such hypothesis/);
  assert.throws(() => L.step(g, { op: "hyp", at: "b", i: 0 }));
  // a block made from the hypothesis is tagged with it
  L.step(g, { op: "hyp", at: "s", i: 0 });
  assert.deepEqual(L.ctxAt(g, "s").bench[1].deps, [0]);
  assert.ok(!g.root.done);
});

test("induction is refused where it would be unsound", () => {
  assert.throws(() => L.step(L.start({ goal: "b=a", given: ["a=b"] }, everything()), { op: "induct", at: "", v: "a" }), /can't vary/);
  assert.throws(() => L.step(L.start(Q.QUESTS[idx("zadd")], Q.machinesFor(idx("zadd"), allDone(4), new Set(["add0", "addS"]))), { op: "induct", at: "", v: "a" }), /don't have/);
  const g = fresh(idx("comm"));
  assert.throws(() => L.step(g, { op: "induct", at: "", v: "z" }), /isn't in the goal/);
  assert.throws(() => L.step(g, { op: "induct", at: "", v: "" }), /small letter/);
  L.step(g, { op: "induct", at: "", v: "b" });
  assert.throws(() => L.step(g, { op: "induct", at: "", v: "a" }), /already split/);
  // inside the step, the hypothesis mentions a and b, so neither can vary any more
  assert.throws(() => L.step(g, { op: "induct", at: "s", v: "a" }), /can't vary/);
  // the base case has no hypothesis: a nested induction on a is fine there
  L.step(g, { op: "induct", at: "b", v: "a" });
  assert.equal(L.show(L.ctxAt(g, "bs").goal), "S(a)+0 = 0+S(a)");
  assert.equal(L.show(L.ctxAt(g, "bs").hyps[0]), "a+0 = 0+a");
  assert.throws(() => L.step(L.start({ goal: "P->P" }, everything()), { op: "induct", at: "", v: "P" }), /small letter/);
});

test("other refusals", () => {
  const g = fresh(idx("zz"));
  assert.throws(() => L.step(g, { op: "refl", at: "", t: "a" }), /no number called a/);
  assert.throws(() => L.step(g, { op: "refl", at: "", t: "0=0" }), /not an equation/);
  assert.throws(() => L.step(fresh(idx("pid")), { op: "refl", at: "", t: "P" }), /not an equation/);
  L.step(g, { op: "refl", at: "", t: "0+0" });
  assert.throws(() => rw(g, [], "add0"), /pick a part/);
  assert.throws(() => rw(g, [1, 0], "add0"), /doesn't fit/);
  assert.throws(() => L.step(g, { op: "rw", at: "", b: 3, path: [1], m: "add0", dir: "lr" }), /no such block/);
  assert.throws(() => L.step(g, { op: "stamp", at: "", m: "add0" }), /needs inputs/);
  assert.equal(g.steps.length, 1, "refused steps are not recorded");
});

test("symmetry and transitivity work as rules once crafted", () => {
  const i = idx("zadd"), g = fresh(i);
  L.step(g, { op: "refl", at: "", t: "0+0" });
  rw(g, [1], "add0");                                                            // 0+0 = 0
  L.step(g, { op: "dup", at: "", b: 0 });
  L.step(g, { op: "rule", at: "", b: 1, m: "sym" });                             // 0 = 0+0
  assert.equal(L.show(g.root.bench[1].s), "0 = 0+0");
  L.step(g, { op: "rule", at: "", b: 0, m: "trans", others: [1] });              // 0+0 = 0+0, and both inputs are used up
  assert.deepEqual(bench(g), ["0+0 = 0+0"]);
  assert.throws(() => L.step(g, { op: "rule", at: "", b: 0, m: "trans", others: [0] }));
  assert.equal(L.count(g.steps), 5, "dup counts: rules use blocks up, so a copy is worth a step");
  assert.ok(L.options(g, "", 0, []).every(o => o.rule.id !== "sym"), "sym on t = t changes nothing, so it isn't offered");
  rw(g, [1], "add0");
  assert.ok(L.options(g, "", 0, []).some(o => o.rule.id === "sym"), "rules are offered on the whole block");
  assert.ok(L.options(g, "", 0, [1]).every(o => !o.rule), "and not on a part");
  assert.deepEqual(L.fits(g, "", "sym"), [{ b: 0, path: [] }]);
});

test("make puts a machine's statement on the bench with its slots filled", () => {
  const i = idx("comm"), g = fresh(i);
  L.step(g, { op: "make", at: "", m: "zadd", fill: { a: "S(b)+a" } });
  assert.equal(L.show(g.root.bench[0].s), "0+(S(b)+a) = S(b)+a");
  L.step(g, { op: "make", at: "", m: "addS", fill: { a: "b", b: "a" } });       // simultaneous, not one after the other
  assert.equal(L.show(g.root.bench[1].s), "b+S(a) = S(b+a)");
  assert.throws(() => L.step(g, { op: "make", at: "", m: "addS", fill: { a: "b" } }), /give a term for b/);
  assert.throws(() => L.step(g, { op: "make", at: "", m: "zadd", fill: { a: "z" } }), /nothing called z/);
  assert.throws(() => L.step(g, { op: "make", at: "", m: "sym", fill: {} }), /give a term for a/);
  assert.throws(() => L.step(L.start({ goal: "b=a", given: ["a=b"] }, [L.questMachine({ id: "r", name: "r", given: ["a=b"], goal: "b=a" })]), { op: "make", at: "", m: "r", fill: {} }), /rule/);
  assert.throws(() => L.step(g, { op: "make", at: "", m: "comm", fill: { a: "a", b: "b" } }), /don't have/);
  L.step(g, { op: "induct", at: "", v: "b" });
  assert.throws(() => L.step(g, { op: "make", at: "s", m: "h0", fill: {} }), /as it is/);
  assert.equal(L.count(g.steps), 3);
});

test("fits finds where a machine does something, leaving out fits-anywhere moves", () => {
  const g = fresh(idx("zz"));
  L.step(g, { op: "refl", at: "", t: "0+0" });
  assert.deepEqual(L.fits(g, "", "add0"), [{ b: 0, path: [0] }, { b: 0, path: [1] }]);
  assert.deepEqual(L.fits(g, "", "addS"), []);
  const o = L.options(g, "", 0, [1]).filter(x => x.step.m === "add0");
  assert.deepEqual(o.map(x => !!x.loose), [false, true]);
});

test("a direction that leaves a slot open asks for the term", () => {
  const g = fresh(idx("mcomm"));
  L.step(g, { op: "refl", at: "", t: "a*0" });
  rw(g, [1], "mul0");                                                            // a·0 = 0
  assert.throws(() => rw(g, [1], "mz", "rl"), /needs a term for a/);
  assert.throws(() => L.step(g, { op: "rw", at: "", b: 0, path: [1], m: "mz", dir: "rl", fill: { a: "P" } }), /nothing called P|number for a/);
  assert.throws(() => L.step(g, { op: "rw", at: "", b: 0, path: [1], m: "mz", dir: "rl", fill: { a: "z" } }), /nothing called z/);
  L.step(g, { op: "rw", at: "", b: 0, path: [1], m: "mz", dir: "rl", fill: { a: "b+a" } });
  assert.equal(L.show(g.root.bench[0].s), "a·0 = 0·(b+a)");
  // the scanner offers it, with a guess for the open slot that the page lets the player change
  const zeros = L.options(g, "", 0, [0, 1]).filter(o => o.open);
  assert.ok(zeros.some(o => o.step.m === "mz" && o.step.fill.a === "a"), "0 → 0·a is offered on a 0, with a guessed a");
  assert.ok(zeros.some(o => o.step.m === "mul0"), "and 0 → a·0");
  const mz = zeros.find(o => o.step.m === "mz").step;                            // the 0 in a·0, left side
  assert.equal(L.show(L.preview(g, { ...mz, fill: { a: "b" } })), "a·(0·b) = 0·(b+a)");
  assert.throws(() => L.preview(g, { ...mz, fill: { a: "z" } }), /nothing called z/);
});

test("propositions: Assume, Modus ponens and their limits", () => {
  const all = allDone(Q.QUESTS.length);
  const g = L.start({ goal: "(P->Q)->(P->Q)" }, Q.playMachines(all));
  assert.throws(() => L.step(L.start({ goal: "P->P" }, Q.playMachines(all, new Set(["add0"]))), { op: "assume", at: "" }), /don't have/);
  assert.throws(() => L.step(L.start({ goal: "a+b=b+a" }, everything()), { op: "assume", at: "" }), /A → B/);
  assert.throws(() => L.step(fresh(idx("comm")), { op: "assume", at: "" }), /don't have/, "addition doesn't see Assume");
  L.step(g, { op: "assume", at: "" });
  assert.throws(() => L.step(g, { op: "assume", at: "" }), /already split/);
  assert.equal(L.show(L.ctxAt(g, "a").goal), "P → Q");
  assert.deepEqual(bench(g, "a"), ["P → Q"], "the assumption is already on the bench");
  L.step(g, { op: "assume", at: "a" });
  assert.deepEqual(L.ctxAt(g, "aa").hyps.map(L.show), ["P → Q", "P"]);
  assert.deepEqual(bench(g, "aa"), ["P → Q", "P"], "and the bench comes along into a nested workshop");
  assert.deepEqual(L.ctxAt(g, "aa").bench.map(b => b.deps), [[0], [1]]);
  // the order matters: the implication first
  assert.throws(() => L.step(g, { op: "rule", at: "aa", b: 1, m: "mp", others: [0] }), /don't fit/);
  // a hypothesis that isn't an equation can't rewrite, and equalities don't rewrite statements
  assert.throws(() => L.step(g, { op: "rw", at: "aa", b: 0, path: [0], m: "h1", dir: "lr" }), /isn't an equality/);
  assert.throws(() => L.step(g, { op: "rw", at: "aa", b: 0, path: [0], m: "add0", dir: "rl" }), /rewrite numbers/);
  assert.ok(L.options(g, "aa", 0, [0]).every(o => o.free), "only free translations on a statement part");
  L.step(g, { op: "rule", at: "aa", b: 0, m: "mp", others: [1] });
  assert.deepEqual(bench(g, "aa"), ["Q"], "modus ponens uses up both inputs");
  assert.deepEqual(L.ctxAt(g, "aa").bench[0].deps, [0, 1]);
  assert.ok(L.closeAll(g).root.done);
  // a block from inside a workshop never reaches the outer bench
  assert.deepEqual(g.root.bench, []);
  // a proved statement is a machine whose capital slots take statements and whose small ones take numbers
  const h = L.start({ goal: "a+b=b+a" }, [...Q.playMachines(all)]);
  L.step(h, { op: "make", at: "", m: "pk", fill: { P: "a+b=b+a", Q: "a=a" } });
  assert.equal(L.show(h.root.bench[0].s), "a+b = b+a → (a = a → a+b = b+a)");
  assert.throws(() => L.step(h, { op: "make", at: "", m: "pk", fill: { P: "a", Q: "a=a" } }), /stands for a statement/);
  assert.throws(() => L.step(h, { op: "make", at: "", m: "comm", fill: { a: "a=a", b: "b" } }), /number for a/);
  // equalities still rewrite numbers inside a statement
  L.step(h, { op: "rw", at: "", b: 0, path: [0, 0], m: "comm", dir: "lr" });
  assert.equal(L.show(h.root.bench[0].s), "b+a = b+a → (a = a → a+b = b+a)");
});

test("the bench comes along when a workshop splits, with 0 for the variable in a base case", () => {
  const g = fresh(idx("comm"));
  L.step(g, { op: "refl", at: "", t: "a+b" });
  L.step(g, { op: "rw", at: "", b: 0, path: [1], m: "zadd", dir: "rl" });             // a+b = 0+(a+b)
  L.step(g, { op: "induct", at: "", v: "b" });
  assert.deepEqual(bench(g, "b"), ["a+0 = 0+(a+0)"]);
  assert.deepEqual(bench(g, "s"), ["a+b = 0+(a+b)"]);
});

test("a proved implication is a rule: hypotheses in, consequent out", () => {
  const show = m => (m.premises ? m.premises.map(L.show).join(", ") + " gives " + L.show(m.concl) : L.show(m.stmt));
  const by = id => Q.playMachines(allDone(Q.QUESTS.length)).find(m => m.id === id);
  assert.equal(show(by("pchain")), "P → Q, Q → R gives P → R", "takes: the hypotheses as the theorem states them");
  assert.equal(show(by("pk")), "P gives Q → P");
  assert.equal(show(by("pswap")), "P → (Q → R) gives Q → (P → R)", "not a disguised double modus ponens");
  assert.equal(show(by("landi")), "P, Q gives P ∧ Q", "without takes, every arrow is a hypothesis");
  assert.equal(show(by("le")), "P gives P ∨ Q", "a definition is not an arrow to split at");
  assert.equal(show(by("sym")), "a = b gives b = a");
  assert.equal(show(by("comm")), "a+b = b+a", "equations stay equality machines");
  assert.equal(L.show(by("pchain").stmt), "(P → Q) → ((Q → R) → (P → R))", "and the implication can still be stamped whole");
  assert.equal(show(by("trans")), "a = b, b = c gives a = c");
  assert.equal(L.show(by("sym").stmt), "a = b → b = a", "Symmetry is an implication between equations (airetho)");
  // three-block rules are offered by the scanner
  const h = L.start({ goal: "(P->R)->((Q->R)->(P|Q->R))" }, everything());
  for (const at of ["", "a", "aa"]) L.step(h, { op: "assume", at });
  assert.ok(L.options(h, "aaa", 0, []).some(o => o.rule.id === "lore" && o.others.length === 2));
});

test("definitions: ∨, ∧ and ⊤ unfold, fold back, and are seen through one way", () => {
  const t = L.parse, sh = x => L.show(x);
  assert.equal(sh(L.unfold(t("P|Q"))), "¬P → Q");
  assert.equal(sh(L.unfold(t("P&Q"))), "¬(P → ¬Q)");
  assert.equal(sh(L.unfold(t("true"))), "¬⊥");
  assert.deepEqual(L.folds(t("(P->(Q->false))->false")).map(sh), ["P ∧ Q"]);
  assert.deepEqual(L.folds(t("~~P")).map(sh), ["P ∨ ⊥"], "¬¬P is also P ∨ ⊥");
  assert.deepEqual(L.folds(t("false->false")).map(sh), ["⊤"]);
  assert.ok(L.sameDef(t("P|~P"), t("~P->~P")) && !L.sameDef(t("P|Q"), t("Q|P")));
  const all = everything();
  // modus ponens takes P ∨ Q as ¬P → Q ...
  const g = L.start({ goal: "(P|Q)->((P->false)->Q)" }, all);
  L.step(g, { op: "assume", at: "" }); L.step(g, { op: "assume", at: "a" });
  L.step(g, { op: "rule", at: "aa", b: 0, m: "mp", others: [1] });
  assert.ok(L.closeAll(g).root.done);
  // ... but a machine about ∨ doesn't take ¬P → Q until it is folded (free)
  const h = L.start({ goal: "((P->false)->Q)->(P->R)->(Q->R)->R" }, all);
  for (const at of ["", "a", "aa"]) L.step(h, { op: "assume", at });
  assert.throws(() => L.step(h, { op: "rule", at: "aaa", b: 1, m: "lore", others: [2, 0] }), /don't fit/);
  L.step(h, { op: "unfold", at: "aaa", b: 0, path: [], as: "∨" });
  assert.equal(bench(h, "aaa")[0], "P ∨ Q");
  assert.throws(() => L.step(h, { op: "unfold", at: "aaa", b: 1, path: [], as: "∧" }), /isn't the definition/);
  L.step(h, { op: "rule", at: "aaa", b: 1, m: "lore", others: [2, 0] });
  assert.ok(L.closeAll(h).root.done);
  assert.equal(L.count(h.steps), 4, "folding is free");
  // Assume sees through a goal, and a goal is reached up to definitions
  const k = L.start({ goal: "P|(P->false)" }, all);
  L.step(k, { op: "assume", at: "" });
  assert.ok(L.closeAll(k).root.done, "excluded middle by unfolding");
  // ⊥ gives anything you name, but only from an actual ⊥
  const e = L.start({ goal: "P->Q" }, all);
  L.step(e, { op: "assume", at: "" });
  assert.throws(() => L.step(e, { op: "rule", at: "a", b: 0, m: "lefq", fill: { P: "Q" } }), /don't fit/);
  assert.ok(!L.holds(L.parse("P->Q"), { P: true, Q: false }) && L.holds(L.parse("(P|Q)&~false"), { P: false, Q: true }));
});

test("Apply works backwards; Lemma crafts a statement mid-proof; the Goal lever rewrites the goal", () => {
  const all = everything();
  const g = L.start({ goal: "P&Q->P" }, all);
  L.step(g, { op: "assume", at: "" });
  assert.throws(() => L.step(g, { op: "apply", at: "a", b: 0 }), /not in the goal/);
  const ways = L.applies(g, "a");
  assert.ok(ways.some(w => w.step.m === "dne" && L.show(w.goals[0]) === "¬¬P"));
  assert.ok(ways.some(w => w.step.m === "mp" && w.open), "modus ponens backwards needs its P");
  L.step(g, { op: "apply", at: "a", m: "dne" });
  assert.equal(L.show(L.ctxAt(g, "a1").goal), "¬¬P");
  assert.throws(() => L.step(g, { op: "apply", at: "a", m: "dne" }), /already split/);
  L.step(g, { op: "assume", at: "a1" });
  L.step(g, { op: "apply", at: "a1a", b: 0 });                                    // P ∧ Q read as ¬(P → ¬Q)
  assert.equal(L.show(L.ctxAt(g, "a1a1").goal), "P → ¬Q");
  assert.deepEqual(bench(g, "a1a1"), ["¬P"], "the applied block is used up");
  L.step(g, { op: "assume", at: "a1a1" }); L.step(g, { op: "assume", at: "a1a1a" });
  L.step(g, { op: "rule", at: "a1a1aa", b: 0, m: "mp", others: [1] });
  assert.ok(L.closeAll(g).root.done);
  // a rule with several premises leaves a goal for each
  const h = L.start({ goal: "P->(Q->P&Q)" }, all);
  L.step(h, { op: "assume", at: "" }); L.step(h, { op: "assume", at: "a" });
  L.step(h, { op: "apply", at: "aa", m: "landi" });
  assert.deepEqual(L.subs(L.ctxAt(h, "aa")).map(x => x[0] + ": " + L.show(x[1].goal)), ["1: P", "2: Q"]);
  assert.ok(L.closeAll(h).root.done, "both already on the carried bench");
  // a lemma: its own workshop, then the old goal holding it
  const k = L.start(Q.QUESTS[idx("comm")], Q.machinesFor(idx("comm"), allDone(idx("comm")), new Set(["add0", "addS", "induct"])));
  assert.throws(() => L.step(k, { op: "have", at: "", s: "a+0=a" }), /don't have/);
  const m = L.start(Q.QUESTS[idx("comm")], all);
  assert.throws(() => L.step(m, { op: "have", at: "", s: "z=z" }), /nothing called z/);
  L.step(m, { op: "refl", at: "", t: "b" });
  L.step(m, { op: "have", at: "", s: "0+a=a" });
  assert.deepEqual(bench(m, "l"), ["b = b"]);
  assert.deepEqual(bench(m, "c"), ["b = b", "0+a = a"]);
  assert.deepEqual(L.ctxAt(m, "c").bench[1].deps, [0]);
  L.step(m, { op: "make", at: "l", m: "zadd", fill: { a: "a" } });
  L.closeAll(m);
  assert.ok(!m.root.done && L.ctxAt(m, "l").done);
  // the goal lever
  const r = L.start(Q.QUESTS[idx("comm")], all);
  L.step(r, { op: "rwg", at: "", path: [1], m: "comm", dir: "lr" });
  assert.equal(L.show(r.root.goal), "a+b = a+b");
  L.step(r, { op: "refl", at: "", t: "a+b" });
  assert.ok(L.closeAll(r).root.done);
  assert.throws(() => L.step(L.start({ goal: "P->P" }, all), { op: "rwg", at: "", path: [0], m: "comm", dir: "lr" }), /rewrite numbers|no such part/);
});

test("nothing finishes by itself: a free qed step uses a block that is the goal", () => {
  const g = fresh(idx("zz"));
  L.step(g, { op: "refl", at: "", t: "0+0" });
  L.step(g, { op: "rw", at: "", b: 0, path: [1], m: "add0", dir: "lr" });
  assert.ok(!g.root.done, "the goal is on the bench, but the player hasn't said so");
  L.step(g, { op: "refl", at: "", t: "0" });
  assert.throws(() => L.step(g, { op: "qed", at: "", b: 1 }), /isn't the goal/);
  L.step(g, { op: "qed", at: "", b: 0 });
  assert.ok(g.root.done);
  assert.equal(L.count(g.steps), 3, "qed is free");
  assert.throws(() => L.step(g, { op: "qed", at: "", b: 0 }), /already done/);
  // up to definitions, and not on a split workshop
  const h = L.start({ goal: "P->P|Q" }, everything());
  L.step(h, { op: "assume", at: "" });
  assert.throws(() => L.step(h, { op: "qed", at: "", b: 0 }), /split/);
  L.step(h, { op: "assume", at: "a" });
  L.step(h, { op: "rule", at: "aa", b: 1, m: "mp", others: [0] });
  L.step(h, { op: "rule", at: "aa", b: 0, m: "lefq", fill: { P: "Q" } });
  L.step(h, { op: "qed", at: "aa", b: 0 });
  assert.ok(h.root.done, "a split workshop is done when its parts are");
  // old step lists get their qed steps back
  const q = Q.QUESTS[idx("zadd")], bare = q.proof.filter(s => s.op !== "qed");
  assert.ok(!L.replay(q, everything(), bare).root.done);
  assert.deepEqual(L.withQed(q, everything(), bare), q.proof);
  assert.deepEqual(L.withQed(q, everything(), q.proof), q.proof, "and keeps the ones it has");
});

test("the goal can be scanned, translated and rewritten", () => {
  const g = L.start({ goal: "P|Q->Q|P" }, everything());
  const o = L.options(g, "", "g", [0]);
  assert.deepEqual(o.map(x => x.step.op + " " + L.show(x.result)), ["unfoldg (¬P → Q) → Q ∨ P"]);
  L.step(g, o[0].step);
  L.step(g, { op: "unfoldg", at: "", path: [1] });
  assert.equal(L.show(g.root.goal), "(¬P → Q) → (¬Q → P)");
  L.step(g, { op: "unfoldg", at: "", path: [0], as: "∨" });
  assert.equal(L.show(g.root.goal), "P ∨ Q → (¬Q → P)");
  assert.throws(() => L.step(g, { op: "unfoldg", at: "", path: [0, 0] }), /only ∧, ∨ and ⊤ unfold/);
  assert.equal(L.count(g.steps), 0);
  const r = L.start(Q.QUESTS[idx("comm")], everything());
  assert.ok(L.options(r, "", "g", [1]).some(x => x.step.op === "rwg" && x.step.m === "comm"), "rewrites on a part of the goal");
  assert.ok(L.options(r, "", "g", []).every(x => !x.rule), "and no rules");
  L.step(r, { op: "induct", at: "", v: "b" });
  assert.deepEqual(L.options(r, "", "g", [1]), [], "a split workshop's goal is fixed");
});

test("Contradiction: assume the opposite, reach ⊥, two steps' worth", () => {
  const g = L.start({ goal: "P&Q->P" }, everything());
  L.step(g, { op: "assume", at: "" });
  L.step(g, { op: "byc", at: "a" });
  assert.equal(L.show(L.ctxAt(g, "ax").goal), "⊥");
  assert.deepEqual(bench(g, "ax"), ["P ∧ Q", "¬P"]);
  L.step(g, { op: "apply", at: "ax", b: 0 });
  L.step(g, { op: "assume", at: "ax1" }); L.step(g, { op: "assume", at: "ax1a" });
  L.step(g, { op: "rule", at: "ax1aa", b: 0, m: "mp", others: [1] });
  assert.ok(L.closeAll(g).root.done);
  assert.equal(L.count(g.steps), Q.par(Q.QUESTS[idx("landl")]), "the same count as Apply Double negation + Assume");
  const p = L.start({ goal: "((P->false)->false)->(P->false)" }, Q.playMachines(allDone(Q.QUESTS.length), undefined, ["prop", "any"]));
  assert.throws(() => L.step(p, { op: "byc", at: "" }), /don't have/);
  const noDne = L.start({ goal: "P" }, [{ id: "byc", name: "Contradiction" }]);
  assert.throws(() => L.step(noDne, { op: "byc", at: "" }), /needs Double negation/);
});

test("follow: the next step of Amog's proof from where the player stands, one workshop at a time", () => {
  const all = allDone(Q.QUESTS.length);
  // taking the advice, in whatever order the workshops are visited, finishes everything in par
  for (const [q, ms] of [...Q.QUESTS.map((q, i) => [q, Q.machinesFor(i, all)]), ...Q.BOUNTIES.map(b => [b, Q.playMachines(all, undefined, b.worlds)])]) {
    for (const pick of [ws => ws[0], ws => ws[ws.length - 1]]) {
      const g = L.start(q, ms);
      for (let n = 0; !g.root.done; n++) {
        assert.ok(n < 60, q.id);
        const at = pick(L.shops(g).filter(x => !x.c.kids && !x.c.done)).at, st = L.follow(g, at, q.proof, ms);
        assert.ok(st, `${q.id}: no advice in "${at}"`);
        L.step(g, st);
      }
      assert.equal(L.count(g.steps), Q.par(q), q.id);
    }
  }
  // the first induction (airetho's friend): reaching for the hypothesis doesn't lose the thread
  const i = idx("zadd"), q = Q.QUESTS[i], ms = Q.machinesFor(i, all), g = L.start(q, ms);
  assert.equal(L.follow(g, "", q.proof, ms).op, "induct");
  L.step(g, { op: "induct", at: "", v: "a" });
  assert.equal(L.follow(g, "", q.proof, ms), null, "a split workshop has no step of its own");
  L.step(g, { op: "hyp", at: "s", i: 0 });
  assert.deepEqual(L.follow(g, "s", q.proof, ms), { op: "refl", at: "s", t: "0+S(a)" });
  L.step(g, { op: "refl", at: "s", t: "0+S(a)" });
  assert.deepEqual(L.follow(g, "s", q.proof, ms), { op: "rw", at: "s", b: 1, path: [1], m: "addS", dir: "lr" }, "block numbers are the player's");
  L.step(g, { op: "rw", at: "s", b: 1, path: [1], m: "addS", dir: "lr" });
  L.step(g, { op: "dup", at: "s", b: 1 });
  L.step(g, { op: "rw", at: "s", b: 2, path: [1, 0], m: "h0", dir: "lr" });
  assert.deepEqual(L.follow(g, "s", q.proof, ms), { op: "qed", at: "s", b: 2 }, "the furthest point of the proof that is on the bench");
  L.step(g, { op: "qed", at: "s", b: 2 });
  assert.equal(L.follow(g, "s", q.proof, ms), null, "nothing left to do there");
  assert.equal(L.follow(g, "b", q.proof, ms).op, "refl");
  // another route (induction on the other letter) is not Amog's: no advice rather than wrong advice
  const j = idx("comm"), h = L.start(Q.QUESTS[j], Q.machinesFor(j, all));
  L.step(h, { op: "induct", at: "", v: "a" });
  assert.equal(L.follow(h, "s", Q.QUESTS[j].proof, Q.machinesFor(j, all)), null);
  assert.equal(L.follow(h, "zz", Q.QUESTS[j].proof, Q.machinesFor(j, all)), null);
});

test("a world only sees the machines of the worlds it builds on", () => {
  const all = allDone(Q.QUESTS.length), ids = id => Q.machinesFor(idx(id), all).map(m => m.id);
  assert.ok(ids("massoc").includes("comm") && ids("massoc").includes("mul0") && !ids("massoc").includes("assume") && !ids("massoc").includes("pid"));
  assert.ok(ids("pdist").includes("mp") && !ids("pdist").includes("add0") && !ids("pdist").includes("dne"));
  assert.ok(ids("la").includes("mp") && ids("la").includes("pchain") && ids("la").includes("landi") && !ids("la").includes("comm"));
  assert.ok(ids("comm").includes("have") && ids("la").includes("have"), "Lemma works in every world");
  assert.deepEqual(Q.playMachines(all, undefined, ["prop"]).map(m => m.id).filter(id => /^(dne|apply|landi|comm|mp|pk)$/.test(id)).sort(), ["mp", "pk"], "a bounty can be limited to some worlds");
  assert.ok(!ids("assoc").includes("mul0") && !ids("assoc").includes("mp"));
  assert.ok(ids("zadd").includes("sym") && ids("massoc").includes("trans") && !ids("pdist").includes("sym"), "the number worlds get the equality rules");
  assert.ok(ids("trans").includes("assume") && ids("trans").includes("sym") && !ids("trans").includes("add0") && !ids("trans").includes("pid"), "equality: Assume and nothing about addition");
  assert.ok(Q.numeric("eq") && Q.numeric("add") && Q.numeric("mul") && !Q.numeric("prop") && !Q.numeric("logic"));
  assert.equal(everything().length, Q.GATES.length + Q.QUESTS.length);
  for (const q of Q.QUESTS) for (const id of q.needs || []) assert.ok(Q.sees(q.world, Q.gate(id).w), `${q.id} needs ${id} from a world it can't see`);
});

test("bounties are provable from the finished quests", () => {
  const done = allDone(Q.QUESTS.length);
  for (const b of Q.BOUNTIES) {
    const g = L.replay(b, Q.playMachines(done), b.proof);
    assert.ok(L.closeAll(g).root.done, b.id);
    for (const blk of g.root.bench) assert.ok(L.holds(blk.s, { a: 3, b: 5, c: 2, d: 7 }), b.id);
  }
  // a bounty is closed until the machines Amog's proof of it uses are there (airetho)
  const by = id => Q.BOUNTIES.find(b => b.id === id), d = ids => Object.fromEntries(ids.map(id => [id, 1]));
  assert.deepEqual(by("b11").tools.sort(), ["add0", "addS"]);
  assert.deepEqual(by("ln").tools.sort(), ["assume", "mp", "pmp"]);
  assert.ok(Q.BOUNTIES.every(b => !Q.bountyOpen(b, {}, new Set())), "none at the start");
  assert.ok(!Q.bountyOpen(by("b11"), {}, new Set(["add0"])) && Q.bountyOpen(by("b11"), {}, new Set(["add0", "addS"])));
  assert.ok(!Q.bountyOpen(by("bswap"), d(["comm"]), new Set(["add0", "addS"])) && Q.bountyOpen(by("bswap"), d(["comm", "assoc"]), new Set()));
  assert.ok(Q.BOUNTIES.every(b => Q.bountyOpen(b, d(Q.QUESTS.map(q => q.id)), new Set(Q.GATES.map(m => m.id)))));
});

test("owned shop machines gate what a quest can use", () => {
  const ids = (i, owned) => Q.machinesFor(i, allDone(i), new Set(owned)).map(m => m.id);
  assert.deepEqual(ids(1, []), ["refl0"]);
  assert.deepEqual(ids(1, ["add0"]), ["add0", "refl0"]);
  assert.ok(!ids(idx("zadd"), ["add0", "addS"]).includes("induct"));
  assert.ok(ids(idx("zadd"), ["add0", "addS", "induct"]).includes("induct"));
  assert.throws(() => L.replay(Q.QUESTS[1], Q.machinesFor(1, allDone(1), new Set()), Q.QUESTS[1].proof), /don't have/);
  assert.deepEqual(Q.playMachines(new Set(["refl0", "zz"]), new Set(["add0", "mp"])).map(m => m.id), ["add0", "mp", "refl0", "zz"]);
});

test("quests open in branches and machines go on sale when a quest needs them", () => {
  const done = ids => Object.fromEntries(ids.map(id => [id, 99]));
  const open = d => Q.QUESTS.filter(q => !(q.id in d) && Q.isOpen(q, d)).map(q => q.id);
  assert.deepEqual(open({}), ["refl0"]);
  assert.deepEqual(open(done(["refl0"])), ["zz"]);
  assert.deepEqual(open(done(["refl0", "zz"])), ["zadd", "pid"], "the fork: induction or propositions");
  assert.deepEqual(open(done(["refl0", "zz", "pid"])), ["sym", "zadd", "pk"], "equality opens once Assume is known");
  assert.deepEqual(open(done(["refl0", "zz", "pid", "sym"])), ["trans", "zadd", "pk"]);
  assert.deepEqual(open(done(Q.QUESTS.filter(q => q.world === "add").map(q => q.id))), ["pid", "mz"]);
  assert.deepEqual(open(done(["refl0", "zz", "pid", "pk", "pmp"])), ["sym", "zadd", "pchain", "lnn"], "four ways on");
  const sale = d => Q.SHOP.filter(x => x.gate && Q.onSale(x.id, d)).map(x => x.id);
  assert.deepEqual(sale({}), []);
  assert.deepEqual(sale(done(["refl0"])), ["add0"]);
  assert.deepEqual(sale(done(["refl0", "zz"])), ["add0", "addS", "induct", "assume"]);
  assert.match(Q.canBuy("mul0", done(["refl0", "zz"]), new Set(["add0"])), /not on sale/);
  assert.deepEqual(Q.SHOP.filter(x => x.gate && !x.extra).map(x => x.id).sort(), Q.QUESTS.flatMap(q => q.needs || []).sort(), "every machine sold is needed by exactly one quest's `needs`");
  assert.deepEqual(Q.SHOP.filter(x => x.gate).map(x => x.id), Q.GATES.map(m => m.id));
  assert.deepEqual([...new Set(Q.QUESTS.map(q => q.world))].sort(), Q.WORLDS.map(w => w[0]).sort());
});

test("payouts", () => {
  assert.equal(Q.earned({ refl0: 1 }), 2 + Q.PAR_BONUS);
  assert.equal(Q.earned({ refl0: 9, b11: 3, nonsense: 1 }), 2 + 1);
  assert.match(Q.canBuy("addS", {}, new Set()), /not on sale/);
  assert.match(Q.canBuy("add0", {}, new Set()), /not on sale/);
  assert.match(Q.canBuy("scanner", { refl0: 9 }, new Set()), /need ∎2 more/);
  // with ∎2 the only sensible buy is the machine quest 1 needs; an upgrade would strand you
  assert.equal(Q.canBuy("add0", { refl0: 9 }, new Set()), "");
  assert.match(Q.canBuy("autofill", { refl0: 9 }, new Set()), /leave too little/);
  // after Zero plus zero, even with no par bonus, either branch can be bought into (and not half of one)
  const d = { refl0: 9, zz: 9 }, own = new Set(["add0"]);
  assert.equal(Q.balance(d, own), 4);
  assert.equal(Q.canBuy("assume", d, own), "", "implication");
  assert.equal(Q.canBuy("induct", d, own), "", "or induction, which needs both of its machines");
  assert.equal(Q.canBuy("addS", d, new Set(["add0", "induct"])), "");
  assert.match(Q.canBuy("scanner", d, own), /leave too little/);
});

test("the shop has no dead ends: whatever is bought, in any order, every quest can still be finished", () => {
  // worst case for the player: no par bonus, no bounties. A state is how far each world is, plus what is owned.
  const worlds = Q.WORLDS.map(w => Q.QUESTS.filter(q => q.world === w[0]));
  const items = Q.SHOP.map(x => x.id);
  const doneOf = prog => { const d = {}; worlds.forEach((qs, w) => qs.slice(0, prog[w]).forEach(q => { d[q.id] = 999; })); return d; };
  const seen = new Set(), stack = [[worlds.map(() => 0), 0]];
  let terminals = 0;
  while (stack.length) {
    const [prog, mask] = stack.pop(), key = prog.join(",") + "|" + mask;
    if (seen.has(key)) continue;
    seen.add(key);
    const done = doneOf(prog), owned = new Set(items.filter((_, k) => mask >> k & 1));
    assert.ok(Q.balance(done, owned) >= 0, key);
    let moves = 0;
    worlds.forEach((qs, w) => {
      const q = qs[prog[w]];
      if (!q || !Q.isOpen(q, done) || Q.missing(q, owned)) return;
      moves++; stack.push([prog.map((p, k) => p + (k === w)), mask]);
    });
    items.forEach((id, k) => { if (!Q.canBuy(id, done, owned)) { moves++; stack.push([prog, mask | 1 << k]); } });
    if (!moves) {
      terminals++;
      assert.ok(worlds.every((qs, w) => prog[w] === qs.length), "stuck at " + key + " owning " + [...owned].join(","));
      assert.equal(owned.size, items.length, "and everything in the shop is affordable from quests alone");
    }
  }
  assert.ok(seen.size > 500 && terminals >= 1, `${seen.size} states`);
});

test("random play only ever makes true statements", () => {
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const size = t => (t[0] === "v" || t[0] === "0" ? 1 : 1 + t.slice(1).reduce((a, k) => a + size(k), 0));
  const sides = t => (t[0] === "=" ? [t[1], t[2]] : t[0] === "→" ? [...sides(t[1]), ...sides(t[2])] : []);
  let checked = 0, conditional = 0;
  const items = [...Q.QUESTS.map((q, i) => [q, Q.machinesFor(i, allDone(i))]), [{ id: "mix", goal: "(a+b=b+a)->((P->Q)->(a*b=b*a))" }, everything()], [{ id: "mix2", goal: "(P&Q->R)->((P|Q)->((Q->P)->(R|false)))" }, everything()]];
  for (const [q, machines] of items) {
    for (let run = 0; run < 30; run++) {
      const g = L.start(q, machines), names = [...g.names], nums = names.filter(n => !L.upper(n));
      for (let move = 0; move < 30; move++) {
        const ws = L.shops(g).filter(x => !x.c.kids), at = ws[rnd(ws.length)].at, c = L.ctxAt(g, at), r = rnd(13);
        try {
          if (r === 0 && nums.length) L.step(g, { op: "induct", at, v: nums[rnd(nums.length)] });
          else if (r === 12) { const o = L.options(g, at, "g", rnd(2) ? [] : [rnd(2)]); L.step(g, o.length ? o[rnd(o.length)].step : { op: "byc", at }); }
          else if (r === 1) L.step(g, rnd(3) ? { op: "assume", at } : rnd(2) ? { op: "have", at, s: L.show(c.bench.length ? c.bench[rnd(c.bench.length)].s : c.goal) } : (() => { const a = L.applies(g, at); return a.length ? a[rnd(a.length)].step : { op: "assume", at }; })());
          else if (r <= 3 && c.hyps.length) L.step(g, { op: "hyp", at, i: rnd(c.hyps.length) });
          else if (r <= 5 || !c.bench.length) { const ts = sides(c.goal); if (ts.length) L.step(g, { op: "refl", at, t: ts[rnd(ts.length)] }); }
          else {
            const b = rnd(c.bench.length);
            if (size(c.bench[b].s) > 40) { L.step(g, { op: "del", at, b }); continue; }
            const ps = [[], ...L.paths(c.bench[b].s)], o = L.options(g, at, b, ps[rnd(ps.length)]);
            if (o.length) L.step(g, o[rnd(o.length)].step);
          }
        } catch (e) { /* refused moves are fine; unsound ones are what we're hunting */ }
        if (rnd(4) === 0) L.closeAll(g);                                       // qed whatever is ready
        for (const w of L.shops(g)) for (const blk of w.c.bench) for (let k = 0; k < 6; k++) {
          const env = {}, x = rnd(5);
          for (const v of names) env[v] = L.upper(v) ? rnd(2) === 1 : k < 2 ? x : rnd(5);
          if (!w.c.hyps.every(h => L.holds(h, env))) continue;
          if (w.c.hyps.length) conditional++;
          assert.ok(L.holds(blk.s, env), `${q.id}: false block ${L.show(blk.s)} at ${JSON.stringify(env)} in workshop "${w.at}"`);
          if (w.c.done) assert.ok(L.holds(w.c.goal, env), `${q.id}: workshop "${w.at}" done with a false goal`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 20000 && conditional > 2000, `${checked} checks, ${conditional} under hypotheses`);
});
