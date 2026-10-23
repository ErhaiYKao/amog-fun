// node --test tools/coefficient-game/ring.test.mjs — rings, root tests, rules and computer Amog
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/coefficient-game/ring.js";
import "../../public/coefficient-game/amog.js";
const G = globalThis.CoeffGame, A = globalThis.CoeffAmog;

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FINITE = ["Z/2", "Z/6", "Z/9", "F_4", "F_8", "F_9", "F_16", "F_25", "Z/4[t]/(t^2)", "Z/3[i]", "Z/2[s]/(s^3+s)", "Z/2 × Z/3", "Z/2 × F_4", "Z/3 × Z/3"];

test("finite rings satisfy the commutative ring axioms", () => {
  for (const spec of FINITE) {
    const r = G.parseRing(spec), N = r.size, E = [...Array(N).keys()];
    for (const a of E) {
      assert.equal(r.add(a, 0), a, spec); assert.equal(r.mul(a, r.one), a, spec); assert.equal(r.add(a, r.neg(a)), 0, spec);
      for (const b of E) {
        assert.equal(r.add(a, b), r.add(b, a), spec); assert.equal(r.mul(a, b), r.mul(b, a), spec);
        if (N <= 16) for (const c of E) {
          assert.equal(r.mul(r.mul(a, b), c), r.mul(a, r.mul(b, c)), spec);
          assert.equal(r.mul(a, r.add(b, c)), r.add(r.mul(a, b), r.mul(a, c)), spec);
          assert.equal(r.add(r.add(a, b), c), r.add(a, r.add(b, c)), spec);
        }
      }
    }
  }
});

test("F_q is a field of size q, Z/n[i] is one exactly when -1 isn't a square", () => {
  for (const q of [4, 8, 9, 16, 25, 27, 32, 49, 64, 81, 121, 125, 128, 243, 256, 343, 729, 1024, 2048, 2187, 4096]) {
    const r = G.parseRing(`F_${q}`);
    assert.equal(r.size, q);
    if (q <= 256) for (let a = 1; a < q; a++) assert.ok(r.inv(a) != null, `F_${q}: ${r.show(a)} has no inverse`);
  }
  const unitsAll = r => [...Array(r.size).keys()].slice(1).every(a => r.inv(a) != null);
  assert.ok(unitsAll(G.parseRing("Z/3[i]"))); assert.ok(unitsAll(G.parseRing("Z/7[i]")));
  assert.ok(!unitsAll(G.parseRing("Z/5[i]"))); assert.ok(!unitsAll(G.parseRing("Z/4[t]/(t^2)")));
  assert.throws(() => G.parseRing("F_6"), /prime power/);
  assert.throws(() => G.parseRing("Z/3[x]/(x^2+1)"), /variable/);
  assert.throws(() => G.parseRing("Z/4[t]/(2t^2+1)"), /unit/);
  assert.throws(() => G.parseRing("Z/101[t]/(t^2+1)"), /limit/);
});

test("elements print in a form that parses back", () => {
  const rng = mulberry(3);
  for (const spec of FINITE.concat(["Z/99991", "F_3125"])) {
    const r = G.parseRing(spec);
    for (let i = 0; i < 200; i++) { const a = r.random(rng); assert.equal(r.parse(r.show(a)), a, `${spec}: ${r.show(a)}`); }
  }
  for (const spec of ["Z", "Q", "R", "C", "Z × Q"]) {
    const r = G.parseRing(spec);
    for (const t of ["0", "7", "-12", "3/4", "-1/2", "2i", "1/2-3i/4", "-i", "10^20", "(2, 1/3)", "1.25", "2e-3"]) {
      let a; try { a = r.parse(t); } catch { continue; }
      assert.ok(r.eq(r.parse(r.show(a)), a), `${spec}: ${t} -> ${r.show(a)}`);
    }
  }
  const F = G.parseRing("F_4"), a = F.parse("a");
  assert.equal(F.mul(a, a), F.parse("a+1")); assert.equal(F.parse("α^3"), 1);
  const C = G.parseRing("C");
  assert.equal(C.show(C.parse("(1+i)^2")), "2i"); assert.equal(C.show(C.parse("1/(1+i)")), "1/2-i/2");
  assert.equal(G.parseRing("Z/2 x Z/3").show(G.parseRing("Z/2 x Z/3").parse("5")), "(1, 2)");
  assert.equal(G.parseRing("Z/7").show(G.parseRing("Z/7").parse("3/5")), "2");
});

test("finite root tests: a reported root is one, and no root means p(x) ≠ 0 everywhere", () => {
  const rng = mulberry(11);
  for (const spec of FINITE) {
    const r = G.parseRing(spec);
    for (let i = 0; i < 300; i++) {
      const d = 2 + Math.floor(rng() * 4), c = Array.from({ length: d + 1 }, () => r.random(rng));
      const x = r.root(c), ev = y => { let acc = 0, p = r.one; for (const a of c) { acc = r.add(acc, r.mul(a, p)); p = r.mul(p, y); } return acc; };
      if (x) assert.equal(ev(x.el), 0, spec);
      else for (let y = 0; y < r.size; y++) assert.notEqual(ev(y), 0, spec);
    }
  }
});

test("Z and Q: rational roots match the rational root theorem by brute force", () => {
  const rng = mulberry(5), Z = G.parseRing("Z"), Q = G.parseRing("Q");
  const divs = n => { n = Math.abs(n); const r = []; for (let i = 1; i <= n; i++) if (n % i === 0) r.push(i); return r; };
  for (let i = 0; i < 400; i++) {
    const d = 2 + Math.floor(rng() * 5), c = Array.from({ length: d + 1 }, () => Math.floor(rng() * 13) - 6);
    if (!c[0]) c[0] = 1; if (!c[d]) c[d] = -2;
    if (i % 4 === 0) { // plant a root
      const p = Math.floor(rng() * 7) - 3 || 1, q = 1 + Math.floor(rng() * 3), lin = [-p, q];
      const b = c.slice(0, d); const m = new Array(d + 1).fill(0); b.forEach((x, j) => { m[j] += x * lin[0]; m[j + 1] += x * lin[1]; });
      c.splice(0, c.length, ...m); if (!c[0] || !c[d]) continue;
    }
    let ratRoot = false, intRoot = false;
    for (const p of divs(c[0])) for (const q of divs(c[d])) for (const s of [1, -1]) {
      // evaluate exactly: Σ c_k (sp)^k q^(d-k)
      const v = c.reduce((acc, ck, k) => acc + BigInt(ck) * BigInt(s * p) ** BigInt(k) * BigInt(q) ** BigInt(d - k), 0n);
      if (v === 0n) { ratRoot = true; if (q === 1) intRoot = true; }
    }
    const big = c.map(BigInt);
    assert.equal(!!Z.root(big), intRoot, `Z ${c}`);
    assert.equal(!!Q.root(c.map(x => [BigInt(x), 1n])), ratRoot, `Q ${c}`);
  }
  // roots with big denominators and huge coefficients
  const q = ts => ts.map(t => Q.parse(t));
  assert.equal(Q.root(q(["-1000003", "0", "0", "1000003^2"])), null);   // x^3 = 1/1000003
  assert.equal(Q.root(q(["-1000", "0", "0", "343"])).show, "10/7");
  assert.equal(Q.root(q(["-2", "0", "1"])), null);
  assert.equal(Q.root(["-9/4", "0", "1"].map(t => Q.parse(t))).show.replace("-", ""), "3/2");
  assert.equal(Q.root(["-1", "0", "10^30"].map(t => Q.parse(t))).show.replace("-", ""), "1/1000000000000000");
  assert.equal(Z.root([1n, 0n, -1n, 5n]), null); // 5x^3 - x^2 + 1: only ±1 could be integer roots
  assert.equal(Z.root([-6n, 11n, -6n, 1n]).el > 0n, true);
});

test("R: Sturm root counts agree with sign changes and known cases", () => {
  const R = G.parseRing("R"), p = ts => ts.map(t => R.parse(t));
  assert.equal(R.root(p(["2", "0", "1"])), null);
  assert.ok(R.root(p(["-2", "0", "1"])).approx);
  assert.equal(R.root(p(["1", "-2", "1"])).show, "1");                     // double root (x-1)^2
  assert.equal(R.root(p(["1/10^12", "-2", "1"])) !== null, true);           // just below the axis
  assert.equal(R.root(p(["1", "0", "0", "0", "1"])), null);                 // x^4 + 1
  assert.ok(R.root(p(["1", "0", "-10^6", "0", "1"])));
  assert.equal(R.root(p(["4", "-4", "1"])).show, "2");                      // (x-2)^2 touches
  assert.equal(R.root(p(["4", "-4", "1", "0", "0", "0", "1"])), null);      // x^6 + (x-2)^2 > 0
  const rng = mulberry(9);
  for (let i = 0; i < 300; i++) { // random polynomials: a sign change on a fine grid means a root; Sturm must agree
    const d = 2 + Math.floor(rng() * 5), c = Array.from({ length: d + 1 }, () => Math.floor(rng() * 21) - 10);
    if (!c[0]) c[0] = 3; if (!c[d]) c[d] = 1;
    const f = x => c.reduce((a, ck, k) => a + ck * x ** k, 0);
    let change = d % 2 === 1;
    for (let x = -30; x < 30 && !change; x += 0.001) if (Math.sign(f(x)) !== Math.sign(f(x + 0.001))) change = true;
    const r = R.root(c.map(x => [BigInt(x), 1n]));
    if (change) assert.ok(r, `R ${c}`);
    if (!r) assert.ok(!change, `R ${c}`);
  }
});

test("rules: turns alternate, ends are nonzero, the winner is decided by a root", () => {
  const r = G.parseRing("Z/6"), g = G.newGame(2, "S");
  assert.equal(G.moveError(r, g, 0, 0), "the constant term can't be 0");
  assert.equal(G.moveError(r, g, 2, 0), "the leading coefficient can't be 0");
  assert.equal(G.moveError(r, g, 1, 0), null);
  G.play(r, g, 1, 0); assert.equal(g.turn, "A");
  assert.throws(() => G.play(r, g, 1, 2), /already/);
  G.play(r, g, 2, 1); G.play(r, g, 0, 1); // x^2 + 1 over Z/6: squares are 0,1,3,4 → no x^2 = 5
  assert.equal(g.winner, "S");
  const h = G.newGame(2); G.play(r, h, 0, 5); G.play(r, h, 1, 0); G.play(r, h, 2, 1); // x^2 - 1
  assert.equal(h.winner, "A"); assert.equal(r.evalAt(h.c, h.root.el), 0);
  assert.throws(() => G.newGame(1), /degree/);
});

// an independent minimax: plain recursion over complete polynomials
function brute(r, g) {
  const go = (c, turn) => {
    const u = c.map((v, k) => (v === null ? k : -1)).filter(k => k >= 0);
    if (!u.length) return r.root(c) ? "A" : "S";
    for (const k of u) for (let v = (k === 0 || k === g.d) ? 1 : 0; v < r.size; v++) {
      const cc = c.slice(); cc[k] = v;
      if (go(cc, turn === "A" ? "S" : "A") === turn) return turn;
    }
    return turn === "A" ? "S" : "A";
  };
  return go(g.c.slice(), g.turn);
}

test("Amog's solver agrees with brute-force minimax", () => {
  for (const [spec, d] of [["Z/2", 2], ["Z/2", 3], ["Z/2", 4], ["Z/3", 2], ["Z/3", 3], ["Z/4", 2], ["Z/4", 3], ["Z/5", 2], ["Z/6", 2], ["F_4", 2], ["F_4", 3], ["Z/2 × Z/2", 2], ["Z/2 × Z/2", 3], ["Z/2[t]/(t^2)", 3], ["Z/7", 2], ["Z/8", 2], ["Z/9", 2], ["Z/3[i]", 2]]) {
    for (const first of ["A", "S"]) {
      const r = G.parseRing(spec), g = G.newGame(d, first);
      assert.equal(A.verdict(r, g).winner, brute(r, g), `${spec} d=${d} first=${first}`);
    }
  }
  // and from random midgame positions
  const rng = mulberry(21);
  for (let i = 0; i < 60; i++) {
    const spec = ["Z/5", "Z/6", "F_4", "Z/8", "Z/2 × Z/3"][i % 5], r = G.parseRing(spec), d = 3, g = G.newGame(d, i % 2 ? "A" : "S");
    for (let m = 0; m < 2; m++) { const u = G.unset(g), k = u[Math.floor(rng() * u.length)]; G.play(r, g, k, 1 + Math.floor(rng() * (r.size - 1))); }
    assert.equal(A.verdict(r, g).winner, brute(r, g), `${spec} ${g.c}`);
  }
});

test("Amog's moves are legal, and winning when the position is a win", () => {
  const rng = mulberry(4);
  for (const spec of ["Z/5", "Z/6", "F_4", "F_9", "Z/2 × Z/3", "Z/4[t]/(t^2)"]) {
    for (let t = 0; t < 6; t++) {
      const r = G.parseRing(spec), g = G.newGame(2 + (t % 2), t < 3 ? "A" : "S");
      while (!g.winner) {
        const before = A.verdict(r, g).winner, side = g.turn, m = A.choose(r, g, { rng });
        assert.equal(G.moveError(r, g, m.k, m.v), null);
        G.play(r, g, m.k, m.v);
        if (before === side) assert.equal(g.winner ? g.winner : A.verdict(r, g).winner, side, `${spec}: Amog threw away a win`);
      }
    }
  }
});

test("last moves: Amog finds roots and dodges them in big and infinite rings", () => {
  const rng = mulberry(8);
  for (const spec of ["Q", "R", "Z", "Z/99991", "Z/1000", "F_3125", "Z/2 × Q", "Z/97 × Z/89"]) {
    const r = G.parseRing(spec);
    for (let i = 0; i < 25; i++) {
      const d = 2 + (i % 4), c = Array.from({ length: d + 1 }, () => { const v = A.samples(r, rng, 9); return v[Math.floor(rng() * v.length)]; });
      if (r.isZero(c[0])) c[0] = r.one; if (r.isZero(c[d])) c[d] = r.one;
      const k = i % (d + 1); c[k] = null;
      for (const want of [true, false]) {
        const v = A.lastMove(r, c, k, want, rng);
        if (v == null) continue;
        const cc = c.slice(); cc[k] = v;
        assert.ok(!((k === 0 || k === d) && r.isZero(v)), `${spec}: illegal zero`);
        assert.equal(!!r.root(cc), want, `${spec} want=${want} k=${k}`);
      }
      // over Q the last mover always wins
      if (spec === "Q") { assert.ok(A.lastMove(r, c, k, true, rng) != null); assert.ok(A.lastMove(r, c, k, false, rng) != null); }
    }
  }
  // the Z trap: a_d last, a_0 = 1 and p(±1) = 0 apart from the leading term means no integer root is possible
  const Z = G.parseRing("Z"), c = [1n, 0n, -1n, null];
  assert.equal(A.lastMove(Z, c, 3, true, rng), null);
});
