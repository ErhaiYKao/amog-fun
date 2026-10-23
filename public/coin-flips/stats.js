/* Coin Flip Court — the statistics. Pure (no DOM), runs in Node for tests.
 * Every test reports its statistic x and both tails, P(X >= x) and P(X <= x), under n fair independent flips
 * (or rolls of a fair k-sided die, faces 1..k).
 * Exact where a DP does it (always summing probability mass, never 1 - (tiny), so small p-values stay accurate);
 * seeded Monte Carlo for the rest (marked sim). */
(function (root) {
  "use strict";

  const parse = text => {
    const out = [];
    for (const ch of String(text).toUpperCase()) if (ch === "H" || ch === "1") out.push(1); else if (ch === "T" || ch === "0") out.push(0);
    return out;
  };
  const parseDice = (text, k) => {
    const out = [];
    for (const ch of String(text)) { const d = ch.charCodeAt(0) - 48; if (d >= 1 && d <= k) out.push(d); }
    return out;
  };

  // ---- exact distributions ----
  const logFact = (() => { const t = [0]; return n => { while (t.length <= n) t.push(t[t.length - 1] + Math.log(t.length)); return t[n]; }; })();
  const logBinom = (n, i, p) => logFact(n) - logFact(i) - logFact(n - i) + (i ? i * Math.log(p) : 0) + (n - i ? (n - i) * Math.log1p(-p) : 0);
  // P(Binomial(n, p) >= k) and <= k, summing terms in log space
  function binomTail(n, k, upper, p = 0.5) {
    const lo = upper ? Math.max(k, 0) : 0, hi = upper ? n : Math.min(k, n);
    if (lo > hi) return 0;
    let m = -Infinity; const ls = [];
    for (let i = lo; i <= hi; i++) { const l = logBinom(n, i, p); ls.push(l); if (l > m) m = l; }
    return Math.min(1, Math.exp(m) * ls.reduce((a, l) => a + Math.exp(l - m), 0));
  }

  // runs in n fair trials. mode "any": runs of identical outcomes, each trial repeats the last with probability pc;
  // "one": runs of a fixed event of probability pc. returns [P(longest >= L), P(longest < L)], both as accumulated mass.
  function runSplit(n, L, mode, pc = 0.5) {
    if (n <= 0) return L <= 0 ? [1, 0] : [0, 1];
    if (L <= 0 || (L <= 1 && mode === "any")) return [1, 0];
    let p = new Float64Array(L), hit = 0; // p[r] = mass with current run length r (< L), not yet reached L
    let start = 0;
    if (mode === "any") { p[1] = 1; start = 1; } else p[0] = 1;
    for (let i = start; i < n; i++) {
      const q = new Float64Array(L);
      let total = 0;
      for (let r = 0; r < L; r++) total += p[r];
      q[mode === "any" ? 1 : 0] = total * (1 - pc);         // a different outcome starts a new run / resets it
      for (let r = 0; r < L; r++) { if (r + 1 < L) q[r + 1] += p[r] * pc; else hit += p[r] * pc; }
      p = q;
    }
    let rest = 0; for (let r = 0; r < L; r++) rest += p[r];
    return [hit, rest];
  }

  // simple random walk S (heads +1, tails -1): [P(max |S_k| >= m), P(max |S_k| < m)]
  function leadSplit(n, m) {
    if (m <= 0) return [1, 0];
    let p = new Float64Array(2 * m + 1), hit = 0; p[m] = 1; // index = S + m, live for |S| < m
    for (let i = 0; i < n; i++) {
      const q = new Float64Array(2 * m + 1);
      for (let j = 1; j < 2 * m; j++) {
        if (!p[j]) continue;
        for (const d of [-1, 1]) { const k = j + d; if (k <= 0 || k >= 2 * m) hit += p[j] / 2; else q[k] += p[j] / 2; }
      }
      p = q;
    }
    let rest = 0; for (const v of p) rest += v;
    return [hit, rest];
  }
  // both tails of an integer statistic from a "split at threshold" function
  const tails = (split, x) => ({ ge: split(x)[0], le: split(x + 1)[1] });

  // longest palindrome >= L iff some window of length L or L+1 is a palindrome (trim a longer one from both ends).
  // Union bound over those windows: an upper bound, and nearly exact once small, because two overlapping palindromic
  // windows force a short period, so the overcount is only a factor ~ 1 + (n + 4L) k^(-L/2).
  function palBound(n, L, k = 2) {
    if (L <= 1) return 1;
    let u = 0;
    for (const len of [L, L + 1]) if (len <= n) u += (n - len + 1) * Math.pow(k, -Math.floor(len / 2));
    return u;
  }
  const PAL_EXACT = 0.01; // below this the bound is within ~2% of the truth (tested), and the simulation can't see it

  // ---- dice ----
  // face counts of n rolls of a fair k-sided die, one face at a time: the next face's count is Bin(rolls left, 1/faces left).
  // mode "max": [P(some count >= m), P(all < m)]; mode "min": [P(some count <= m), P(all > m)].
  function countSplit(n, k, m, mode) {
    let p = new Float64Array(n + 1), hit = 0; p[n] = 1;
    for (let j = k; j >= 1; j--) {
      const q = new Float64Array(n + 1);
      for (let r = 0; r <= n; r++) {
        if (!p[r]) continue;
        for (let c = j === 1 ? r : 0; c <= r; c++) {
          const w = j === 1 ? p[r] : p[r] * Math.exp(logBinom(r, c, 1 / j));
          if (mode === "max" ? c >= m : c <= m) hit += w; else q[r - c] += w;
        }
      }
      p = q;
    }
    return [hit, p[0]];
  }
  // pmf of the sum of n rolls, where face i (0-based) scores w[i] (small non-negative integers)
  function sumDist(n, w) {
    const k = w.length, top = Math.max(...w);
    let p = Float64Array.of(1);
    for (let i = 0; i < n; i++) {
      const q = new Float64Array(p.length + top);
      for (let s = 0; s < p.length; s++) { const v = p[s] / k; if (v) for (const x of w) q[s + x] += v; }
      p = q;
    }
    return p;
  }
  // pmf of the sum of |x_i - x_(i+1)| over neighbouring rolls
  function jumpDist(n, k) {
    if (n < 2) return Float64Array.of(1);
    let p = Array.from({ length: k }, () => Float64Array.of(1 / k)); // p[last face][sum so far]
    for (let i = 1; i < n; i++) {
      const len = p[0].length + k - 1, q = Array.from({ length: k }, () => new Float64Array(len));
      for (let a = 0; a < k; a++) for (let s = 0; s < p[a].length; s++) {
        const v = p[a][s] / k; if (!v) continue;
        for (let b = 0; b < k; b++) q[b][s + Math.abs(a - b)] += v;
      }
      p = q;
    }
    const out = new Float64Array(p[0].length);
    for (const row of p) for (let s = 0; s < row.length; s++) out[s] += row[s];
    return out;
  }
  const pmfTails = (p, x) => { let ge = 0, le = 0; for (let s = 0; s < p.length; s++) { if (s >= x) ge += p[s]; if (s <= x) le += p[s]; } return { ge: Math.min(1, ge), le: Math.min(1, le) }; };
  // squared distance from the middle, (2x - k - 1)^2, shrunk to small integers: (v - vmin) / g
  function spreadScores(k) {
    const v = Array.from({ length: k }, (_, i) => (2 * (i + 1) - k - 1) ** 2), lo = Math.min(...v);
    const gcd = (a, b) => b ? gcd(b, a % b) : a, g = v.reduce((a, x) => gcd(a, x - lo), 0) || 1;
    return { w: v.map(x => (x - lo) / g), lo, g };
  }

  // ---- statistics ----
  function longestRun(f, face) { // face undefined = either face
    let best = 0, cur = 0;
    for (let i = 0; i < f.length; i++) {
      if (face === undefined) cur = i > 0 && f[i] === f[i - 1] ? cur + 1 : 1;
      else cur = f[i] === face ? cur + 1 : 0;
      if (cur > best) best = cur;
    }
    return best;
  }
  function longestAlternating(f) {
    if (!f.length) return 0;
    let best = 1, cur = 1;
    for (let i = 1; i < f.length; i++) { cur = f[i] !== f[i - 1] ? cur + 1 : 1; if (cur > best) best = cur; }
    return best;
  }
  const runCount = f => f.length ? 1 + f.reduce((a, v, i) => a + (i > 0 && v !== f[i - 1] ? 1 : 0), 0) : 0;
  const repeats = f => f.reduce((a, v, i) => a + (i > 0 && v === f[i - 1] ? 1 : 0), 0);
  const jumps = f => f.reduce((a, v, i) => a + (i > 0 ? Math.abs(v - f[i - 1]) : 0), 0);
  function maxLead(f) { let s = 0, m = 0; for (const v of f) { s += v ? 1 : -1; if (Math.abs(s) > m) m = Math.abs(s); } return m; }
  // Manacher: length of the longest palindromic substring
  function longestPalindrome(f) {
    const n = f.length; if (!n) return 0;
    const t = new Int8Array(2 * n + 1).fill(-1);
    for (let i = 0; i < n; i++) t[2 * i + 1] = f[i];
    const r = new Int32Array(t.length); let c = 0, right = 0, best = 0;
    for (let i = 0; i < t.length; i++) {
      if (i < right) r[i] = Math.min(right - i, r[2 * c - i]);
      while (i - r[i] - 1 >= 0 && i + r[i] + 1 < t.length && t[i - r[i] - 1] === t[i + r[i] + 1]) r[i]++;
      if (i + r[i] > right) { c = i; right = i + r[i]; }
      if (r[i] > best) best = r[i];
    }
    return best;
  }
  const blockLen = n => n >= 48 ? 4 : 3;
  function distinctBlocks(f, k) {
    const seen = new Uint8Array(1 << k); let v = 0, count = 0;
    for (let i = 0; i < f.length; i++) {
      v = ((v << 1) | f[i]) & ((1 << k) - 1);
      if (i >= k - 1 && !seen[v]) { seen[v] = 1; count++; }
    }
    return count;
  }

  // where a stretch statistic happens: [start, length] of its first occurrence
  function where(f, id) {
    const n = f.length; let best = 0, at = 0, cur = 0;
    const scan = ok => { best = 0; at = 0; cur = 0; for (let i = 0; i < n; i++) { cur = ok(i) ? cur + 1 : 1; if (cur > best) { best = cur; at = i - cur + 1; } } };
    if (id === "run") scan(i => i > 0 && f[i] === f[i - 1]);
    else if (id === "alt") scan(i => i > 0 && f[i] !== f[i - 1]);
    else if (id === "runH" || id === "runT") {
      const face = id === "runH" ? 1 : 0;
      for (let i = 0; i < n; i++) { cur = f[i] === face ? cur + 1 : 0; if (cur > best) { best = cur; at = i - cur + 1; } }
    } else if (id === "pal") {
      for (let c = 0; c < 2 * n - 1; c++) { // centre between/at flips
        let l = Math.floor(c / 2), r = l + (c % 2);
        while (l >= 0 && r < n && f[l] === f[r]) { l--; r++; }
        if (r - l - 1 > best) { best = r - l - 1; at = l + 1; }
      }
    } else return null;
    return best ? [at, best] : null;
  }

  // seeded so the same sequence always gets the same simulated p-values
  function rng(seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    return () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a; };
  }
  function simulate(n, stats, sims, seed, k = 2) {
    const next = rng(seed), f = new Uint8Array(n), out = stats.map(() => ({ ge: 1, le: 1 }));
    for (let s = 0; s < sims; s++) {
      if (k === 2) for (let i = 0; i < n; i += 32) { const w = next(); for (let b = 0; b < 32 && i + b < n; b++) f[i + b] = (w >>> b) & 1; }
      else for (let i = 0; i < n; i++) f[i] = 1 + Math.floor(next() / 2 ** 32 * k);
      stats.forEach((st, j) => { const v = st.fn(f); if (v >= st.x) out[j].ge++; if (v <= st.x) out[j].le++; });
    }
    return out.map(o => ({ ge: o.ge / (sims + 1), le: o.le / (sims + 1) }));
  }
  const hash = (f, k = 2) => { let h = 2166136261; for (const v of f) h = Math.imul(h ^ v, 16777619); return h ^ f.length ^ (k << 20); };
  const simCount = (n, opts) => opts.sims ?? Math.max(400, Math.min(5000, Math.round(4e6 / Math.max(n, 1))));
  // the simulation can't see below 1/(sims+1); far palindrome tails come from the bound instead
  function palTails(r, n, k) {
    const u = palBound(n, r.x, k), v = palBound(n, r.x + 1, k);
    if (u < PAL_EXACT) { r.ge = u; r.bound = true; }
    if (v < PAL_EXACT) r.le = 1 - v;
  }

  const MAX = 4000, MAX_DICE = 1000;
  // runs every test; returns [{id, name, x, unit, ge, le, sim, ...}]
  function analyse(f, opts = {}) {
    const n = f.length, heads = f.reduce((a, v) => a + v, 0);
    const res = [];
    const add = (id, name, x, ge, le, extra) => res.push({ id, name, x, ge, le, ...extra });
    add("heads", "heads", heads, binomTail(n, heads, true), binomTail(n, heads, false), { more: "heads", fewer: "heads", alt: `${n - heads} tails` });
    const runs = runCount(f);
    add("runs", "chunks of identical flips", runs, binomTail(n - 1, runs - 1, true), binomTail(n - 1, runs - 1, false), { more: "chunks", fewer: "chunks" });
    add("run", "longest run of identical flips", longestRun(f), ...Object.values(tails(L => runSplit(n, L, "any"), longestRun(f))), { more: "long", fewer: "short" });
    const lh = longestRun(f, 1), lt = longestRun(f, 0);
    add("runH", "longest run of heads", lh, ...Object.values(tails(L => runSplit(n, L, "one"), lh)), { more: "long", fewer: "short" });
    add("runT", "longest run of tails", lt, ...Object.values(tails(L => runSplit(n, L, "one"), lt)), { more: "long", fewer: "short" });
    // an alternating stretch of length L is a run of L-1 "changes" among the n-1 consecutive pairs
    const la = longestAlternating(f);
    add("alt", "longest alternating stretch", la, ...Object.values(tails(L => runSplit(n - 1, L - 1, "one"), la)), { more: "long", fewer: "short" });
    const lead = maxLead(f);
    add("lead", "biggest lead either side ever had", lead, ...Object.values(tails(m => leadSplit(n, m), lead)), { more: "big", fewer: "small" });
    const k = blockLen(n), sims = simCount(n, opts);
    const simStats = [
      { id: "pal", name: "longest palindrome", fn: longestPalindrome, more: "long", fewer: "short" },
      { id: "blocks", name: `different ${k}-flip patterns that show up`, fn: g => distinctBlocks(g, k), more: "many", fewer: "few", of: 1 << k },
    ].map(st => ({ ...st, x: st.fn(f) }));
    simulate(n, simStats, sims, hash(f)).forEach((p, j) => {
      const st = simStats[j];
      add(st.id, st.name, st.x, p.ge, p.le, { more: st.more, fewer: st.fewer, sim: sims, of: st.of });
    });
    palTails(res.find(r => r.id === "pal"), n, 2);
    for (const r of res) r.at = n <= MAX ? where(f, r.id) : null;
    return res;
  }

  // the dice court: f holds faces 1..k
  function analyseDice(f, k, opts = {}) {
    const n = f.length, res = [];
    const add = (id, x, t, extra) => res.push({ id, x, ge: t.ge, le: t.le, ...extra });
    const sum = f.reduce((a, v) => a + v, 0);
    add("sum", sum, pmfTails(sumDist(n, Array.from({ length: k }, (_, i) => i)), sum - n), { mean: sum / n });
    const sp = spreadScores(k), spread = f.reduce((a, v) => a + sp.w[v - 1], 0);
    add("spread", spread, pmfTails(sumDist(n, sp.w), spread), { show: (sp.g * spread + n * sp.lo) / (4 * n), fair: (k * k - 1) / 12 });
    const cnt = Array(k).fill(0); for (const v of f) cnt[v - 1]++;
    const most = Math.max(...cnt), least = Math.min(...cnt);
    add("most", most, { ge: countSplit(n, k, most, "max")[0], le: countSplit(n, k, most + 1, "max")[1] }, { face: cnt.indexOf(most) + 1 });
    add("least", least, { ge: countSplit(n, k, least - 1, "min")[1], le: countSplit(n, k, least, "min")[0] }, { face: cnt.indexOf(least) + 1 });
    const rep = repeats(f);
    add("rep", rep, { ge: binomTail(n - 1, rep, true, 1 / k), le: binomTail(n - 1, rep, false, 1 / k) });
    const run = longestRun(f);
    add("run", run, tails(L => runSplit(n, L, "any", 1 / k), run));
    const jmp = jumps(f);
    add("jump", jmp, pmfTails(jumpDist(n, k), jmp), { show: n > 1 ? jmp / (n - 1) : 0, fair: (k * k - 1) / (3 * k) });
    const sims = simCount(n, opts), pal = { id: "pal", fn: longestPalindrome, x: longestPalindrome(f) };
    const [p] = simulate(n, [pal], sims, hash(f, k), k);
    add("pal", pal.x, p, { sim: sims });
    palTails(res[res.length - 1], n, k);
    for (const r of res) r.at = where(f, r.id);
    return res;
  }

  root.CoinFlips = {
    parse, parseDice, analyse, analyseDice, binomTail, runSplit, leadSplit, palBound, countSplit, sumDist, jumpDist, spreadScores,
    longestRun, longestAlternating, runCount, repeats, jumps, maxLead, longestPalindrome, distinctBlocks, where, MAX, MAX_DICE,
  };
})(typeof window !== "undefined" ? window : globalThis);
