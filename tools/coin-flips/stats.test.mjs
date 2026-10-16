// node --test tools/coin-flips/stats.test.mjs — exact tails checked against brute-force enumeration
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/coin-flips/stats.js";
const C = globalThis.CoinFlips;

const all = n => Array.from({ length: 1 << n }, (_, m) => Array.from({ length: n }, (_, i) => (m >> i) & 1));
const brute = (n, fn, x) => { let ge = 0, le = 0; for (const f of all(n)) { const v = fn(f); if (v >= x) ge++; if (v <= x) le++; } return { ge: ge / 2 ** n, le: le / 2 ** n }; };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} vs ${b}`);

test("exact tests match enumeration for n = 1..12", () => {
  for (let n = 1; n <= 12; n++) for (const f of all(n).filter((_, i) => i % 7 === 0 || n < 5)) {
    const res = C.analyse(f, { sims: 10 });
    const fns = {
      heads: g => g.reduce((a, v) => a + v, 0), runs: C.runCount, run: g => C.longestRun(g),
      runH: g => C.longestRun(g, 1), runT: g => C.longestRun(g, 0), alt: C.longestAlternating, lead: C.maxLead,
    };
    for (const r of res.filter(r => !r.sim)) {
      const b = brute(n, fns[r.id], r.x);
      close(r.ge, b.ge, `${r.id} >= n=${n} ${f.join("")}`);
      close(r.le, b.le, `${r.id} <= n=${n} ${f.join("")}`);
    }
  }
});

test("statistics", () => {
  const f = C.parse("HHTHTHHHT tt");
  assert.deepEqual(f, [1,1,0,1,0,1,1,1,0,0,0]);
  assert.equal(C.longestRun(f), 3); assert.equal(C.longestRun(f, 0), 3); assert.equal(C.longestAlternating(f), 5);
  assert.equal(C.runCount(f), 6); assert.equal(C.maxLead(f), 4);
  assert.equal(C.longestPalindrome(C.parse("TTHTHHTHT")), 8);
  assert.equal(C.distinctBlocks(C.parse("HHHH"), 3), 1);
});

test("tiny p-values keep precision", () => {
  const r = C.analyse(C.parse("H".repeat(200)), { sims: 50 });
  const run = r.find(x => x.id === "run");
  close(run.ge, 2 ** -199, "200 heads in a row"); // only HHH.. and TTT..
  assert.ok(r.find(x => x.id === "heads").ge > 0 && r.find(x => x.id === "heads").ge < 1e-59);
});

test("simulated tails are seeded and sane", () => {
  const f = C.parse("HTHHTTHTHHHTTHTHTTHHTHTHHTTTHHTHTHTHHTHTTHTH");
  const a = C.analyse(f, { sims: 2000 }), b = C.analyse(f, { sims: 2000 });
  assert.deepEqual(a, b);
  for (const r of a) assert.ok(r.ge + r.le >= 1 - 1e-9, r.id); // the two tails overlap at x
});

test("where each stretch is", () => {
  const f = C.parse("THHHTHTHTTHTHHT");
  assert.deepEqual(C.where(f, "run"), [1, 3]);
  assert.deepEqual(C.where(f, "runT"), [8, 2]);
  assert.deepEqual(C.where(f, "alt"), [3, 6]);
  const [a, l] = C.where(f, "pal");
  assert.equal(l, C.longestPalindrome(f));
  const s = f.slice(a, a + l); assert.deepEqual(s, [...s].reverse());
});
