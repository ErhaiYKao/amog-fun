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

test("parse and show round-trip", () => {
  for (const s of ["0", "S(0)", "a+b", "(a+b)+c", "a+(b+c)", "S(a+S(b))+0", "(a+b)+c = a+(b+c)", "a·b+c", "a·(b+c)", "(a·b)·c", "a·(b·c)", "(a+b)·c = a·c+b·c",
    "P", "P → Q", "P → (Q → P)", "(P → Q) → R", "a = b → b = a"]) assert.equal(L.show(L.parse(s)), s);
  assert.equal(L.show(L.parse("a+b+c")), "(a+b)+c");
  assert.equal(L.show(L.parse("a*b*c")), "(a·b)·c");
  assert.equal(L.show(L.parse("a+b*c")), "a+b·c");
  assert.equal(L.show(L.parse("2+1")), "S(S(0))+S(0)");
  assert.equal(L.show(L.parse("P->Q->R")), "P → (Q → R)", "→ groups to the right");
  for (const bad of ["", "a+", "S a", "(a", "a)", "a=b=c", "21", "P+a", "S(P)", "P=Q", "a->b", "P->a", "a*P", "?"]) assert.throws(() => L.parse(bad), bad);
});

test("every quest's reference proof replays to done, using only earlier quests and the machines it says it needs", () => {
  const owned = new Set();
  Q.QUESTS.forEach((q, i) => {
    const g = L.replay(q, Q.machinesFor(i, allDone(i)), q.proof);
    assert.ok(g.root.done, q.id);
    assert.ok(Q.par(q) >= 1 && Q.par(q) <= 16, q.id + " par");
    for (let k = 0; k < q.proof.length; k++) assert.ok(!L.replay(q, Q.machinesFor(i, allDone(i)), q.proof.slice(0, k)).root.done, q.id + " done early");
    // `needs` is exactly the shop machines the proof uses that no earlier quest of its world asked for
    for (const id of q.needs || []) owned.add(id);
    const used = new Set(q.proof.map(s => (s.op === "induct" || s.op === "assume" ? s.op : s.m)).filter(m => Q.gate(m)));
    for (const m of used) assert.ok(owned.has(m), `${q.id} uses ${m}, which no quest so far lists in needs`);
    for (const id of q.needs || []) assert.ok(used.has(id), `${q.id} lists ${id} but doesn't use it`);
    // and whatever it needs is on sale by the time it opens
    const done = Object.fromEntries([...allDone(Q.QUESTS.length)].filter(d => (q.after || [Q.QUESTS[i - 1] && Q.QUESTS[i - 1].id]).includes(d) || idx(d) < idx((q.after || [])[0] || q.id)).map(d => [d, 1]));
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
  assert.throws(() => L.step(fresh(idx("sym")), { op: "induct", at: "", v: "a" }), /can't vary/);
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
  assert.equal(L.count(g.steps), 4, "dup is free");
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
  assert.throws(() => L.step(g, { op: "make", at: "", m: "sym", fill: {} }), /rule/);
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
  assert.ok(L.options(g, "", 0, [0]).every(o => !/needs/.test(L.show(o.result))), "open-slot directions are not offered as options");
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
  L.step(g, { op: "assume", at: "a" });
  assert.deepEqual(L.ctxAt(g, "aa").hyps.map(L.show), ["P → Q", "P"]);
  L.step(g, { op: "hyp", at: "aa", i: 1 });                                       // P
  L.step(g, { op: "hyp", at: "aa", i: 0 });                                       // P → Q
  // the order matters: the implication first
  assert.throws(() => L.step(g, { op: "rule", at: "aa", b: 0, m: "mp", others: [1] }), /don't fit/);
  // a hypothesis that isn't an equation can't rewrite, and equalities don't rewrite statements
  assert.throws(() => L.step(g, { op: "rw", at: "aa", b: 1, path: [0], m: "h1", dir: "lr" }), /isn't an equality/);
  assert.throws(() => L.step(g, { op: "rw", at: "aa", b: 1, path: [0], m: "add0", dir: "rl" }), /rewrite numbers/);
  assert.deepEqual(L.options(g, "aa", 1, [0]), []);
  L.step(g, { op: "rule", at: "aa", b: 1, m: "mp", others: [0] });
  assert.deepEqual(bench(g, "aa"), ["Q"], "modus ponens uses up both inputs");
  assert.deepEqual(L.ctxAt(g, "aa").bench[0].deps, [0, 1]);
  assert.ok(g.root.done);
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

test("a proved implication is a rule: hypotheses in, consequent out", () => {
  const show = m => (m.premises ? m.premises.map(L.show).join(", ") + " gives " + L.show(m.concl) : L.show(m.stmt));
  const by = id => Q.playMachines(allDone(Q.QUESTS.length)).find(m => m.id === id);
  assert.equal(show(by("pchain")), "P → Q, Q → R, P gives R");
  assert.equal(show(by("pk")), "P, Q gives P");
  assert.equal(show(by("sym")), "a = b gives b = a");
  assert.equal(show(by("comm")), "a+b = b+a", "equations stay equality machines");
  assert.equal(L.show(by("pchain").stmt), "(P → Q) → ((Q → R) → (P → R))", "and the implication can still be stamped whole");
  assert.equal(by("sym").stmt, undefined);
  // contrapositive in one rule application instead of two rounds of modus ponens
  const g = L.start({ goal: "(P->Q)->((Q->false)->(P->false))" }, everything());
  for (const at of ["", "a", "aa"]) L.step(g, { op: "assume", at });
  for (const i of [0, 1, 2]) L.step(g, { op: "hyp", at: "aaa", i });
  assert.equal(L.options(g, "aaa", 0, []).filter(o => o.rule.id === "pchain").length, 1, "three-block rules are offered too");
  L.step(g, { op: "rule", at: "aaa", b: 0, m: "pchain", others: [1, 2] });
  assert.deepEqual(bench(g, "aaa"), ["⊥"]);
  assert.ok(g.root.done);
  assert.ok(L.count(g.steps) < Q.par(Q.QUESTS[idx("lk")]), "which beats the reference proof");
});

test("and, or, false, true", () => {
  const g = L.start({ goal: "P&Q->(Q|R)&P" }, everything());
  L.step(g, { op: "assume", at: "" });
  L.step(g, { op: "hyp", at: "a", i: 0 });
  L.step(g, { op: "hyp", at: "a", i: 0 });
  L.step(g, { op: "rule", at: "a", b: 0, m: "andR" });                           // Q, P ∧ Q
  assert.throws(() => L.step(g, { op: "rule", at: "a", b: 0, m: "orL" }), /told what Q is/);
  assert.throws(() => L.step(g, { op: "rule", at: "a", b: 0, m: "orL", fill: { Q: "a" } }), /nothing called a|stands for a statement/);
  L.step(g, { op: "rule", at: "a", b: 0, m: "orL", fill: { Q: "R" } });          // Q ∨ R, P ∧ Q
  L.step(g, { op: "rule", at: "a", b: 1, m: "andL" });                           // Q ∨ R, P
  assert.throws(() => L.step(g, { op: "rule", at: "a", b: 0, m: "andL" }), /don't fit/);
  L.step(g, { op: "rule", at: "a", b: 0, m: "andI", others: [1] });
  assert.deepEqual(bench(g, "a"), ["(Q ∨ R) ∧ P"]);
  assert.ok(g.root.done);
  // ⊥ gives anything you name, but only from an actual ⊥
  const h = L.start({ goal: "false->(P->Q)" }, everything());
  L.step(h, { op: "assume", at: "" });
  L.step(h, { op: "hyp", at: "a", i: 0 });
  L.step(h, { op: "rule", at: "a", b: 0, m: "efq", fill: { P: "P->Q" } });
  assert.ok(h.root.done);
  const k = L.start({ goal: "P->Q" }, everything());
  L.step(k, { op: "assume", at: "" });
  L.step(k, { op: "hyp", at: "a", i: 0 });
  assert.throws(() => L.step(k, { op: "rule", at: "a", b: 0, m: "efq", fill: { P: "Q" } }), /don't fit/);
  L.step(k, { op: "rule", at: "a", b: 0, m: "top" });
  assert.deepEqual(bench(k, "a"), ["⊤"]);
  assert.ok(!k.root.done);
  assert.ok(!L.holds(L.parse("P->Q"), { P: true, Q: false }) && L.holds(L.parse("(P|Q)&~false"), { P: false, Q: true }));
});

test("a world only sees the machines of the worlds it builds on", () => {
  const all = allDone(Q.QUESTS.length), ids = id => Q.machinesFor(idx(id), all).map(m => m.id);
  assert.ok(ids("massoc").includes("comm") && ids("massoc").includes("mul0") && !ids("massoc").includes("assume") && !ids("massoc").includes("pid"));
  assert.ok(ids("pdist").includes("mp") && !ids("pdist").includes("add0") && !ids("pdist").includes("andI"));
  assert.ok(ids("le").includes("mp") && ids("le").includes("pchain") && ids("le").includes("andI") && !ids("le").includes("comm"));
  assert.ok(!ids("assoc").includes("mul0") && !ids("assoc").includes("mp"));
  assert.equal(everything().length, Q.GATES.length + Q.QUESTS.length);
  for (const q of Q.QUESTS) for (const id of q.needs || []) assert.ok(Q.sees(q.world, Q.gate(id).w), `${q.id} needs ${id} from a world it can't see`);
});

test("bounties are provable from the finished quests", () => {
  const done = allDone(Q.QUESTS.length);
  for (const b of Q.BOUNTIES) {
    const g = L.replay(b, Q.playMachines(done), b.proof);
    assert.ok(g.root.done, b.id);
    for (const blk of g.root.bench) assert.ok(L.holds(blk.s, { a: 3, b: 5, c: 2, d: 7 }), b.id);
  }
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
  assert.deepEqual(open(done(["refl0", "zz", "sym"])), ["trans"]);
  assert.deepEqual(open(done(["refl0", "zz", "sym", "trans"])), ["zadd", "pid"], "the fork: induction or propositions");
  assert.deepEqual(open(done(Q.QUESTS.filter(q => q.world === "add").map(q => q.id))), ["pid", "mz"]);
  assert.deepEqual(open(done(["refl0", "zz", "sym", "trans", "pid", "pk", "pmp"])), ["zadd", "pchain", "la"], "three ways on");
  const sale = d => Q.SHOP.filter(x => x.gate && Q.onSale(x.id, d)).map(x => x.id);
  assert.deepEqual(sale({}), []);
  assert.deepEqual(sale(done(["refl0"])), ["add0"]);
  assert.deepEqual(sale(done(["refl0", "zz", "sym", "trans"])), ["add0", "addS", "induct", "assume"]);
  assert.match(Q.canBuy("mul0", done(["refl0", "zz", "sym", "trans"]), new Set(["add0"])), /not on sale/);
  assert.deepEqual(Q.SHOP.filter(x => x.gate).map(x => x.id).sort(), Q.QUESTS.flatMap(q => q.needs || []).sort(), "every machine sold is needed by exactly one quest's `needs`");
  assert.deepEqual(Q.SHOP.filter(x => x.gate).map(x => x.id), Q.GATES.map(m => m.id));
  for (const w of Q.WORLDS) { const at = Q.QUESTS.map((q, i) => (q.world === w[0] ? i : -1)).filter(i => i >= 0); assert.equal(at[at.length - 1] - at[0] + 1, at.length, w[0] + " is contiguous in QUESTS"); }
});

test("payouts", () => {
  assert.equal(Q.earned({ refl0: 1 }), 1 + Q.PAR_BONUS);
  assert.equal(Q.earned({ refl0: 9, b11: 3, nonsense: 1 }), 1 + 1);
  assert.match(Q.canBuy("addS", {}, new Set()), /not on sale/);
  assert.match(Q.canBuy("add0", {}, new Set()), /not on sale/);
  assert.match(Q.canBuy("scanner", { refl0: 9 }, new Set()), /need ∎3 more/);
  // with ∎1 the only sensible buy is the machine quest 1 needs; an upgrade would strand you
  assert.equal(Q.canBuy("add0", { refl0: 9 }, new Set()), "");
  assert.match(Q.canBuy("autofill", { refl0: 1, zz: 9 }, new Set(["add0"])), /^$/, "sym needs nothing, so spending is safe");
  assert.match(Q.canBuy("scanner", { refl0: 9, zz: 9, sym: 9, trans: 9 }, new Set(["add0"])), /leave too little/);
  assert.equal(Q.canBuy("assume", { refl0: 9, zz: 9, sym: 9, trans: 9 }, new Set(["add0"])), "", "either branch can be bought into");
  assert.equal(Q.canBuy("induct", { refl0: 9, zz: 9, sym: 9, trans: 9 }, new Set(["add0"])), "");
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
        const ws = L.shops(g).filter(x => !x.c.kids), at = ws[rnd(ws.length)].at, c = L.ctxAt(g, at), r = rnd(12);
        try {
          if (r === 0 && nums.length) L.step(g, { op: "induct", at, v: nums[rnd(nums.length)] });
          else if (r === 1) L.step(g, { op: "assume", at });
          else if (r <= 3 && c.hyps.length) L.step(g, { op: "hyp", at, i: rnd(c.hyps.length) });
          else if (r <= 5 || !c.bench.length) { const ts = sides(c.goal); if (ts.length) L.step(g, { op: "refl", at, t: ts[rnd(ts.length)] }); }
          else {
            const b = rnd(c.bench.length);
            if (size(c.bench[b].s) > 40) { L.step(g, { op: "del", at, b }); continue; }
            const ps = [[], ...L.paths(c.bench[b].s)], o = L.options(g, at, b, ps[rnd(ps.length)]);
            if (o.length) L.step(g, o[rnd(o.length)].step);
          }
        } catch (e) { /* refused moves are fine; unsound ones are what we're hunting */ }
        for (const w of L.shops(g)) for (const blk of w.c.bench) for (let k = 0; k < 6; k++) {
          const env = {}, x = rnd(5);
          for (const v of names) env[v] = L.upper(v) ? rnd(2) === 1 : k < 2 ? x : rnd(5);
          if (!w.c.hyps.every(h => L.holds(h, env))) continue;
          if (w.c.hyps.length) conditional++;
          assert.ok(L.holds(blk.s, env), `${q.id}: false block ${L.show(blk.s)} at ${JSON.stringify(env)} in workshop "${w.at}"`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 20000 && conditional > 2000, `${checked} checks, ${conditional} under hypotheses`);
});
