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

test("far palindrome tails come from a tight bound, not the simulation floor", () => {
  for (const n of [16, 20]) {
    const counts = new Float64Array(n + 2);
    for (const f of all(n)) counts[C.longestPalindrome(f)]++;
    let ge = 0;
    for (let L = n; L >= 2; L--) {
      ge += counts[L] / 2 ** n; // exact P(longest >= L)
      const u = C.palBound(n, L, 2);
      assert.ok(u >= ge - 1e-15, `bound below truth n=${n} L=${L}`);
      if (u < 0.01) assert.ok(u <= ge * 1.02, `bound loose n=${n} L=${L}: ${u} vs ${ge}`);
    }
  }
  const pal = C.analyse(C.parse("H".repeat(100)), { sims: 50 }).find(r => r.id === "pal");
  assert.ok(pal.bound && pal.ge < 1e-12 && pal.ge > 0, `palindrome of 100: ${pal.ge}`);
});

const allDice = (n, k) => Array.from({ length: k ** n }, (_, m) => Array.from({ length: n }, (_, i) => 1 + Math.floor(m / k ** i) % k));
test("dice: exact tests match enumeration", () => {
  for (const [k, maxN] of [[3, 7], [4, 6], [6, 5]]) for (let n = 1; n <= maxN; n++) {
    const seqs = allDice(n, k);
    const counts = g => { const c = Array(k).fill(0); for (const v of g) c[v - 1]++; return c; };
    const sp = C.spreadScores(k);
    const fns = {
      sum: g => g.reduce((a, v) => a + v, 0), spread: g => g.reduce((a, v) => a + sp.w[v - 1], 0),
      most: g => Math.max(...counts(g)), least: g => Math.min(...counts(g)), rep: C.repeats, run: g => C.longestRun(g), jump: C.jumps,
    };
    for (const f of seqs.filter((_, i) => i % 11 === 0)) {
      for (const r of C.analyseDice(f, k, { sims: 10 }).filter(r => !r.sim)) {
        let ge = 0, le = 0; for (const g of seqs) { const v = fns[r.id](g); if (v >= r.x) ge++; if (v <= r.x) le++; }
        close(r.ge, ge / seqs.length, `d${k} ${r.id} >= ${f.join("")}`);
        close(r.le, le / seqs.length, `d${k} ${r.id} <= ${f.join("")}`);
      }
    }
  }
  assert.deepEqual(C.parseDice("1 2 7 6 0 3", 6), [1, 2, 6, 3]);
});

test("dice: tiny p-values and speed at the length cap", () => {
  const r = C.analyseDice(Array(300).fill(6), 6, { sims: 50 });
  assert.ok(r.find(x => x.id === "sum").ge > 0 && r.find(x => x.id === "sum").ge < 1e-200);
  close(r.find(x => x.id === "run").ge / 6 ** -299, 1, "300 sixes in a row");
  const f = Array.from({ length: C.MAX_DICE }, (_, i) => 1 + (i * 7 + (i >> 3)) % 9);
  const t = Date.now(); C.analyseDice(f, 9); assert.ok(Date.now() - t < 5000, `d9 x ${C.MAX_DICE} took ${Date.now() - t} ms`);
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
