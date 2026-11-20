// node --test tools/mathcraft/logic.test.mjs — reference proofs replay, the engine refuses unsound moves,
// and every block reachable by random play is a true statement about the natural numbers
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/mathcraft/logic.js";
import "../../public/mathcraft/quests.js";
const L = globalThis.MathcraftLogic, Q = globalThis.MathcraftQuests;

const allDone = i => new Set(Q.QUESTS.slice(0, i).map(q => q.id));
const fresh = i => L.start(Q.QUESTS[i], Q.machinesFor(i, allDone(i)));
const idx = id => Q.QUESTS.findIndex(q => q.id === id);

test("parse and show round-trip", () => {
  for (const s of ["0", "S(0)", "a+b", "(a+b)+c", "a+(b+c)", "S(a+S(b))+0", "(a+b)+c = a+(b+c)"]) assert.equal(L.show(L.parse(s)), s);
  assert.equal(L.show(L.parse("a+b+c")), "(a+b)+c");
  assert.equal(L.show(L.parse("2+1")), "S(S(0))+S(0)");
  for (const bad of ["", "a+", "S a", "(a", "a)", "a=b=c", "A", "21"]) assert.throws(() => L.parse(bad), bad);
});

test("every quest's reference proof replays to done, using only earlier quests", () => {
  Q.QUESTS.forEach((q, i) => {
    const g = L.replay(q, Q.machinesFor(i, allDone(i)), q.proof);
    assert.ok(g.root.done, q.id);
    assert.ok(Q.par(q) >= 1 && Q.par(q) <= 12, q.id + " par");
    for (let k = 0; k < q.proof.length; k++) assert.ok(!L.replay(q, Q.machinesFor(i, allDone(i)), q.proof.slice(0, k)).root.done, q.id + " done early");
  });
});

test("a quest cannot use itself or later quests, or quests not yet finished", () => {
  const i = idx("comm"), own = fresh(i);
  L.step(own, { op: "refl", at: "", t: "a+b" });
  for (const m of ["comm", "assoc"]) assert.throws(() => L.step(own, { op: "rw", at: "", b: 0, path: [1], m, dir: "lr" }), /don't have/);
  const g = L.start(Q.QUESTS[i], Q.machinesFor(i, new Set()));
  L.step(g, { op: "refl", at: "", t: "a" });
  assert.throws(() => L.step(g, { op: "rw", at: "", b: 0, path: [1], m: "zadd", dir: "rl" }), /don't have/);
});

test("the induction hypothesis is a fact about one number, not a machine", () => {
  const g = fresh(idx("zadd"));
  L.step(g, { op: "induct", at: "", v: "a" });
  L.step(g, { op: "refl", at: "s", t: "0+S(a)" });
  // 0+S(a) is not literally 0+a, so the hypothesis must not fit (a slot would match)
  assert.throws(() => L.step(g, { op: "rw", at: "s", b: 0, path: [1], m: "h0", dir: "lr" }), /doesn't fit/);
  // and the base workshop has no hypothesis at all
  L.step(g, { op: "refl", at: "b", t: "0+0" });
  assert.throws(() => L.step(g, { op: "rw", at: "b", b: 0, path: [1], m: "h0", dir: "lr" }), /no such hypothesis/);
  assert.throws(() => L.step(g, { op: "hyp", at: "b", i: 0 }));
  // a block made from the hypothesis is tagged with it
  L.step(g, { op: "hyp", at: "s", i: 0 });
  assert.deepEqual(L.ctxAt(g, "s").bench[1].deps, [0]);
  assert.ok(!g.root.done);
});

test("induction is refused where it would be unsound", () => {
  const sym = fresh(idx("sym"));
  assert.throws(() => L.step(sym, { op: "induct", at: "", v: "a" }), /don't have/);
  const g = fresh(idx("comm"));
  assert.throws(() => L.step(g, { op: "induct", at: "", v: "z" }), /isn't in the goal/);
  L.step(g, { op: "induct", at: "", v: "b" });
  assert.throws(() => L.step(g, { op: "induct", at: "", v: "a" }), /already split/);
  // inside the step, the hypothesis mentions a and b, so neither can vary any more
  assert.throws(() => L.step(g, { op: "induct", at: "s", v: "a" }), /can't vary/);
  // the base case has no hypothesis: a nested induction on a is fine there
  L.step(g, { op: "induct", at: "b", v: "a" });
  assert.equal(L.show(L.ctxAt(g, "bs").goal), "S(a)+0 = 0+S(a)");
  assert.equal(L.show(L.ctxAt(g, "bs").hyps[0]), "a+0 = 0+a");
});

test("other refusals", () => {
  const g = fresh(idx("zz"));
  assert.throws(() => L.step(g, { op: "refl", at: "", t: "a" }), /no number called a/);
  assert.throws(() => L.step(g, { op: "refl", at: "", t: "0=0" }), /not an equation/);
  L.step(g, { op: "refl", at: "", t: "0+0" });
  assert.throws(() => L.step(g, { op: "rw", at: "", b: 0, path: [], m: "add0", dir: "lr" }), /pick a part/);
  assert.throws(() => L.step(g, { op: "rw", at: "", b: 0, path: [1, 0], m: "add0", dir: "lr" }), /doesn't fit/);
  assert.throws(() => L.step(g, { op: "rw", at: "", b: 3, path: [1], m: "add0", dir: "lr" }), /no such block/);
  assert.throws(() => L.step(g, { op: "stamp", at: "", m: "add0" }), /needs inputs/);
  assert.equal(g.steps.length, 1, "refused steps are not recorded");
});

test("symmetry and transitivity work as rules once crafted", () => {
  const i = idx("zadd"), g = fresh(i);
  L.step(g, { op: "refl", at: "", t: "0+0" });
  L.step(g, { op: "rw", at: "", b: 0, path: [1], m: "add0", dir: "lr" });      // 0+0 = 0
  L.step(g, { op: "dup", at: "", b: 0 });
  L.step(g, { op: "rule", at: "", b: 1, m: "sym" });                             // 0 = 0+0
  assert.equal(L.show(g.root.bench[1].s), "0 = 0+0");
  L.step(g, { op: "rule", at: "", b: 0, m: "trans", others: [1] });              // 0+0 = 0+0
  assert.equal(L.show(g.root.bench[0].s), "0+0 = 0+0");
  assert.throws(() => L.step(g, { op: "rule", at: "", b: 0, m: "trans", others: [0] }));
  assert.equal(L.count(g.steps), 4, "dup is free");
  assert.ok(L.options(g, "", 0, []).every(o => o.rule && o.rule.id !== "sym"), "sym on t = t changes nothing, so it isn't offered");
  assert.ok(L.options(g, "", 1, []).some(o => o.rule.id === "sym"), "rules are offered on the whole block");
  assert.ok(L.options(g, "", 1, [1]).every(o => !o.rule), "and not on a part");
  assert.deepEqual(L.fits(g, "", "sym"), [{ b: 1, path: [] }]);
});

test("make puts a machine's statement on the bench with its slots filled", () => {
  const i = idx("comm"), g = fresh(i);
  L.step(g, { op: "make", at: "", m: "zadd", fill: { a: "S(b)+a" } });
  assert.equal(L.show(g.root.bench[0].s), "0+(S(b)+a) = S(b)+a");
  L.step(g, { op: "make", at: "", m: "addS", fill: { a: "b", b: "a" } });       // simultaneous, not one after the other
  assert.equal(L.show(g.root.bench[1].s), "b+S(a) = S(b+a)");
  assert.throws(() => L.step(g, { op: "make", at: "", m: "addS", fill: { a: "b" } }), /give a term for b/);
  assert.throws(() => L.step(g, { op: "make", at: "", m: "zadd", fill: { a: "z" } }), /no number called z/);
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
  const o = L.options(g, "", 0, [1]);
  assert.deepEqual(o.map(x => !!x.loose), [false, true]);
});

test("playground machines follow progress", () => {
  const ids = d => Q.playMachines(new Set(d)).map(m => m.id);
  assert.deepEqual(ids([]), ["add0", "addS"]);
  assert.deepEqual(ids(["refl0", "zz", "sym"]), ["add0", "addS", "refl0", "zz", "sym"]);
  assert.ok(ids(["refl0", "zz", "sym", "trans"]).includes("induct"));
});

test("random play only ever makes true statements", () => {
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const paths = (t, p = [], out = []) => { if (p.length) out.push(p); (t[0] === "v" || t[0] === "0" ? [] : t.slice(1)).forEach((k, i) => paths(k, [...p, i], out)); return out; };
  const size = t => (t[0] === "v" || t[0] === "0" ? 1 : 1 + t.slice(1).reduce((a, k) => a + size(k), 0));
  let checked = 0;
  Q.QUESTS.forEach((q, i) => {
    const equal = !!q.given;                       // sym/trans: the givens only hold when the numbers are equal
    for (let run = 0; run < 40; run++) {
      const g = fresh(i);
      const leaves = () => { const out = []; (function walk(c, at) { out.push(at); if (c.kids) { walk(c.kids.base, at + "b"); walk(c.kids.step, at + "s"); } })(g.root, ""); return out; };
      for (let move = 0; move < 30; move++) {
        const ws = leaves(), at = ws[rnd(ws.length)], c = L.ctxAt(g, at);
        const r = rnd(10);
        try {
          if (r === 0 && !c.kids) L.step(g, { op: "induct", at, v: [...g.names][rnd(g.names.size)] });
          else if (r === 1 && c.hyps.length) L.step(g, { op: "hyp", at, i: rnd(c.hyps.length) });
          else if (r <= 3 || !c.bench.length) { const side = c.goal[1 + rnd(2)]; L.step(g, { op: "refl", at, t: side }); }
          else {
            const b = rnd(c.bench.length);
            if (size(c.bench[b].s) > 40) { L.step(g, { op: "del", at, b }); continue; }
            const ps = [[], ...paths(c.bench[b].s)], o = L.options(g, at, b, ps[rnd(ps.length)]);
            if (o.length) L.step(g, o[rnd(o.length)].step);
          }
        } catch (e) { /* refused moves are fine; unsound ones are what we're hunting */ }
        for (const w of leaves()) for (const blk of L.ctxAt(g, w).bench) for (let k = 0; k < 4; k++) {
          const x = rnd(6), env = {}; for (const v of g.names) env[v] = equal ? x : rnd(6);
          assert.ok(L.holds(blk.s, env), `${q.id}: false block ${L.show(blk.s)} at ${JSON.stringify(env)}`);
          checked++;
        }
      }
    }
  });
  assert.ok(checked > 10000);
});
