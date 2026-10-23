// node --test tools/fermimac/gen.test.mjs — Fermimac's problems, guess parsing and leaderboard replay
import test from "node:test";
import assert from "node:assert/strict";
import { newRun, LIMITS } from "../../worker/leaderboard.js";
import { game, verifyRun } from "../../worker/fermimac.js";
const F = globalThis.Fermimac;

// odd-only sieve: primes below n
function sieve(n) {
  const comp = new Uint8Array(n >> 1);
  for (let i = 3; i * i < n; i += 2) if (!comp[i >> 1]) for (let j = i * i; j < n; j += 2 * i) comp[j >> 1] = 1;
  return { isPrime: k => k === 2 || (k > 2 && k % 2 === 1 && !comp[k >> 1]), comp };
}

test("π(N) and p_n tables match a sieve", () => {
  const N = 1e8, { comp } = sieve(N + 1);
  const pis = Object.keys(F.PI).map(Number).filter(x => x <= N).sort((a, b) => a - b), nths = Object.keys(F.NTH).map(Number);
  let count = 1, j = 0; // 2 is prime
  const nthSeen = {};
  for (let k = 3; k <= N; k += 2) {
    if (!comp[k >> 1]) { count++; if (F.NTH[count] && !nthSeen[count]) nthSeen[count] = k; }
    while (j < pis.length && pis[j] <= k + 1) { if (pis[j] === k || pis[j] === k + 1) assert.equal(F.PI[pis[j]], count, `π(${pis[j]})`); if (pis[j] <= k + 1) j++; }
  }
  for (const n of nths) assert.equal(F.NTH[n], nthSeen[n], `p_${n}`);
  assert.equal(F.PI[1e9], 50847534); // too big to sieve here; the well-known value
});

test("every math type gives finite positive answers that match independent computation", () => {
  const rng = F.mulberry32(7);
  const exact = {
    exp: s => Math.E ** +s.match(/e\^([\d.]+)/)[1], pow2: s => Math.pow(2, +s.match(/2\^([\d.]+)/)[1]),
    sqrt: s => (+s.slice(1)) ** 0.5, cbrt: s => (+s.slice(1)) ** (1 / 3), ln: s => Math.log(+s.slice(3)),
    mul: s => s.split(" × ").reduce((a, b) => a * b, 1), div: s => { const [a, b] = s.split(" ÷ ").map(Number); return a / b; },
    recip: s => 1 / +s.slice(2), fact: s => { let r = 1n; for (let i = 2n; i <= BigInt(parseInt(s)); i++) r *= i; return Number(r); },
  };
  for (const t of F.MATH) for (let i = 0; i < 300; i++) {
    const p = t.gen(rng);
    assert.ok(Number.isFinite(p.answer) && p.answer > 0, `${t.id} ${p.text} -> ${p.answer}`);
    assert.ok(p.tex && p.text);
    if (exact[t.id]) { const x = exact[t.id](p.text); assert.ok(Math.abs(x / p.answer - 1) < 1e-9, `${t.id} ${p.text}: ${p.answer} vs ${x}`); }
  }
  assert.equal(Math.round(F.harmonic(1e6) * 1e6) / 1e6, 14.392727); // H_1e6 = 14.3927267228...
  assert.ok(Math.abs(F.harmonic(1e5) - (Math.log(1e5) + 0.5772156649 + 1 / 2e5)) < 1e-9);
  assert.equal(F.fib(20), 6765); assert.equal(F.choose(52, 5), 2598960);
});

test("the Fermi bank is sane and a run deals every question before repeating", () => {
  assert.ok(F.FERMI.length >= 100);
  assert.equal(new Set(F.FERMI.map(q => q.text)).size, F.FERMI.length);
  for (const q of F.FERMI) assert.ok(q.answer > 0 && Number.isFinite(q.answer) && q.text.length > 8, q.text);
  const r = F.makeRun("guessr", 42), seen = new Set();
  for (let i = 0; i < F.FERMI.length; i++) seen.add(r.next().text);
  assert.equal(seen.size, F.FERMI.length);
});

test("runs are deterministic per seed", () => {
  for (const p of F.PRESETS) {
    const a = F.makeRun(p.id, 99), b = F.makeRun(p.id, 99), c = F.makeRun(p.id, 100);
    const A = Array.from({ length: 50 }, () => a.next().text), B = Array.from({ length: 50 }, () => b.next().text), Cc = Array.from({ length: 50 }, () => c.next().text);
    assert.deepEqual(A, B); assert.notDeepEqual(A, Cc);
  }
});

test("guesses parse in every common notation", () => {
  const cases = { "4200": 4200, "4,200": 4200, "4.2e3": 4200, "4.2E3": 4200, "4.2×10^3": 4200, "4.2x10^3": 4200, "4.2*10^3": 4200,
    "10^6": 1e6, "4.2k": 4200, "1.5M": 1.5e6, "2bn": 2e9, "3T": 3e12, "1.5 million": 1.5e6, ".5": 0.5, "0.027": 0.027, " 7 ": 7, "2e-3": 0.002 };
  for (const [s, v] of Object.entries(cases)) assert.ok(Math.abs(F.parseGuess(s) / v - 1) < 1e-12, `${s} -> ${F.parseGuess(s)}`);
  for (const s of ["", "abc", "1.2.3", "-5", "4q", "e5"]) assert.ok(Number.isNaN(F.parseGuess(s)), s);
});

test("tolerances, with slack for big answers", () => {
  const p = { answer: 1 }; // slack 1: the plain tolerance
  assert.ok(F.check("feynman", p, "1.099")); assert.ok(F.check("feynman", p, "0.901")); assert.ok(!F.check("feynman", p, "1.11"));
  assert.ok(F.check("sharp", p, "1.019")); assert.ok(!F.check("sharp", p, "1.03"));
  assert.ok(!F.check("feynman", p, "0")); assert.ok(!F.check("feynman", p, "junk"));
  assert.equal(F.slack(0.001), 1); assert.equal(F.slack(1e15), 2); assert.ok(Math.abs(F.slack(5.97e24) - 2.6517) < 1e-4);
  const big = { answer: 1e15 }; // slack 2: 20% in Feynman
  assert.ok(F.check("feynman", big, "1.19e15")); assert.ok(!F.check("feynman", big, "1.21e15"));
  assert.ok(F.check("feynman", { answer: 265182525 }, String(265182525 * 1.15))); // C(31, 17): about 16%
  assert.ok(!F.check("feynman", { answer: Math.log(99999) }, String(Math.log(99999) * 1.15)));
});

test("Guessr points: 5000 × (smaller/larger)^(1/slack)", () => {
  const p = { answer: 1 };
  assert.equal(F.points(p, "1"), 5000); assert.equal(F.points(p, "2"), 2500); assert.equal(F.points(p, "0.5"), 2500);
  assert.equal(F.points(p, "10"), 500); assert.equal(F.points(p, "1.1"), 4545); assert.equal(F.points(p, "junk"), 0); assert.equal(F.points(p, "0"), 0);
  assert.equal(F.points({ answer: 1e15 }, "2e15"), 3536); assert.equal(F.points({ answer: 5.97e24 }, String(5.97e24 * 2)), 3850);
  assert.ok(F.points({ answer: 1000 }, "2000") > 2500);
  assert.equal(F.score("guessr", p, "2"), 2500); assert.equal(F.score("mathguessr", p, "2"), 2500);
  assert.equal(F.score("feynman", p, "1.05"), 1); assert.equal(F.score("feynman", p, "1.2"), 0);
  assert.equal(F.preset("fermi"), undefined); // cut in #23
});

test("MathGuessr deals math problems and replays like FermiGuessr", () => {
  const run = newRun(game, "mathguessr", 60, 0), r = F.makeRun("mathguessr", run.s), answers = [], times = [];
  let pts = 0;
  for (let i = 0; i < 10; i++) { const q = r.next(); assert.ok(q.tex, "a math problem"); answers.push(String(q.answer * 1.5)); times.push(3000 + i * 4000); pts += F.points(q, q.answer * 1.5); }
  assert.deepEqual(verifyRun(run, answers, times, run.iat + times[9] + 500), { ok: true, score: pts, ms: times[9] });
  assert.equal(verifyRun(run, [...answers, "1"], [...times, times[9] + 1000], run.iat + 60500).ok, false);
});

test("FermiGuessr replay: fixed rounds, may finish early, points recomputed on the server", () => {
  const run = newRun(game, "guessr", 120, 0), r = F.makeRun("guessr", run.s), answers = [], times = [];
  let pts = 0;
  for (let i = 0; i < 10; i++) { const q = r.next(), g = q.answer * (1 + i / 10); answers.push(String(g)); times.push(2000 + i * 3000); pts += F.points(q, g); }
  const last = times[9];
  assert.deepEqual(verifyRun(run, answers, times, run.iat + last + 500), { ok: true, score: pts, ms: last }); // done early: fine
  assert.equal(verifyRun(run, answers, times, run.iat + last - 5000).ok, false);                          // before its last guess
  assert.equal(verifyRun(run, [...answers, "1"], [...times, last + 1000], run.iat + 120500).ok, false);  // an 11th round
  // out of time after 4 rounds: the whole clock has to have run
  assert.equal(verifyRun(run, answers.slice(0, 4), times.slice(0, 4), run.iat + 30000).ok, false);
  assert.ok(verifyRun(run, answers.slice(0, 4), times.slice(0, 4), run.iat + 120500).ok);
  assert.equal(verifyRun(run, answers, times.map(t => t + 120e3), run.iat + 300e3).ok, false);          // guesses after time ran out
});

test("leaderboard replay scores the guesses that landed", () => {
  for (const p of F.PRESETS.filter(p => !p.rounds)) {
    const run = newRun(game, p.id, 60, 0), r = F.makeRun(p.id, run.s), answers = [], times = [];
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      const q = r.next(), right = i % 3 !== 0;
      answers.push(right ? F.fmt(q.answer, false).replace(/,/g, "") : String(q.answer * 3)); times.push(400 + i * 900);
      if (right) hits++;
    }
    const now = run.iat + 60500;
    assert.deepEqual(verifyRun(run, answers, times, now), { ok: true, score: hits, ms: 60000 }, p.id);
    assert.equal(verifyRun(run, answers, times, run.iat + 30e3).ok, false);                           // early
    assert.equal(verifyRun(run, answers, times.map((t, i) => i * 100), now).ok, false);              // too quick
    assert.equal(verifyRun({ ...run, g: "omegamac" }, answers, times, now).ok, false);              // wrong game
    assert.equal(verifyRun(run, answers, times, now + LIMITS.expires + 1).ok, false);               // stale
  }
});
