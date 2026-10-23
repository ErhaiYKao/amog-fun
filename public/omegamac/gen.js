/* Omegamac — problem types, generators, the "smart" number picker and the settings <-> URL codec.
 * Pure (no DOM), runs in Node for tests (tools/omegamac/gen.test.mjs). Every answer is a non-negative integer < 2^53.
 *
 * Settings: { d: seconds, t: { <typeId>: { on: bool, p: [numbers] } } } for every type in TYPES.
 * A type's p is its fields flattened: a range field R(...) contributes [lo, hi], a value field V(...) one number.
 * URL / storage form (encode): "d=120&add&sub&mul=2-12-2-200&n=Name". Only enabled types appear, params only when
 * they differ from the defaults. typesKey(s) is the same string without d and n: it identifies a preset, and high
 * scores are keyed by d + "|" + typesKey. */
(function (root) {
  "use strict";

  // ---------- number theory & combinatorics ----------
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const lcm = (a, b) => a / gcd(a, b) * b;
  function factor(n) {
    const f = [];
    for (let p = 2; p * p <= n; p++) if (n % p === 0) { let e = 0; while (n % p === 0) { n /= p; e++; } f.push([p, e]); }
    if (n > 1) f.push([n, 1]);
    return f;
  }
  const phi = n => factor(n).reduce((a, [p, e]) => a * (p - 1) * p ** (e - 1), 1);
  const tau = n => factor(n).reduce((a, [, e]) => a * (e + 1), 1);                    // d(n): number of divisors
  const sigma = n => factor(n).reduce((a, [p, e]) => a * (p ** (e + 1) - 1) / (p - 1), 1); // σ(n): sum of divisors
  const fact = n => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const perm = (n, k) => { let r = 1; for (let i = n - k + 1; i <= n; i++) r *= i; return r; };
  const choose = (n, k) => {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k); let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; // r = C(n-k+i, i) stays an integer
    return Math.round(r);
  };
  const derange = n => { let a = 1, b = 0; if (n === 0) return 1; for (let i = 2; i <= n; i++) [a, b] = [b, (i - 1) * (a + b)]; return b; };

  // ---------- randomness ----------
  const ri = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));
  const mulberry32 = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cache = new Map();
  const cached = (k, f) => { if (!cache.has(k)) { if (cache.size > 40) cache.clear(); cache.set(k, f()); } return cache.get(k); };
  const search = (cum, x) => { let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] > x) hi = m; else lo = m + 1; } return lo; };
  let dTab = new Uint16Array(1);
  function divisorCounts(N) { // d(n) for n <= N, by a divisor sieve
    if (dTab.length <= N) { const d = new Uint16Array(N + 1); for (let i = 1; i <= N; i++) for (let j = i; j <= N; j += i) d[j]++; dTab = d; }
    return dTab;
  }

  /* The "smart" picker. Amog doesn't ask about random numbers, he asks about interesting ones.
   * One input (φ, d, σ): with probability UNIFORM pick n uniformly in [lo, hi]; otherwise sample n with
   *   weight d(n)^ALPHA, d = number of divisors. So 720 (d = 30) is 225x likelier than a prime (d = 2) in that branch,
   *   but primes still turn up (on [2, 1000] about 3% of picks, vs 17% for uniform; mean d(n) roughly doubles).
   * Two inputs (gcd, lcm): with probability UNIFORM pick a ≠ b uniformly (often coprime); otherwise pick a common factor
   *   g >= 2 with weight g·(m - 2), m = number of multiples of g in range (big g is favoured, but needs m >= 3 so it
   *   isn't always gcd(g, 2g)), then two distinct multiples xg, yg, re-rolling a few times if x | y or y | x.
   *   gcd(a, b) is a multiple of g, so it's usually large and lcm(a, b) = ab/gcd stays tame. */
  const SMART = { UNIFORM: 0.15, ALPHA: 2 };
  function pickSmart(lo, hi, rng) {
    if (hi <= lo) return lo;
    if (rng() < SMART.UNIFORM) return ri(lo, hi, rng);
    const cum = cached(`n${lo},${hi}`, () => {
      const d = divisorCounts(hi), c = new Float64Array(hi - lo + 1); let s = 0;
      for (let n = lo; n <= hi; n++) c[n - lo] = s += d[n] ** SMART.ALPHA;
      return c;
    });
    return lo + search(cum, rng() * cum[cum.length - 1]);
  }
  function pickPair(lo, hi, rng) {
    if (hi <= lo) return [lo, lo];
    if (rng() >= SMART.UNIFORM) {
      const cum = cached(`g${lo},${hi}`, () => {
        const c = new Float64Array(hi + 1); let s = 0;
        for (let g = 2; g <= hi; g++) { const m = Math.floor(hi / g) - Math.ceil(lo / g) + 1; if (m >= 3) s += g * (m - 2); c[g] = s; }
        return c;
      });
      const tot = cum[hi];
      if (tot > 0) {
        const g = search(cum, rng() * tot), first = Math.ceil(lo / g), m = Math.floor(hi / g) - first + 1;
        let x, y;
        for (let i = 0; i < 4; i++) {
          x = first + Math.floor(rng() * m); y = first + Math.floor(rng() * (m - 1)); if (y >= x) y++;
          if (Math.max(x, y) % Math.min(x, y)) break;
        }
        return [g * x, g * y];
      }
    }
    const a = ri(lo, hi, rng); let b = ri(lo, hi - 1, rng); if (b >= a) b++;
    return [a, b];
  }
  // (x, y) pairs for b^e, P(n,k), C(n,k) under a cap: pick x uniformly among x that have a valid y, then y uniformly.
  // If nothing fits under the cap it returns null, the type's gen returns null and next() skips that type.
  function pickCapped(x0, x1, y0, y1, ok, rng) {
    const xs = [];
    for (let x = x0; x <= x1; x++) { const ys = []; for (let y = y0; y <= y1; y++) if (ok(x, y)) ys.push(y); if (ys.length) xs.push([x, ys]); }
    if (!xs.length) return null;
    const [x, ys] = xs[Math.floor(rng() * xs.length)];
    return [x, ys[Math.floor(rng() * ys.length)]];
  }

  // ---------- problem types ----------
  const R = (n, lo, hi, min, max) => ({ n, lo, hi, min, max });
  const V = (n, v, min, max) => ({ n, v, min, max });
  const P = (args, tex, plain, answer) => ({ args, tex, plain, answer });
  const powGen = build => (p, rng) => { const r = pickCapped(p[0], p[1], p[2], p[3], (b, e) => b ** e <= p[4], rng); return r && build(...r); };
  const kGen = (f, build) => (p, rng) => { const r = pickCapped(p[0], p[1], p[2], p[3], (n, k) => k <= n && f(n, k) <= p[4], rng); return r && build(...r); };
  const one = (sym, plain, f) => (p, rng) => { const n = pickSmart(p[0], p[1], rng); return P([n], `${sym}(${n})`, `${plain}(${n})`, f(n)); };

  const SECTIONS = [
    { id: "basic", name: "Basic" }, { id: "exp", name: "Exponentials" },
    { id: "nt", name: "Number theory" }, { id: "comb", name: "Combinatorics" },
  ];
  const TYPES = [
    { id: "add", sec: "basic", name: "Addition", def: "$a + b$",
      f: [R("a", 2, 100, 0, 1e6), R("b", 2, 100, 0, 1e6)],
      gen: (p, rng) => { const a = ri(p[0], p[1], rng), b = ri(p[2], p[3], rng); return P([a, b], `${a} + ${b}`, `${a} + ${b}`, a + b); } },
    { id: "sub", sec: "basic", name: "Subtraction", def: "$(a + b) - a$: addition backwards",
      f: [R("a", 2, 100, 0, 1e6), R("b", 2, 100, 0, 1e6)],
      gen: (p, rng) => { const a = ri(p[0], p[1], rng), b = ri(p[2], p[3], rng); return P([a + b, a], `${a + b} - ${a}`, `${a + b} − ${a}`, b); } },
    { id: "mul", sec: "basic", name: "Multiplication", def: "$a \\times b$",
      f: [R("a", 2, 12, 0, 1e4), R("b", 2, 100, 0, 1e4)],
      gen: (p, rng) => { const a = ri(p[0], p[1], rng), b = ri(p[2], p[3], rng); return P([a, b], `${a} \\times ${b}`, `${a} × ${b}`, a * b); } },
    { id: "div", sec: "basic", name: "Division", def: "$ab \\div a$: multiplication backwards",
      f: [R("a", 2, 12, 1, 1e4), R("b", 2, 100, 0, 1e4)],
      gen: (p, rng) => { const a = ri(p[0], p[1], rng), b = ri(p[2], p[3], rng); return P([a * b, a], `${a * b} \\div ${a}`, `${a * b} ÷ ${a}`, b); } },

    { id: "sq", sec: "exp", name: "Perfect squares", def: "$n^2$",
      f: [R("n", 2, 30, 0, 1e4)],
      gen: (p, rng) => { const n = ri(p[0], p[1], rng); return P([n], `${n}^2`, `${n}²`, n * n); } },
    { id: "cube", sec: "exp", name: "Perfect cubes", def: "$n^3$",
      f: [R("n", 2, 10, 0, 1000)],
      gen: (p, rng) => { const n = ri(p[0], p[1], rng); return P([n], `${n}^3`, `${n}³`, n ** 3); } },
    { id: "sqrt", sec: "exp", name: "Square roots", def: "$\\sqrt{n^2}$ (perfect squares only)",
      f: [R("n", 2, 30, 0, 1e4)],
      gen: (p, rng) => { const n = ri(p[0], p[1], rng); return P([n * n], `\\sqrt{${n * n}}`, `√${n * n}`, n); } },
    { id: "cbrt", sec: "exp", name: "Cube roots", def: "$\\sqrt[3]{n^3}$",
      f: [R("n", 2, 20, 0, 1000)],
      gen: (p, rng) => { const n = ri(p[0], p[1], rng); return P([n ** 3], `\\sqrt[3]{${n ** 3}}`, `∛${n ** 3}`, n); } },
    { id: "pow", sec: "exp", name: "Exponents", def: "$b^e$, with $b^e \\le$ max",
      f: [R("b", 2, 12, 2, 1000), R("e", 2, 10, 0, 60), V("max", 10000, 1, 1e12)],
      gen: powGen((b, e) => P([b, e], `${b}^{${e}}`, `${b}^${e}`, b ** e)) },
    { id: "log", sec: "exp", name: "Logarithms", def: "$\\log_b x$ for $x = b^e \\le$ max",
      f: [R("b", 2, 12, 2, 1000), R("e", 2, 10, 0, 60), V("max", 1e6, 1, 1e12)],
      gen: powGen((b, e) => P([b, b ** e], `\\log_{${b}} ${b ** e}`, `log_${b} ${b ** e}`, e)) },

    { id: "phi", sec: "nt", name: "Totient", def: "$\\varphi(n) = \\#\\{1 \\le k \\le n : \\gcd(k, n) = 1\\}$",
      f: [R("n", 2, 100, 1, 1e5)], gen: one("\\varphi", "φ", phi) },
    { id: "tau", sec: "nt", name: "Number of divisors", def: "$d(n)$, how many positive divisors $n$ has: $d(12) = 6$",
      f: [R("n", 2, 200, 1, 1e5)], gen: one("d", "d", tau) },
    { id: "sigma", sec: "nt", name: "Sum of divisors", def: "$\\sigma(n)$, the sum of the positive divisors: $\\sigma(12) = 1 + 2 + 3 + 4 + 6 + 12 = 28$",
      f: [R("n", 2, 100, 1, 1e5)], gen: one("\\sigma", "σ", sigma) },
    { id: "gcd", sec: "nt", name: "GCD", def: "$\\gcd(a, b)$, $a \\ne b$",
      f: [R("a, b", 2, 200, 1, 1e5)],
      gen: (p, rng) => { const [a, b] = pickPair(p[0], p[1], rng); return P([a, b], `\\gcd(${a}, ${b})`, `gcd(${a}, ${b})`, gcd(a, b)); } },
    { id: "lcm", sec: "nt", name: "LCM", def: "$\\operatorname{lcm}(a, b)$, $a \\ne b$",
      f: [R("a, b", 2, 50, 1, 1e4)],
      gen: (p, rng) => { const [a, b] = pickPair(p[0], p[1], rng); return P([a, b], `\\operatorname{lcm}(${a}, ${b})`, `lcm(${a}, ${b})`, lcm(a, b)); } },

    { id: "fact", sec: "comb", name: "Factorials", def: "$n! = 1 \\cdot 2 \\cdots n$, $0! = 1$",
      f: [R("n", 0, 8, 0, 18)],
      gen: (p, rng) => { const n = ri(p[0], p[1], rng); return P([n], `${n}!`, `${n}!`, fact(n)); } },
    { id: "perm", sec: "comb", name: "Permutations", def: "$P(n, k) = \\frac{n!}{(n - k)!}$, $k \\le n$, at most max",
      f: [R("n", 3, 10, 0, 60), R("k", 1, 4, 0, 60), V("max", 10000, 1, 1e12)],
      gen: kGen(perm, (n, k) => P([n, k], `P(${n}, ${k})`, `P(${n}, ${k})`, perm(n, k))) },
    { id: "comb", sec: "comb", name: "Combinations", def: "$\\binom{n}{k} = \\frac{n!}{k!\\,(n - k)!}$, $k \\le n$, at most max",
      f: [R("n", 4, 12, 0, 60), R("k", 2, 5, 0, 60), V("max", 1000, 1, 1e12)],
      gen: kGen(choose, (n, k) => P([n, k], `\\dbinom{${n}}{${k}}`, `C(${n}, ${k})`, choose(n, k))) },
    { id: "der", sec: "comb", name: "Derangements", def: "$!n$ = permutations of $n$ things with no fixed point: $!4 = 9$",
      f: [R("n", 1, 5, 0, 18)],
      gen: (p, rng) => { const n = ri(p[0], p[1], rng); return P([n], `!${n}`, `!${n}`, derange(n)); } },
  ];
  // the functions page (omegamac/functions/): paragraphs explaining a type. A type with them gets its name, linked
  // there, under the playfield when it comes up.
  const ABOUT = {
    log: [
      "$\\log_b x$ asks which power of $b$ gives $x$: $\\log_2 1024 = 10$ because $2^{10} = 1024$, and $\\log_{10} 1000 = 3$.",
      "Here $x$ is always an exact power of $b$, so it's really a question about powers you know: $2^{10} = 1024$, $3^5 = 243$, $3^6 = 729$, $4^5 = 1024$, $5^4 = 625$, $6^3 = 216$, $7^3 = 343$. If you know $\\log_b x = e$, then $\\log_{b^2} x = e / 2$: $\\log_4 1024 = 5$.",
    ],
    phi: [
      "$\\varphi(n)$, Euler's totient, counts the numbers $1 \\le k \\le n$ that share no prime factor with $n$: $\\varphi(12) = 4$, from $1, 5, 7, 11$.",
      "For a prime every smaller number counts, so $\\varphi(p) = p - 1$. For a prime power only the multiples of $p$ fail: $\\varphi(p^a) = p^a - p^{a - 1}$. And $\\varphi$ is multiplicative, $\\varphi(mn) = \\varphi(m)\\,\\varphi(n)$ when $\\gcd(m, n) = 1$, so you can work prime by prime. All together, $\\varphi(n) = n \\prod_{p \\mid n} \\left(1 - \\tfrac1p\\right)$: take away a $\\tfrac1p$ share for each prime $p$ dividing $n$.",
      "Example: $\\varphi(72) = \\varphi(8)\\,\\varphi(9) = 4 \\cdot 6 = 24$, or $72 \\cdot \\tfrac12 \\cdot \\tfrac23 = 24$. Quick checks: $\\varphi(n)$ is even once $n \\ge 3$, and $\\varphi(2n) = \\varphi(n)$ for odd $n$.",
    ],
    tau: [
      "$d(n)$ counts the positive divisors of $n$, including $1$ and $n$: $d(12) = 6$, from $1, 2, 3, 4, 6, 12$.",
      "Write $n = p_1^{a_1} \\cdots p_k^{a_k}$. A divisor picks an exponent from $0$ to $a_i$ for each prime, independently, so $d(n) = (a_1 + 1)(a_2 + 1) \\cdots (a_k + 1)$.",
      "Example: $72 = 2^3 \\cdot 3^2$, so $d(72) = 4 \\cdot 3 = 12$. A prime has $d(p) = 2$, and $d(n)$ is odd exactly when $n$ is a perfect square: divisors pair up as $k$ and $n / k$, except $\\sqrt n$. Below $200$ the most is $d(180) = 18$.",
    ],
    sigma: [
      "$\\sigma(n)$ adds up all the positive divisors of $n$, including $1$ and $n$: $\\sigma(12) = 1 + 2 + 3 + 4 + 6 + 12 = 28$.",
      "For a prime power the divisors are $1, p, \\dots, p^a$, so $\\sigma(p^a) = 1 + p + \\cdots + p^a = \\frac{p^{a + 1} - 1}{p - 1}$. Like $\\varphi$, $\\sigma$ is multiplicative: $\\sigma(mn) = \\sigma(m)\\,\\sigma(n)$ for coprime $m$ and $n$. That's because multiplying out $(1 + 2 + 4)(1 + 3)$ gives every divisor of $12$ exactly once.",
      "Example: $\\sigma(72) = \\sigma(8)\\,\\sigma(9) = 15 \\cdot 13 = 195$. A prime has $\\sigma(p) = p + 1$, and a number with $\\sigma(n) = 2n$ is called perfect: $6$, $28$, $496$.",
    ],
    gcd: [
      "$\\gcd(a, b)$ is the greatest common divisor: the largest number dividing both $a$ and $b$.",
      "Euclid's algorithm is the fast way: $\\gcd(a, b) = \\gcd(b, a \\bmod b)$, because anything dividing two numbers divides their difference. So $\\gcd(168, 120) = \\gcd(120, 48) = \\gcd(48, 24) = 24$. Or compare factorizations and keep the smaller power of each shared prime: $168 = 2^3 \\cdot 3 \\cdot 7$ and $120 = 2^3 \\cdot 3 \\cdot 5$ share $2^3 \\cdot 3 = 24$.",
    ],
    lcm: [
      "$\\operatorname{lcm}(a, b)$ is the least common multiple: the smallest positive number that both $a$ and $b$ divide.",
      "Keep the larger power of each prime, or use $\\operatorname{lcm}(a, b) = \\frac{ab}{\\gcd(a, b)}$, dividing first to keep the numbers small: $\\operatorname{lcm}(12, 18) = 12 \\cdot \\frac{18}{6} = 36$. If one divides the other, the lcm is the bigger one.",
    ],
    fact: [
      "$n! = 1 \\cdot 2 \\cdots n$ is the number of orders $n$ different things can go in. $0! = 1$: there's one way to order nothing.",
      "Each factorial is the previous one times $n$, so it pays to know the start by heart: $3! = 6$, $4! = 24$, $5! = 120$, $6! = 720$, $7! = 5040$, $8! = 40320$, $9! = 362880$.",
    ],
    perm: [
      "$P(n, k)$ is the number of ways to line up $k$ of $n$ different things in order: $n$ choices for the first, $n - 1$ for the second, and so on for $k$ places.",
      "So $P(n, k) = n (n - 1) \\cdots (n - k + 1) = \\frac{n!}{(n - k)!}$: multiply $k$ numbers counting down from $n$. $P(8, 3) = 8 \\cdot 7 \\cdot 6 = 336$, and $P(n, n) = n!$.",
    ],
    comb: [
      "$\\binom{n}{k}$, “$n$ choose $k$”, is the number of ways to choose $k$ of $n$ things when order doesn't matter.",
      "Each choice can be lined up in $k!$ orders, so $\\binom{n}{k} = \\frac{P(n, k)}{k!} = \\frac{n!}{k!\\,(n - k)!}$: $\\binom{10}{3} = \\frac{10 \\cdot 9 \\cdot 8}{6} = 120$. Choosing what to take is choosing what to leave, so $\\binom{n}{k} = \\binom{n}{n - k}$ and you only ever need the smaller $k$. Pascal's rule, $\\binom{n}{k} = \\binom{n - 1}{k - 1} + \\binom{n - 1}{k}$, builds the triangle.",
    ],
    der: [
      "$!n$ counts derangements: the ways to shuffle $n$ letters so that none lands back in its own envelope.",
      "$!1 = 0$, $!2 = 1$, $!3 = 2$, and then $!n = (n - 1)\\left(!(n - 1) + !(n - 2)\\right)$: $!4 = 9$, $!5 = 44$, $!6 = 265$, $!7 = 1854$. By inclusion–exclusion, $!n = n! \\left(1 - \\frac1{1!} + \\frac1{2!} - \\cdots \\pm \\frac1{n!}\\right)$, which is always the nearest whole number to $n! / e$. So a random shuffle has no fixed point about $37\\%$ of the time.",
    ],
  };
  for (const t of TYPES) if (ABOUT[t.id]) t.about = ABOUT[t.id];
  const BY = Object.fromEntries(TYPES.map(t => [t.id, t]));
  const defaultsOf = t => t.f.flatMap(f => "v" in f ? [f.v] : [f.lo, f.hi]);
  const DURATIONS = [30, 60, 120, 180, 300, 600];
  const SKIP_MS = 5000; // a skip costs this much of the clock

  // ---------- settings ----------
  function normParams(t, p) {
    const d = defaultsOf(t), out = [];
    let i = 0;
    const num = (x, f, dflt) => { x = Math.round(Number(x)); return Number.isFinite(x) ? Math.min(f.max, Math.max(f.min, x)) : dflt; };
    for (const f of t.f) {
      if ("v" in f) { out.push(num(p?.[i], f, d[i])); i++; continue; }
      let lo = num(p?.[i], f, d[i]), hi = num(p?.[i + 1], f, d[i + 1]);
      if (lo > hi) [lo, hi] = [hi, lo];
      out.push(lo, hi); i += 2;
    }
    return out;
  }
  function defaults(on = []) {
    const t = {};
    for (const ty of TYPES) t[ty.id] = { on: on.includes(ty.id), p: defaultsOf(ty) };
    return { d: 120, t };
  }
  const normDur = d => { d = Math.round(Number(d)); return Number.isFinite(d) ? Math.min(3600, Math.max(5, d)) : 120; };
  function normalize(s) {
    const out = { d: normDur(s?.d), t: {} };
    for (const ty of TYPES) { const x = s?.t?.[ty.id]; out.t[ty.id] = { on: !!x?.on, p: normParams(ty, x?.p) }; }
    return out;
  }
  function typesKey(s) {
    return TYPES.filter(ty => s.t[ty.id]?.on).map(ty => {
      const p = normParams(ty, s.t[ty.id].p), d = defaultsOf(ty);
      return p.every((x, i) => x === d[i]) ? ty.id : `${ty.id}=${p.join("-")}`;
    }).join("&");
  }
  const encode = (s, name) => `d=${normDur(s.d)}&${typesKey(s)}${name ? "&n=" + encodeURIComponent(name).replace(/%20/g, "+") : ""}`;
  // -> { settings, name } or null if nothing playable is in the string
  function decode(str) {
    const s = defaults(); let name = "", any = false;
    for (const part of String(str || "").replace(/^[#?]/, "").split("&")) {
      if (!part) continue;
      const eq = part.indexOf("="), k = eq < 0 ? part : part.slice(0, eq), v = eq < 0 ? "" : part.slice(eq + 1);
      if (k === "d") s.d = normDur(v);
      else if (k === "n") { try { name = decodeURIComponent(v.replace(/\+/g, " ")).slice(0, 40); } catch { name = ""; } }
      else if (BY[k]) { any = true; s.t[k].on = true; if (v) s.t[k].p = normParams(BY[k], v.split("-")); }
    }
    return any ? { settings: normalize(s), name } : null;
  }

  // a preset is a set of types plus, optionally, params that differ from the type defaults (p: {typeId: [...]})
  const PRESETS = [
    { id: "basic", name: "Basic", on: ["add", "sub", "mul", "div"] },
    // high school (airetho's #23; also amog.fun/alphamac): every basic and exponential type with small bounds, gcd, lcm, n! ≤ 6!
    { id: "alpha", name: "Alphamac", on: ["add", "sub", "mul", "div", "sq", "cube", "sqrt", "cbrt", "pow", "log", "gcd", "lcm", "fact"],
      p: { sq: [2, 20], sqrt: [2, 20], cube: [2, 10], cbrt: [2, 10], pow: [2, 12, 2, 10, 1000], log: [2, 12, 2, 10, 1000], fact: [0, 6] } },
    { id: "everything", name: "Everything", on: TYPES.map(t => t.id) },
    { id: "powers", name: "Powers & roots", on: TYPES.filter(t => t.sec === "exp").map(t => t.id) },
    { id: "nt", name: "Number theorist", on: TYPES.filter(t => t.sec === "nt").map(t => t.id) },
    { id: "comb", name: "Combinatorialist", on: TYPES.filter(t => t.sec === "comb").map(t => t.id) },
  ];
  const settingsOf = pr => { const s = defaults(pr.on); for (const [id, p] of Object.entries(pr.p || {})) s.t[id].p = normParams(BY[id], p); return s; };
  for (const p of PRESETS) p.key = typesKey(settingsOf(p));
  const presetSettings = id => settingsOf(PRESETS.find(p => p.id === id));

  // next problem: a uniformly random enabled type, never the exact same problem twice in a row (if avoidable).
  // Types whose bounds admit nothing (capped ones) are skipped; null if no enabled type can produce a problem.
  const feasible = (s, id) => !!BY[id].gen(s.t[id].p, Math.random); // pickCapped's null is deterministic
  function next(s, rng = Math.random, prev = null) {
    let on = TYPES.filter(t => s.t[t.id]?.on), pr = null;
    for (let i = 0; i < 12 && on.length; i++) {
      const t = on[Math.floor(rng() * on.length)], g = t.gen(s.t[t.id].p, rng);
      if (!g) { on = on.filter(x => x !== t); i--; continue; }
      pr = { type: t.id, ...g };
      if (!prev || pr.tex !== prev.tex) break;
    }
    return pr;
  }
  const check = (pr, input) => String(input).replace(/[\s,_]/g, "") === String(pr.answer);

  root.Omegamac = {
    TYPES, SECTIONS, PRESETS, DURATIONS, SKIP_MS, SMART, defaults, defaultsOf, normalize, encode, decode, typesKey, presetSettings, next, check, feasible,
    pickSmart, pickPair, divisorCounts, mulberry32,
    nt: { gcd, lcm, factor, phi, tau, sigma, fact, perm, choose, derange },
  };
})(typeof window !== "undefined" ? window : globalThis);
