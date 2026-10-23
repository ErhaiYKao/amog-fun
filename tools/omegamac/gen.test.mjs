// node --test tools/omegamac/gen.test.mjs — every generated answer re-checked by brute force, bounds, URL codec, smart picker
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/omegamac/gen.js";
const O = globalThis.Omegamac;

// ---- brute force, written independently of gen.js ----
const euclid = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const isPrime = n => { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
const primeList = n => { const out = []; for (let d = 2, m = n; m > 1; d++) while (m % d === 0) { out.push(d); m /= d; } return out; }; // smallest divisor first, so each d pushed is prime
const big = (f, ...a) => Number(f(...a.map(BigInt)));
const factB = n => { let r = 1n; for (let i = 1n; i <= n; i++) r *= i; return r; };
const pascal = (n, k) => { let row = [1n]; for (let i = 0; i < n; i++) row = [1n, ...row.slice(1).map((x, j) => x + row[j]), 1n]; return k >= 0 && k <= n ? row[k] : 0n; };
const BRUTE = {
  add: ([a, b]) => a + b,
  sub: ([s, a]) => s - a,
  mul: ([a, b]) => big((x, y) => x * y, a, b),
  div: ([s, a]) => { for (let q = 0; ; q++) if (q * a === s) return q; },
  sq: ([n]) => big(x => x * x, n),
  cube: ([n]) => big(x => x * x * x, n),
  sqrt: ([x]) => { for (let r = 0; ; r++) if (r * r === x) return r; },
  cbrt: ([x]) => { for (let r = 0; ; r++) if (r * r * r === x) return r; },
  pow: ([b, e]) => big((x, y) => x ** y, b, e),
  log: ([b, x]) => { for (let e = 0n; ; e++) if (BigInt(b) ** e === BigInt(x)) return Number(e); },
  phi: ([n]) => { let c = 0; for (let k = 1; k <= n; k++) if (euclid(k, n) === 1) c++; return c; },
  bigomega: ([n]) => primeList(n).length,
  omega: ([n]) => new Set(primeList(n)).size,
  sopfr: ([n]) => primeList(n).reduce((a, p) => a + p, 0),
  sopf: ([n]) => [...new Set(primeList(n))].reduce((a, p) => a + p, 0),
  gcd: ([a, b]) => { for (let d = Math.min(a, b); d >= 1; d--) if (a % d === 0 && b % d === 0) return d; },
  lcm: ([a, b]) => { const m = Math.max(a, b); for (let x = m; ; x += m) if (x % a === 0 && x % b === 0) return x; },
  fact: ([n]) => Number(factB(BigInt(n))),
  perm: ([n, k]) => Number(factB(BigInt(n)) / factB(BigInt(n - k))),
  comb: ([n, k]) => Number(pascal(n, k)),
  der: ([n]) => { let s = 0n; const f = factB(BigInt(n)); for (let k = 0n; k <= BigInt(n); k++) s += (k % 2n ? -1n : 1n) * f / factB(k); return Number(s); },
};
const inR = (x, lo, hi) => x >= lo && x <= hi;
// operands within the type's bounds (and caps)
const BOUNDS = {
  add: (p, [a, b]) => inR(a, p[0], p[1]) && inR(b, p[2], p[3]),
  sub: (p, [s, a], ans) => inR(a, p[0], p[1]) && inR(ans, p[2], p[3]) && s === a + ans,
  mul: (p, [a, b]) => inR(a, p[0], p[1]) && inR(b, p[2], p[3]),
  div: (p, [s, a], ans) => inR(a, p[0], p[1]) && a > 0 && inR(ans, p[2], p[3]) && s === a * ans,
  sq: (p, [n]) => inR(n, p[0], p[1]), cube: (p, [n]) => inR(n, p[0], p[1]),
  sqrt: (p, _, ans) => inR(ans, p[0], p[1]), cbrt: (p, _, ans) => inR(ans, p[0], p[1]),
  pow: (p, [b, e], ans) => inR(b, p[0], p[1]) && inR(e, p[2], p[3]) && ans <= p[4],
  log: (p, [b, x], ans) => inR(b, p[0], p[1]) && inR(ans, p[2], p[3]) && x <= p[4],
  gcd: (p, [a, b]) => inR(a, p[0], p[1]) && inR(b, p[0], p[1]) && (a !== b || p[0] === p[1]),
  fact: (p, [n]) => inR(n, p[0], p[1]), der: (p, [n]) => inR(n, p[0], p[1]),
  perm: (p, [n, k], ans) => inR(n, p[0], p[1]) && inR(k, p[2], p[3]) && k <= n && ans <= p[4],
};
for (const id of ["phi", "bigomega", "omega", "sopfr", "sopf"]) BOUNDS[id] = (p, [n]) => inR(n, p[0], p[1]);
BOUNDS.lcm = BOUNDS.gcd; BOUNDS.comb = BOUNDS.perm;

// keep random bounds small enough for the brute force
const LIM = { phi: 3000, bigomega: 20000, omega: 20000, sopfr: 20000, sopf: 20000, gcd: 3000, lcm: 300, div: 1000, sqrt: 1000, cbrt: 300, pow: 200, log: 200 };
function randomParams(t, rng) {
  const lim = LIM[t.id] ?? 1e6, p = [];
  for (const f of t.f) {
    const top = Math.min(f.max, lim), r = () => f.min + Math.floor(rng() ** 3 * (top - f.min + 1));
    if ("v" in f) p.push(rng() < 0.5 ? f.v : Math.round(10 ** (rng() * 12))); else p.push(r(), r());
  }
  return p;
}

test("every type: answers match brute force, bounds respected, answers are safe integers", () => {
  const rng = O.mulberry32(19);
  for (const t of O.TYPES) {
    let made = 0;
    for (let trial = 0; trial < 60; trial++) {
      const s = O.defaults([t.id]);
      if (trial) s.t[t.id].p = randomParams(t, rng);
      const norm = O.normalize(s), p = norm.t[t.id].p;
      for (let i = 0; i < 40; i++) {
        const pr = O.next(norm, rng);
        if (!pr) { assert.ok(trial > 0, `${t.id}: defaults must be feasible`); break; }
        made++;
        assert.equal(pr.type, t.id);
        assert.ok(Number.isSafeInteger(pr.answer) && pr.answer >= 0, `${t.id} answer ${pr.answer}`);
        assert.equal(pr.answer, BRUTE[t.id](pr.args), `${t.id} ${pr.plain} [${p}]`);
        assert.ok(BOUNDS[t.id](p, pr.args, pr.answer), `${t.id} out of bounds: ${pr.plain} = ${pr.answer} with [${p}]`);
        assert.ok(O.check(pr, ` ${pr.answer} `) && !O.check(pr, pr.answer + 1));
      }
    }
    assert.ok(made > 500, `${t.id}: only ${made} problems`);
  }
});

test("capped types skip infeasible bounds instead of breaking them", () => {
  const s = O.defaults(["pow", "add"]);
  s.t.pow.p = [10, 20, 5, 9, 100]; // 10^5 > 100
  assert.equal(O.feasible(s, "pow"), false);
  const rng = O.mulberry32(1);
  for (let i = 0; i < 50; i++) assert.equal(O.next(s, rng).type, "add");
  s.t.add.on = false;
  assert.equal(O.next(s, rng), null);
  const c = O.defaults(["comb"]); c.t.comb.p = [2, 3, 5, 9, 1e6]; // k > n always
  assert.equal(O.next(c, rng), null);
});

test("no immediate repeats", () => {
  const s = O.presetSettings("everything"), rng = O.mulberry32(7);
  let prev = null;
  for (let i = 0; i < 3000; i++) { const pr = O.next(s, rng, prev); assert.notEqual(pr.tex, prev?.tex); prev = pr; }
});

test("URL encode/decode round-trips", () => {
  const rng = O.mulberry32(3);
  for (const pr of O.PRESETS) {
    const s = O.presetSettings(pr.id);
    assert.deepEqual(O.decode(O.encode(s)).settings, s);
    assert.equal(O.typesKey(s), pr.key);
  }
  assert.equal(O.encode(O.presetSettings("basic")), "d=120&add&sub&mul&div");
  for (let i = 0; i < 300; i++) {
    const s = O.defaults();
    s.d = O.DURATIONS[i % O.DURATIONS.length];
    for (const t of O.TYPES) if (rng() < 0.4) { s.t[t.id].on = true; if (rng() < 0.5) s.t[t.id].p = randomParams(t, rng); }
    if (!O.TYPES.some(t => s.t[t.id].on)) s.t.add.on = true;
    const n = O.normalize(s), name = i % 3 ? "" : `Amog's #${i} & co + friends`;
    const enc = O.encode(n, name), back = O.decode("#" + enc);
    assert.deepEqual(back.settings, n, enc);
    assert.equal(back.name, name);
    assert.equal(O.encode(back.settings, back.name), enc);
    assert.ok(!/[\s#?]/.test(enc), enc);
  }
  assert.equal(O.decode(""), null);
  assert.equal(O.decode("#d=60&bogus=1-2"), null);
  // garbage is clamped, not trusted
  const g = O.decode("d=99999&mul=-5-x-3&fact=0-500").settings;
  assert.equal(g.d, 3600);
  assert.deepEqual(g.t.fact.p, [0, 18]);
  assert.ok(g.t.mul.p.every(Number.isFinite));
});

test("smart picker prefers many divisors but still picks primes", () => {
  const rng = O.mulberry32(42), d = O.divisorCounts(1000), N = 40000;
  let smartD = 0, uniD = 0, smartP = 0, uniP = 0;
  for (let n = 2; n <= 1000; n++) { uniD += d[n] / 999; uniP += isPrime(n) / 999; }
  const seen = new Set();
  for (let i = 0; i < N; i++) { const n = O.pickSmart(2, 1000, rng); assert.ok(inR(n, 2, 1000)); smartD += d[n] / N; smartP += isPrime(n) / N; seen.add(n); }
  console.log(`d(n) on [2, 1000]: smart mean ${smartD.toFixed(2)} vs uniform ${uniD.toFixed(2)}; primes: smart ${(100 * smartP).toFixed(1)}% vs uniform ${(100 * uniP).toFixed(1)}%`);
  assert.ok(smartD > 1.6 * uniD, `mean d(n): smart ${smartD.toFixed(2)} vs uniform ${uniD.toFixed(2)}`);
  assert.ok(smartP > 0.01 && smartP < uniP / 2, `primes: smart ${smartP.toFixed(3)} vs uniform ${uniP.toFixed(3)}`);
  assert.ok(seen.size > 900, `only ${seen.size} distinct values`);

  let smartG = 0, uniG = 0, coprime = 0;
  for (let i = 0; i < N; i++) {
    const [a, b] = O.pickPair(2, 200, rng);
    assert.ok(inR(a, 2, 200) && inR(b, 2, 200) && a !== b);
    const g = euclid(a, b); smartG += g / N; if (g === 1) coprime++;
    uniG += euclid(2 + Math.floor(rng() * 199), 2 + Math.floor(rng() * 199)) / N;
  }
  console.log(`gcd on [2, 200]: smart mean ${smartG.toFixed(2)} vs uniform ${uniG.toFixed(2)}; coprime ${(100 * coprime / N).toFixed(1)}%`);
  assert.ok(smartG > 3 * uniG, `mean gcd: smart ${smartG.toFixed(2)} vs uniform ${uniG.toFixed(2)}`);
  assert.ok(coprime / N > 0.03 && coprime / N < 0.3, `coprime share ${coprime / N}`);
});

test("number theory spot checks", () => {
  const { phi, bigOmega, omega, sopfr, sopf, derange, choose, perm } = O.nt;
  assert.deepEqual([phi(1), phi(12), phi(97), phi(100)], [1, 4, 96, 40]);
  assert.deepEqual([bigOmega(12), omega(12), sopfr(12), sopf(12)], [3, 2, 7, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(derange), [1, 0, 1, 2, 9, 44]);
  assert.equal(derange(18), 2355301661033953); assert.ok(Number.isSafeInteger(derange(18)));
  assert.equal(choose(10, 5), 252); assert.equal(perm(10, 3), 720);
});
