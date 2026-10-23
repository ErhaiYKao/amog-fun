/* The Coefficient Choosing Game (amog.fun/coefficient-game): rings, exact root tests and the rules. Pure: runs in the
 * page, in Node (tools/coefficient-game) and in the Worker (worker/coefficients.js referees online games with it).
 *
 * Ring specs (parseRing): Z, Q, R, C; Z/n (n ≤ 100000); F_q or GF(q) (q a prime power ≤ 4096, built as F_p[α]/(f));
 * Z/n[t]/(f) for f with a unit leading coefficient (any letter but x; Z/n[i] means Z/n[i]/(i^2+1); F_p[t]/(f) too), at
 * most 5000 elements; products R × S × … (up to 4 factors, written ×, x or *).
 * Elements: finite rings use integer ids 0..size-1 (0 is zero); Z is BigInt; Q and R are fractions [num, den] (entries
 * of R are rational, so everything stays exact); C is a pair of fractions; a product with an infinite factor uses
 * arrays. ring.parse(text) reads an expression (+ − * / ^, parentheses, the ring's symbols; a tuple (a, b) in
 * products) and ring.show(a) prints one that parses back.
 * ring.root(coeffs) (coeffs[k] is the x^k coefficient) returns null or {show, tex, approx}: finite rings try every
 * element, Z and Q isolate the real roots with Sturm sequences and test the one candidate each interval can hold, R
 * counts real roots with Sturm, and over C there always is one. */
(function (root) {
  "use strict";
  const MAX_ZN = 100000, MAX_QUOT = 5000, MAX_FIELD = 4096, MAX_FACTORS = 4, MAX_BITS = 256;
  const DMIN = 2, DMAX = 12;
  const err = m => { throw new Error(m); };

  // ---------- BigInt integers and fractions [num, den], den > 0, lowest terms ----------
  const babs = a => (a < 0n ? -a : a);
  const bgcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
  const bfloor = (a, b) => { const q = a / b; return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q; };
  const fr = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d); return g > 1n ? [n / g, d / g] : [n, d]; };
  const fadd = (a, b) => fr(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
  const fneg = a => [-a[0], a[1]];
  const fsub = (a, b) => fadd(a, fneg(b));
  const fmul = (a, b) => fr(a[0] * b[0], a[1] * b[1]);
  const finv = a => (a[0] ? fr(a[1], a[0]) : err("can't divide by 0"));
  const fsign = a => (a[0] > 0n ? 1 : a[0] < 0n ? -1 : 0);
  const ffloor = a => bfloor(a[0], a[1]);
  const fnum = a => Number(a[0]) / Number(a[1]);
  const fshow = a => (a[1] === 1n ? String(a[0]) : `${a[0]}/${a[1]}`);
  const ftex = a => (a[1] === 1n ? String(a[0]) : `${a[0] < 0n ? "-" : ""}\\tfrac{${babs(a[0])}}{${a[1]}}`);
  const tooBig = x => babs(x).toString(2).length > MAX_BITS;

  // ---------- integer polynomials (BigInt arrays, index = degree): Sturm sequences and rational roots ----------
  const ptrim = p => { while (p.length && p[p.length - 1] === 0n) p.pop(); return p; };
  const pprim = p => { let g = 0n; for (const c of p) g = bgcd(g, c); return g > 1n ? p.map(c => c / g) : p; };
  const pderiv = p => p.slice(1).map((c, i) => c * BigInt(i + 1));
  // the remainder of m·a by b for some m > 0, made primitive (Sturm sequences only need signs)
  function prem(a, b) {
    a = a.slice();
    const db = b.length - 1, s = b[db] < 0n ? -1n : 1n, lb = b[db] * s;
    while (a.length - 1 >= db) {
      const da = a.length - 1, la = a[da] * s, sh = da - db;
      for (let i = 0; i < da; i++) a[i] = a[i] * lb - (i >= sh ? la * b[i - sh] : 0n);
      a.pop(); ptrim(a); a = pprim(a);
    }
    return a;
  }
  function pgcd(a, b) { while (b.length) [a, b] = [b, prem(a, b)]; return pprim(a); }
  function pdivExact(a, g) { // a = g·q over Z (both primitive and g | a)
    const r = a.slice(), dg = g.length - 1, q = new Array(a.length - dg).fill(0n);
    for (let i = q.length - 1; i >= 0; i--) {
      const c = r[i + dg] / g[dg]; q[i] = c;
      for (let j = 0; j <= dg; j++) r[i + j] -= c * g[j];
    }
    return q;
  }
  function squarefree(P) { P = pprim(P); const g = pgcd(P, pprim(pderiv(P))); return g.length > 1 ? pdivExact(P, g) : P; }
  function psign(p, x) { // sign of p at the fraction x
    const m = p.length - 1; let acc = p[m], dp = 1n;
    for (let i = m - 1; i >= 0; i--) { dp *= x[1]; acc = acc * x[0] + p[i] * dp; }
    return acc > 0n ? 1 : acc < 0n ? -1 : 0;
  }
  function sturm(S) {
    const seq = [S, pprim(pderiv(S))];
    while (seq[seq.length - 1].length > 1) {
      const r = prem(seq[seq.length - 2], seq[seq.length - 1]);
      if (!r.length) break;
      seq.push(r.map(c => -c));
    }
    return seq;
  }
  // disjoint intervals (lo, hi), endpoints not roots, each holding exactly one real root of the squarefree S
  function isolate(S) {
    const st = sturm(S), m = S.length - 1;
    let mx = 0n; for (let i = 0; i < m; i++) if (babs(S[i]) > mx) mx = babs(S[i]);
    const B = [2n + mx / babs(S[m]), 1n], out = []; // Cauchy: every root has |x| < 1 + max|s_i/s_m|
    const V = x => { let v = 0, last = 0; for (const p of st) { const s = psign(p, x); if (s && last && s !== last) v++; if (s) last = s; } return v; };
    const stack = [[fneg(B), B, V(fneg(B)), V(B)]];
    while (stack.length) {
      const [lo, hi, vl, vh] = stack.pop(), n = vl - vh;
      if (n <= 0) continue;
      if (n === 1) { out.push([lo, hi]); continue; }
      let mid = fmul(fadd(lo, hi), [1n, 2n]);
      for (let k = 3n; psign(S, mid) === 0; k++) mid = fadd(lo, fmul(fsub(hi, lo), [1n, k]));
      const vm = V(mid);
      stack.push([lo, mid, vl, vm], [mid, hi, vm, vh]);
    }
    return out;
  }
  // bisect a one-root interval until it's narrower than w (or a midpoint is the root)
  function refine(S, lo, hi, w) {
    const sl = psign(S, lo);
    while (fsign(fsub(fsub(hi, lo), w)) >= 0) {
      const mid = fmul(fadd(lo, hi), [1n, 2n]), s = psign(S, mid);
      if (s === 0) return { exact: mid };
      if (s === sl) lo = mid; else hi = mid;
    }
    return { lo, hi };
  }
  function simplest(lo, hi) { // the fraction with the smallest denominator in [lo, hi]
    const f = ffloor(lo);
    if (f * lo[1] === lo[0]) return [f, 1n];
    if (f + 1n <= ffloor(hi)) return [f + 1n, 1n];
    const t = simplest(finv(fsub(hi, [f, 1n])), finv(fsub(lo, [f, 1n])));
    return fadd([f, 1n], finv(t));
  }
  // a rational (or integer) root of the integer polynomial P, or null. A root p/q of the primitive squarefree S has
  // q | lc(S) = D, and two fractions with denominators ≤ D are ≥ 1/D² apart, so once an interval is narrower than
  // that its simplest fraction is the only candidate.
  // a factor of a product ring can see a zero constant or leading term: 0 is then a root, or the degree drops
  const degenerate = P => (P = ptrim(P.slice()), !P.length || P[0] === 0n ? { root: [0n, 1n] } : P.length === 1 ? { none: true } : { P });
  function rationalRoot(P, intOnly) {
    const dg = degenerate(P); if (!dg.P) return dg.root || null; P = dg.P;
    const S = squarefree(P), D = babs(S[S.length - 1]);
    const w = intOnly ? [1n, 2n] : [1n, 2n * D * D];
    for (const [lo, hi] of isolate(S)) {
      const r = refine(S, lo, hi, w), c = r.exact || simplest(r.lo, r.hi);
      if ((!intOnly || c[1] === 1n) && psign(S, c) === 0) return c;
    }
    return null;
  }
  function realRoot(P) { // null, or an exact rational root, or an approximation
    const dg = degenerate(P); if (!dg.P) return dg.root ? { exact: dg.root } : null; P = dg.P;
    const S = squarefree(P), I = isolate(S);
    if (!I.length) return null;
    const [lo, hi] = I[0], r = refine(S, lo, hi, [1n, 1n << 40n]);
    if (r.exact) return { exact: r.exact };
    const c = simplest(r.lo, r.hi); // a rational root with a small denominator shows exactly
    return psign(S, c) === 0 ? { exact: c } : { approx: fnum(fmul(fadd(r.lo, r.hi), [1n, 2n])) };
  }
  const fracsToInts = cs => { // rational coefficients → integer ones with the same roots
    let L = 1n; for (const c of cs) L = (L / bgcd(L, c[1])) * c[1];
    return cs.map(c => c[0] * (L / c[1]));
  };
  const approxShow = x => { const a = Math.abs(x); return (a !== 0 && (a < 1e-4 || a >= 1e9) ? x.toExponential(6) : String(+x.toPrecision(8))); };

  // ---------- expressions ----------
  // ring needs add, sub, neg, mul, one, fromInt(BigInt); optional div, fromDec(digits, scale), atom(name), maxPow
  function parseExpr(ring, text) {
    const s = String(text).replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/[·×]/g, "*");
    if (!s) err("type a value");
    if (s.length > 100) err("that's too long");
    let i = 0;
    const isAtomStart = c => c && (/[A-Za-z0-9α(.]/.test(c));
    const expr = () => {
      let v = unary();
      while (s[i] === "+" || s[i] === "-") { const op = s[i++], w = unary(); v = op === "+" ? ring.add(v, w) : ring.sub(v, w); }
      return v;
    };
    const unary = () => (s[i] === "-" ? (i++, ring.neg(unary())) : s[i] === "+" ? (i++, unary()) : term());
    const term = () => {
      let v = power();
      for (;;) {
        if (s[i] === "*") { i++; v = ring.mul(v, factor()); }
        else if (s[i] === "/") { i++; v = div(v, factor()); }
        else if (isAtomStart(s[i]) && !/[0-9.]/.test(s[i])) v = ring.mul(v, power());
        else return v;
      }
    };
    const factor = () => (s[i] === "-" ? (i++, ring.neg(factor())) : power());
    const div = (a, b) => (ring.div ? ring.div(a, b) : err("this ring has no division"));
    const power = () => {
      const b = atom();
      if (s[i] !== "^") return b;
      i++;
      const m = s.slice(i).match(/^(-?)\(?(-?\d+)\)?/) || err("an exponent should be a whole number");
      i += m[0].length;
      let e = BigInt(m[2]); if (m[1]) e = -e;
      if (e < 0n) return pow(div(ring.one, b), -e);
      return pow(b, e);
    };
    const pow = (b, e) => {
      if (e > BigInt(ring.maxPow || 1e6)) err("that exponent is too big");
      let r = ring.one;
      for (; e > 0n; e >>= 1n, b = e > 0n ? ring.mul(b, b) : b) if (e & 1n) r = ring.mul(r, b);
      return r;
    };
    const atom = () => {
      const c = s[i];
      if (c === "(") { i++; const v = expr(); if (s[i] !== ")") err("missing )"); i++; return v; }
      const m = s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (m) {
        i += m[0].length;
        const sci = ring.fromDec && !(ring.atom && ring.atom("e")) ? s.slice(i).match(/^e([+-]?\d+)/i) : null; // 1e6
        if (sci) i += sci[0].length;
        const [ip, fp = ""] = m[0].split(".");
        if (!m[0].includes(".") && !sci) return ring.fromInt(BigInt(ip));
        if (!ring.fromDec) err("decimals only make sense in Q, R and C");
        const exp = sci ? +sci[1] : 0;
        if (Math.abs(exp) > 60) err("that exponent is too big");
        return ring.fromDec(BigInt((ip || "0") + fp), exp - fp.length);
      }
      if (c && /[A-Za-zα]/.test(c)) {
        i++;
        const v = ring.atom ? ring.atom(c) : null;
        if (v == null) err(`"${c}" means nothing here`);
        return v;
      }
      err(c ? `can't read "${s.slice(i, i + 8)}"` : "unfinished expression");
    };
    const v = expr();
    if (i < s.length) err(`can't read "${s.slice(i, i + 8)}"`);
    return v;
  }
  // split at top-level separators (not inside () or [])
  function splitTop(s, seps) {
    const out = []; let depth = 0, cur = "";
    for (const ch of s) {
      if ("([{".includes(ch)) depth++;
      if (")]}".includes(ch)) depth--;
      if (!depth && seps.includes(ch)) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // ---------- finite rings: elements are ids 0..size-1, 0 is zero ----------
  function finite(r) {
    r.finite = true; r.zero = 0;
    r.isZero = a => a === 0;
    r.eq = (a, b) => a === b;
    r.sub = (a, b) => r.add(a, r.neg(b));
    r.maxPow = 1e9;
    r.parse = t => parseExpr(r, t);
    r.random = rng => Math.floor(rng() * r.size);
    r.key = a => a;
    if (!r.div) r.div = (a, b) => { const u = r.inv(b); return u == null ? err(`${r.show(b)} isn't a unit in ${r.name}`) : r.mul(a, u); };
    if (!r.inv) r.inv = b => { for (let u = 1; u < r.size; u++) if (r.mul(b, u) === r.one) return u; return null; };
    if (!r.root) r.root = cs => {
      for (let x = 0; x < r.size; x++) {
        let acc = 0;
        for (let k = cs.length - 1; k >= 0; k--) acc = r.add(r.mul(acc, x), cs[k]);
        if (acc === 0) return { el: x, show: r.show(x), tex: r.tex(x) };
      }
      return null;
    };
    r.evalAt = (cs, x) => { let acc = 0; for (let k = cs.length - 1; k >= 0; k--) acc = r.add(r.mul(acc, x), cs[k]); return acc; };
    return r;
  }
  const isPrime = n => { if (n < 2) return false; for (let p = 2; p * p <= n; p++) if (n % p === 0) return false; return true; };
  const modInv = (a, n) => { // inverse of a mod n, or null
    let [r0, r1, s0, s1] = [n, ((a % n) + n) % n, 0, 1];
    while (r1) { const q = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return r0 === 1 ? ((s0 % n) + n) % n : null;
  };

  function Zn(n) {
    const N = BigInt(n);
    return finite({
      kind: "zn", n, size: n, one: 1 % n, name: `Z/${n}`, ntex: `\\mathbb{Z}/${n}`, field: isPrime(n),
      add: (a, b) => (a + b) % n, neg: a => (n - a) % n, mul: (a, b) => (a * b) % n,
      fromInt: k => Number(((k % N) + N) % N), inv: a => modInv(a, n),
      show: a => String(a), tex: a => String(a),
    });
  }

  // polynomials over Z/n in one symbol (used to read the modulus of a quotient)
  function polyRing(n, sym) {
    const N = BigInt(n), tr = p => { while (p.length && !p[p.length - 1]) p.pop(); return p; };
    const r = {
      one: [1 % n], maxPow: 64,
      add: (a, b) => tr(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ((a[i] || 0) + (b[i] || 0)) % n)),
      neg: a => a.map(c => (n - c) % n),
      mul: (a, b) => { const p = new Array(Math.max(0, a.length + b.length - 1)).fill(0); a.forEach((x, i) => b.forEach((y, j) => (p[i + j] = (p[i + j] + x * y) % n))); if (p.length > 40) err("that modulus is too big"); return tr(p); },
      fromInt: k => tr([Number(((k % N) + N) % N)]),
      atom: c => (c === sym || (sym === "α" && c === "a") ? [0, 1 % n] : null),
    };
    r.sub = (a, b) => r.add(a, r.neg(b));
    return r;
  }
  const symTex = s => (s === "α" ? "\\alpha " : s);
  function polyShow(c, sym, tex) { // coefficient list (low → high) → "2t^2+t+1"
    const sy = tex ? symTex(sym) : sym, parts = [];
    for (let j = c.length - 1; j >= 0; j--) {
      if (!c[j]) continue;
      const co = c[j] === 1 && j ? "" : String(c[j]);
      parts.push(j === 0 ? co : j === 1 ? co + sy : `${co}${sy}^${tex ? `{${j}}` : j}`);
    }
    return parts.length ? parts.join("+") : "0";
  }

  // Z/n[sym]/(f), f monic of degree k ≥ 1 (coefficients low → high, numbers mod n)
  function quotient(n, f, sym, o = {}) {
    const k = f.length - 1, size = n ** k;
    const dec = a => { const c = new Array(k); for (let j = 0; j < k; j++) { c[j] = a % n; a = (a - c[j]) / n; } return c; };
    const enc = c => { let a = 0; for (let j = k - 1; j >= 0; j--) a = a * n + c[j]; return a; };
    const mulv = (x, y) => {
      const p = new Array(2 * k - 1).fill(0);
      for (let i = 0; i < k; i++) if (x[i]) for (let j = 0; j < k; j++) p[i + j] = (p[i + j] + x[i] * y[j]) % n;
      for (let t = 2 * k - 2; t >= k; t--) { const c = p[t]; if (c) for (let j = 0; j < k; j++) p[t - k + j] = ((p[t - k + j] - c * f[j]) % n + n) % n; }
      return p.slice(0, k);
    };
    const fs = polyShow(f, sym), N = BigInt(n);
    const r = finite({
      kind: "quot", n, f, sym, size, one: 1 % n,
      name: o.name || `Z/${n}[${sym}]/(${fs})`, ntex: o.ntex || `\\mathbb{Z}/${n}[${symTex(sym)}]/(${polyShow(f, sym, true)})`,
      field: !!o.field, note: o.note,
      add: (a, b) => { const x = dec(a), y = dec(b); return enc(x.map((c, j) => (c + y[j]) % n)); },
      neg: a => enc(dec(a).map(c => (n - c) % n)),
      mul: (a, b) => enc(mulv(dec(a), dec(b))),
      fromInt: v => Number(((v % N) + N) % N),
      atom: c => (c === sym || (sym === "α" && c === "a") ? (k > 1 ? n % size : enc([((n - f[0]) % n)])) : null),
      show: a => polyShow(dec(a), sym), tex: a => polyShow(dec(a), sym, true),
    });
    if (size <= 400) { // tables: the solver and the root test hit these a lot
      const A = new Int32Array(size * size), M = new Int32Array(size * size), add = r.add, mul = r.mul;
      for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) { A[a * size + b] = add(a, b); M[a * size + b] = mul(a, b); }
      r.add = (a, b) => A[a * size + b]; r.mul = (a, b) => M[a * size + b];
    }
    return r;
  }
  function irreducibleOver(p, k) { // first monic irreducible of degree k over F_p, by trial division
    const divides = (g, f) => { // does monic g divide f (both mod p)?
      const r = f.slice();
      for (let i = r.length - g.length; i >= 0; i--) { const c = r[i + g.length - 1]; if (c) for (let j = 0; j < g.length; j++) r[i + j] = ((r[i + j] - c * g[j]) % p + p) % p; }
      return r.every(c => !c);
    };
    for (let m = 1; m < p ** k; m++) {
      const f = []; let t = m; for (let j = 0; j < k; j++) { f.push(t % p); t = Math.floor(t / p); } f.push(1);
      if (!f[0]) continue;
      let ok = true;
      for (let dg = 1; ok && dg <= k >> 1; dg++) for (let g = 0; ok && g < p ** dg; g++) {
        const h = []; let u = g; for (let j = 0; j < dg; j++) { h.push(u % p); u = Math.floor(u / p); } h.push(1);
        if (divides(h, f)) ok = false;
      }
      if (ok) return f;
    }
    return null;
  }
  function field(q) {
    let p = 2; while (q % p) p++;
    let k = 0, t = q; while (t % p === 0) { t /= p; k++; }
    if (t !== 1) err(`${q} isn't a prime power, so there's no field with ${q} elements`);
    if (q > MAX_FIELD) err(`F_q only goes up to q = ${MAX_FIELD} here`);
    if (k === 1) return Object.assign(Zn(p), { name: `F_${p}`, ntex: `\\mathbb{F}_{${p}}` });
    const f = irreducibleOver(p, k);
    return quotient(p, f, "α", { name: `F_${q}`, ntex: `\\mathbb{F}_{${q}}`, field: true, note: `\\mathbb{F}_{${q}} = \\mathbb{F}_{${p}}[\\alpha]/(${polyShow(f, "α", true)})` });
  }
  function product(parts) {
    if (!parts.every(r => r.finite)) return infProduct(parts);
    const size = parts.reduce((s, r) => s * r.size, 1);
    if (size > 1e12) err("that product is too big");
    const dec = a => parts.map(r => { const c = a % r.size; a = (a - c) / r.size; return c; });
    const enc = cs => { let a = 0; for (let j = parts.length - 1; j >= 0; j--) a = a * parts[j].size + cs[j]; return a; };
    const r = finite({
      kind: "prod", parts, size, dec, enc, one: enc(parts.map(p => p.one)),
      name: parts.map(p => p.name).join(" × "), ntex: parts.map(p => p.ntex).join(" \\times "),
      add: (a, b) => { const x = dec(a), y = dec(b); return enc(parts.map((p, j) => p.add(x[j], y[j]))); },
      neg: a => enc(dec(a).map((c, j) => parts[j].neg(c))),
      mul: (a, b) => { const x = dec(a), y = dec(b); return enc(parts.map((p, j) => p.mul(x[j], y[j]))); },
      fromInt: v => enc(parts.map(p => p.fromInt(v))),
      atom: c => { const vs = parts.map(p => (p.atom ? p.atom(c) : null)); return vs.every(v => v != null) ? enc(vs) : null; },
      show: a => `(${dec(a).map((c, j) => parts[j].show(c)).join(", ")})`,
      tex: a => `(${dec(a).map((c, j) => parts[j].tex(c)).join(",\\ ")})`,
      inv: a => { const us = dec(a).map((c, j) => parts[j].inv(c)); return us.every(u => u != null) ? enc(us) : null; },
      // a root in a product is a root in every factor at once
      root: cs => {
        const rs = [];
        for (let j = 0; j < parts.length; j++) { const x = parts[j].root(cs.map(c => dec(c)[j])); if (!x) return null; rs.push(x.el); }
        const el = enc(rs);
        return { el, show: r.show(el), tex: r.tex(el) };
      },
    });
    r.parse = t => {
      const s = String(t).trim();
      if (/^\(.*\)$/.test(s)) {
        const bits = splitTop(s.slice(1, -1), ",");
        if (bits.length === parts.length) return enc(bits.map((b, j) => parts[j].parse(b)));
        if (bits.length > 1) err(`give ${parts.length} entries, like ${r.show(r.one)}`);
      }
      return enc(parts.map(p => p.parse(s)));
    };
    return r;
  }

  // ---------- infinite rings ----------
  const checkBig = x => (tooBig(x) ? err("that number is too big for this page") : x);
  const ZZ = {
    kind: "Z", finite: false, size: Infinity, name: "Z", ntex: "\\mathbb{Z}", zero: 0n, one: 1n, maxPow: 300,
    add: (a, b) => checkBig(a + b), sub: (a, b) => checkBig(a - b), neg: a => -a, mul: (a, b) => checkBig(a * b),
    div: (a, b) => (!b ? err("can't divide by 0") : a % b ? err(`${a}/${b} isn't an integer`) : a / b),
    fromInt: k => checkBig(k), isZero: a => a === 0n, eq: (a, b) => a === b, key: a => String(a),
    show: a => String(a), tex: a => String(a),
    root: cs => { const r = rationalRoot(cs, true); return r && { show: String(r[0]), tex: String(r[0]), el: r[0] }; },
  };
  ZZ.parse = t => parseExpr(ZZ, t);
  const ck = a => (tooBig(a[0]) || tooBig(a[1]) ? err("that number is too big for this page") : a);
  function rationals(kind) {
    const r = {
      kind, finite: false, size: Infinity, zero: [0n, 1n], one: [1n, 1n], maxPow: 300,
      name: kind, ntex: kind === "Q" ? "\\mathbb{Q}" : "\\mathbb{R}",
      add: (a, b) => ck(fadd(a, b)), sub: (a, b) => ck(fsub(a, b)), neg: fneg, mul: (a, b) => ck(fmul(a, b)),
      div: (a, b) => ck(fmul(a, finv(b))), fromInt: k => ck([k, 1n]),
      fromDec: (digits, scale) => ck(scale >= 0 ? [digits * 10n ** BigInt(scale), 1n] : fr(digits, 10n ** BigInt(-scale))),
      isZero: a => a[0] === 0n, eq: (a, b) => a[0] === b[0] && a[1] === b[1], key: fshow,
      show: fshow, tex: ftex,
    };
    r.parse = t => parseExpr(r, t);
    r.root = kind === "Q"
      ? cs => { const x = rationalRoot(fracsToInts(cs)); return x && { el: x, show: fshow(x), tex: ftex(x) }; }
      : cs => {
        const x = realRoot(fracsToInts(cs));
        if (!x) return null;
        return x.exact ? { el: x.exact, show: fshow(x.exact), tex: ftex(x.exact) } : { show: "≈ " + approxShow(x.approx), tex: "\\approx " + approxShow(x.approx), approx: true };
      };
    return r;
  }
  const QQ = rationals("Q"), RR = rationals("R");
  // Gaussian rationals [re, im]
  const cshow = (z, tex) => {
    const [a, b] = z, parts = [];
    if (a[0] || !b[0]) parts.push(tex ? ftex(a) : fshow(a));
    if (b[0]) {
      const n = babs(b[0]), d = b[1], sg = b[0] < 0n ? "-" : parts.length ? "+" : "";
      if (tex) parts.push(`${sg}${d === 1n ? (n === 1n ? "" : n) : `\\tfrac{${n}}{${d}}`}i`);
      else parts.push(`${sg}${n === 1n ? "" : n}i${d === 1n ? "" : "/" + d}`);
    }
    return parts.join("");
  };
  const CC = {
    kind: "C", finite: false, size: Infinity, name: "C", ntex: "\\mathbb{C}", zero: [[0n, 1n], [0n, 1n]], one: [[1n, 1n], [0n, 1n]], maxPow: 200,
    add: (z, w) => [ck(fadd(z[0], w[0])), ck(fadd(z[1], w[1]))],
    sub: (z, w) => [ck(fsub(z[0], w[0])), ck(fsub(z[1], w[1]))],
    neg: z => [fneg(z[0]), fneg(z[1])],
    mul: (z, w) => [ck(fsub(fmul(z[0], w[0]), fmul(z[1], w[1]))), ck(fadd(fmul(z[0], w[1]), fmul(z[1], w[0])))],
    div: (z, w) => {
      const nn = fadd(fmul(w[0], w[0]), fmul(w[1], w[1]));
      if (!nn[0]) err("can't divide by 0");
      const c = [w[0], fneg(w[1])], p = CC.mul(z, c);
      return [ck(fmul(p[0], finv(nn))), ck(fmul(p[1], finv(nn)))];
    },
    fromInt: k => [ck([k, 1n]), [0n, 1n]],
    fromDec: (digits, scale) => [QQ.fromDec(digits, scale), [0n, 1n]],
    atom: c => (c === "i" ? [[0n, 1n], [1n, 1n]] : null),
    isZero: z => !z[0][0] && !z[1][0], eq: (z, w) => cshow(z) === cshow(w), key: z => cshow(z),
    show: z => cshow(z), tex: z => cshow(z, true),
    // the fundamental theorem of algebra; the root shown is a numerical one (Durand–Kerner)
    root: cs => {
      cs = cs.slice(); while (cs.length && CC.isZero(cs[cs.length - 1])) cs.pop();
      if (!cs.length || CC.isZero(cs[0])) return { el: CC.zero, show: "0", tex: "0" };
      if (cs.length === 1) return null;
      const z = cs.map(c => [fnum(c[0]), fnum(c[1])]), d = z.length - 1, lc = z[d];
      const cdiv = (a, b) => { const n = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / n, (a[1] * b[0] - a[0] * b[1]) / n]; };
      const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
      const m = z.map(c => cdiv(c, lc));
      const f = x => { let acc = [1, 0]; for (let k = d - 1; k >= 0; k--) { acc = cmul(acc, x); acc = [acc[0] + m[k][0], acc[1] + m[k][1]]; } return acc; };
      let xs = Array.from({ length: d }, (_, k) => { const t = 0.4 + 0.9 * k; return [Math.cos(t) * 0.9 ** k, Math.sin(t) * 0.9 ** k]; });
      for (let it = 0; it < 500; it++) xs = xs.map((x, i) => { let den = [1, 0]; xs.forEach((y, j) => { if (j !== i) den = cmul(den, [x[0] - y[0], x[1] - y[1]]); }); const q = cdiv(f(x), den); return [x[0] - q[0], x[1] - q[1]]; });
      const x = xs[0], sc = 1e-9 * Math.max(1, Math.hypot(x[0], x[1]));
      if (!x.every(Number.isFinite)) return { show: "one, by the fundamental theorem of algebra", tex: "\\text{one (FTA)}", approx: true };
      const re = Math.abs(x[0]) < sc ? "" : approxShow(x[0]), ai = Math.abs(x[1]);
      const im = ai < sc ? "" : (x[1] < 0 ? "-" : re ? "+" : "") + (Math.abs(ai - 1) < sc ? "" : approxShow(ai)) + "i";
      const zs = re + im || "0";
      return { show: "≈ " + zs.replace(/-/g, "−"), tex: "\\approx " + zs, approx: true };
    },
  };
  CC.parse = t => parseExpr(CC, t);
  function infProduct(parts) {
    const r = {
      kind: "iprod", parts, finite: false, size: Infinity, maxPow: 200,
      name: parts.map(p => p.name).join(" × "), ntex: parts.map(p => p.ntex).join(" \\times "),
      zero: parts.map(p => p.zero), one: parts.map(p => p.one),
      add: (a, b) => parts.map((p, j) => p.add(a[j], b[j])), sub: (a, b) => parts.map((p, j) => p.sub(a[j], b[j])),
      neg: a => parts.map((p, j) => p.neg(a[j])), mul: (a, b) => parts.map((p, j) => p.mul(a[j], b[j])),
      fromInt: k => parts.map(p => p.fromInt(k)),
      isZero: a => parts.every((p, j) => p.isZero(a[j])), eq: (a, b) => parts.every((p, j) => p.eq(a[j], b[j])),
      key: a => r.show(a), show: a => `(${parts.map((p, j) => p.show(a[j])).join(", ")})`, tex: a => `(${parts.map((p, j) => p.tex(a[j])).join(",\\ ")})`,
      root: cs => {
        const rs = parts.map((p, j) => p.root(cs.map(c => c[j])));
        if (rs.some(x => !x)) return null;
        return { show: `(${rs.map(x => x.show).join(", ")})`, tex: `(${rs.map(x => x.tex).join(",\\ ")})`, approx: rs.some(x => x.approx), el: rs.every(x => x.el !== undefined) ? rs.map(x => x.el) : undefined };
      },
    };
    r.parse = t => {
      const s = String(t).trim();
      if (/^\(.*\)$/.test(s)) {
        const bits = splitTop(s.slice(1, -1), ",");
        if (bits.length === parts.length) return bits.map((b, j) => parts[j].parse(b));
        if (bits.length > 1) err(`give ${parts.length} entries, like ${r.show(r.one)}`);
      }
      return parts.map(p => p.parse(s));
    };
    return r;
  }

  // ---------- ring specs ----------
  function parseFactor(s) {
    let m;
    if (/^(Z|ZZ)$/i.test(s)) return ZZ;
    if (/^(Q|QQ)$/i.test(s)) return QQ;
    if (/^(R|RR)$/i.test(s)) return RR;
    if (/^(C|CC)$/i.test(s)) return CC;
    const base = String.raw`Z\/\(?(\d+)\)?Z?|Z_\{?(\d+)\}?|F_?\{?(\d+)\}?|GF\((\d+)\)`;
    const modOf = m => {
      if (m[1] || m[2]) return +(m[1] || m[2]);
      const p = +(m[3] || m[4]);
      if (!isPrime(p)) err(`use a prime field as the base, like F_3[t]/(t^2+1); F_${p} is already built as a quotient`);
      return p;
    };
    if ((m = s.match(new RegExp(`^(?:${base})$`, "i")))) {
      if (m[1] || m[2]) {
        const n = +(m[1] || m[2]);
        if (n < 2) err("n should be at least 2 (Z/1 is the zero ring, where 1 = 0)");
        if (n > MAX_ZN) err(`Z/n only goes up to n = ${MAX_ZN} here`);
        return Zn(n);
      }
      return field(+(m[3] || m[4]));
    }
    if ((m = s.match(/^Z\[i\]\/\((\d+)\)$/i))) return parseFactor(`Z/${m[1]}[i]`);
    if ((m = s.match(new RegExp(`^(?:${base})\\[([A-Za-wyzα])\\](?:\\/\\((.+)\\))?$`, "i")))) {
      const n = modOf(m), sym = m[5];
      if (sym === "x" || sym === "X") err("x is the polynomial's variable; call the generator something else, like t");
      if (n < 2) err("n should be at least 2");
      let f;
      if (m[6] === undefined) {
        if (sym !== "i") err(`add a modulus, like Z/${n}[${sym}]/(${sym}^2+1); Z/${n}[${sym}] by itself is infinite`);
        f = [1 % n, 0, 1 % n];
      } else {
        f = parseExpr(polyRing(n, sym), m[6]);
        if (f.length < 2) err("the modulus needs degree at least 1");
        const u = modInv(f[f.length - 1], n);
        if (u == null) err(`the leading coefficient of the modulus should be a unit mod ${n}`);
        f = f.map(c => (c * u) % n);
      }
      if (n ** (f.length - 1) > MAX_QUOT) err(`that ring has ${n}^${f.length - 1} elements; the limit here is ${MAX_QUOT}`);
      const nm = m[6] === undefined ? { name: `Z/${n}[i]`, ntex: `\\mathbb{Z}/${n}[i]` } : {};
      return quotient(n, f, sym, nm);
    }
    if (/^Z\[/i.test(s) || /^Q\[/i.test(s)) err("polynomial rings like that are infinite; try a quotient like Z/5[t]/(t^2+2)");
    err(`can't read "${s}". Try Z/6, F_9, Z/4[t]/(t^2), Z/3[i], Z/2 × Z/3, Z, Q, R or C`);
  }
  function parseRing(text) {
    const s = String(text || "").replace(/\s+/g, "").replace(/ℤ/g, "Z").replace(/ℚ/g, "Q").replace(/ℝ/g, "R").replace(/ℂ/g, "C").replace(/𝔽/g, "F").replace(/⊕/g, "×");
    if (!s) err("type a ring, like Z/6");
    if (s.length > 60) err("that's too long");
    const bits = splitTop(s, "×x*");
    if (bits.some(b => !b)) err("an empty factor in that product");
    if (bits.length > MAX_FACTORS) err(`at most ${MAX_FACTORS} factors`);
    const parts = bits.map(parseFactor), r = parts.length === 1 ? parts[0] : product(parts);
    r.spec = r.name;
    return r;
  }
  function describe(r) {
    if (!r.finite) return { Z: "the integers", Q: "the rationals", R: "the reals (entries are typed as exact rationals)", C: "the complex numbers (entries a+bi with rational a, b)" }[r.kind] || "an infinite product";
    return `${r.size.toLocaleString("en-US")} elements${r.field ? ", a field" : ""}`;
  }

  // ---------- the game ----------
  // g = {d, first, turn ("A" wants a root, "S" wants none), c: coefficients (null = not chosen), log: [{k, v, by}], winner, root}
  const other = s => (s === "A" ? "S" : "A");
  function newGame(d, first = "A") {
    if (!Number.isInteger(d) || d < DMIN || d > DMAX) err(`the degree should be ${DMIN} to ${DMAX}`);
    return { d, first, turn: first, c: new Array(d + 1).fill(null), log: [], winner: null, root: null };
  }
  const needsNonzero = (g, k) => k === 0 || k === g.d;
  function moveError(ring, g, k, v) {
    if (g.winner) return "the game is over";
    if (!Number.isInteger(k) || k < 0 || k > g.d) return "no such coefficient";
    if (g.c[k] !== null) return "that coefficient is already chosen";
    if (needsNonzero(g, k) && ring.isZero(v)) return k === 0 ? "the constant term can't be 0" : "the leading coefficient can't be 0";
    return null;
  }
  function play(ring, g, k, v) {
    const e = moveError(ring, g, k, v);
    if (e) err(e);
    g.c[k] = v; g.log.push({ k, v, by: g.turn }); g.turn = other(g.turn);
    if (g.c.every(x => x !== null)) { g.root = ring.root(g.c); g.winner = g.root ? "A" : "S"; }
    return g;
  }
  const unset = g => g.c.map((v, k) => (v === null ? k : -1)).filter(k => k >= 0);

  root.CoeffGame = {
    parseRing, describe, parseExpr, newGame, play, moveError, needsNonzero, other, unset, DMIN, DMAX,
    // exposed for tests and for computer Amog
    fr, fadd, fsub, fmul, fneg, fnum, rationalRoot, realRoot, squarefree, isolate, simplest, isPrime, modInv, irreducibleOver,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
