/* Computer Amog for the Coefficient Choosing Game (needs ring.js; pure, runs in Node too).
 * Finite rings up to MAX_N elements: perfect play. Minimax over partial polynomials, memoised per ring, degree and
 * first player. A position keeps s(x) = (chosen part of p)(x) for every x, the leaf test is "some s(x) = 0", and the
 * last move is a lookup: pre[k][x·N + t] lists the v with v·x^k = t. A work budget keeps a decision under a second;
 * past it Amog guesses instead.
 * Guessing (big finite rings, Z, Q, R, C): the last move is found directly (aim for a root at some x, or try values
 * until no root is left), with two coefficients left every move is checked against the opponent's best last move,
 * and before that moves are scored by random playouts that end with that last move. */
(function (root) {
  "use strict";
  const G = root.CoeffGame;
  const ABORT = { abort: true }, MAX_N = 64, BUDGET = 1.5e7, MAX_MEMO = 2e6;
  const other = G.other;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const pick = (a, rng) => a[Math.floor(rng() * a.length)];
  const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- perfect play on small finite rings ----------
  const solvers = new Map();
  function solver(ring, d, first) {
    if (!ring.finite || ring.size > MAX_N) return null;
    const id = `${ring.name}|${d}|${first}`;
    if (solvers.has(id)) return solvers.get(id);
    const N = ring.size, D = d + 1;
    const add = new Int32Array(N * N), mul = new Int32Array(N * N), neg = new Int32Array(N);
    for (let a = 0; a < N; a++) { neg[a] = ring.neg(a); for (let b = 0; b < N; b++) { add[a * N + b] = ring.add(a, b); mul[a * N + b] = ring.mul(a, b); } }
    const xp = new Int32Array(N * D);
    for (let x = 0; x < N; x++) { xp[x * D] = ring.one; for (let k = 1; k < D; k++) xp[x * D + k] = mul[xp[x * D + k - 1] * N + x]; }
    const con = [], pre = []; // con[k][v·N + x] = v·x^k
    for (let k = 0; k < D; k++) {
      con[k] = new Int32Array(N * N); pre[k] = Array.from({ length: N * N }, () => []);
      for (let v = 0; v < N; v++) for (let x = 0; x < N; x++) { const t = mul[v * N + xp[x * D + k]]; con[k][v * N + x] = t; pre[k][x * N + t].push(v); }
    }
    const numeric = (N + 1) ** D < 2 ** 52, pw = Array.from({ length: D }, (_, k) => (N + 1) ** k);
    const keyOf = c => (numeric ? c.reduce((a, v, k) => a + (v + 1) * pw[k], 0) : c.join(","));
    const nzFrom = k => (k === 0 || k === d ? 1 : 0);
    let memo = new Map(), work = 0, limit = BUDGET, st = 0;
    const stamp = new Int32Array(N);
    const step = (s, k, v) => { const r = new Int32Array(N), ck = con[k]; for (let x = 0; x < N; x++) r[x] = add[s[x] * N + ck[v * N + x]]; return r; };
    const hasZero = s => { for (let x = 0; x < N; x++) if (s[x] === 0) return true; return false; };
    function canHit(k, s) { // A to fill a_k last: can some x become a root?
      const nz = nzFrom(k);
      for (let x = 0; x < N; x++) { const l = pre[k][x * N + neg[s[x]]]; if (l.length > 1 || (l.length && l[0] >= nz)) return true; }
      return false;
    }
    function canDodge(k, s) { // S to fill a_k last: is some v a root of nothing?
      st++;
      for (let x = 0; x < N; x++) for (const v of pre[k][x * N + neg[s[x]]]) stamp[v] = st;
      for (let v = nzFrom(k); v < N; v++) if (stamp[v] !== st) return true;
      return false;
    }
    function win(c, s, u, turn) { // does A win with perfect play?
      const key = keyOf(c), m = memo.get(key);
      if (m !== undefined) return m;
      if ((work += N) > limit) throw ABORT;
      let res;
      if (u === 1) { const k = c.indexOf(-1); work += N; res = turn === "A" ? canHit(k, s) : !canDodge(k, s); }
      else {
        res = turn === "S";
        outer: for (let k = 0; k < D; k++) if (c[k] < 0) for (let v = nzFrom(k); v < N; v++) {
          c[k] = v; work += N;
          const w = win(c, step(s, k, v), u - 1, other(turn));
          c[k] = -1;
          if (w === (turn === "A")) { res = w; break outer; }
        }
      }
      memo.set(key, res);
      return res;
    }
    function start(g, budget = BUDGET) {
      if (memo.size > MAX_MEMO) memo = new Map();
      work = 0; limit = budget;
      const c = Int32Array.from(g.c, v => (v === null ? -1 : v));
      let s = new Int32Array(N);
      c.forEach((v, k) => { if (v >= 0) s = step(s, k, v); });
      return { c, s, u: c.filter(v => v < 0).length };
    }
    const S = {
      perfect: true,
      value(g, budget) { const { c, s, u } = start(g, budget); if (!u) return hasZero(s) ? "A" : "S"; return win(c, s, u, g.turn) ? "A" : "S"; },
      best(g, rng) {
        const { c, s, u } = start(g), me = g.turn, moves = [];
        for (let k = 0; k < D; k++) if (c[k] < 0) for (let v = nzFrom(k); v < N; v++) moves.push([k, v]);
        shuffle(moves, rng);
        for (const [k, v] of moves) {
          const s2 = step(s, k, v);
          c[k] = v;
          const aWins = u === 1 ? hasZero(s2) : win(c, s2, u - 1, other(me));
          c[k] = -1;
          if (aWins === (me === "A")) return { k, v, wins: true };
        }
        return { k: moves[0][0], v: moves[0][1], wins: false };
      },
    };
    solvers.set(id, S);
    return S;
  }

  // ---------- guessing ----------
  const INF = {
    Z: ["0", "1", "-1", "2", "-2", "3", "-3", "5", "-7", "10", "-10", "100", "-100", "1000", "-10^6", "10^9", "-10^9"],
    Q: ["1/2", "-1/2", "1/3", "-3/2", "1/1000"],
    C: ["0", "1", "-1", "i", "-i", "1+i", "2-i", "2", "-3i", "1/2"],
  };
  const pool = new WeakMap();
  function samples(ring, rng, n = 8) {
    if (ring.finite) {
      if (ring.size <= n) return Array.from({ length: ring.size }, (_, i) => i);
      const set = new Set([0, ring.one, ring.neg(ring.one)]);
      while (set.size < n) set.add(ring.random(rng));
      return [...set];
    }
    if (ring.kind === "iprod") return Array.from({ length: n }, () => ring.parts.map(p => pick(samples(p, rng, n), rng)));
    if (!pool.has(ring)) pool.set(ring, (ring.kind === "C" ? INF.C : ring.kind === "Z" ? INF.Z : INF.Z.concat(INF.Q)).map(t => ring.parse(t)));
    return shuffle(pool.get(ring).slice(), rng).slice(0, n);
  }
  const rest = (ring, c, k, x) => { // (p without its x^k term)(x)
    let acc = ring.zero;
    for (let j = c.length - 1; j >= 0; j--) acc = ring.add(ring.mul(acc, x), j === k ? ring.zero : c[j]);
    return acc;
  };
  const xpow = (ring, x, k) => { let r = ring.one; for (let j = 0; j < k; j++) r = ring.mul(r, x); return r; };
  function aim(ring, c, k, x) { // the v that makes x a root, if there is one
    const t = ring.neg(rest(ring, c, k, x)), w = xpow(ring, x, k);
    if (ring.kind === "zn") { // v·w ≡ t (mod n): solvable iff gcd(w, n) | t, then v ≡ v0 (mod n/gcd)
      const n = ring.n, gg = gcd(w, n);
      if (t % gg) return null;
      const m = n / gg;
      if (m === 1) return 1 % n;
      const v0 = ((t / gg) % m) * G.modInv((w / gg) % m, m) % m;
      return v0 || (m < n ? m : 0); // prefer a nonzero solution
    }
    if (ring.finite) { const u = ring.inv(w); return u == null ? null : ring.mul(t, u); }
    if (ring.isZero(w)) return null;
    try { return ring.div(t, w); } catch { return null; } // Z: only when it divides
  }
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  function divisors(n) { // of a BigInt, both signs, or null if it's too big to factor quickly
    n = n < 0n ? -n : n;
    if (n > 10n ** 12n) return null;
    const ds = [];
    for (let i = 1n; i * i <= n; i++) if (n % i === 0n) { ds.push(i); if (i * i !== n) ds.push(n / i); if (ds.length > 4000) return null; }
    return ds.flatMap(x => [x, -x]);
  }
  function aimPoints(ring, c, k, rng) {
    if (ring.finite) {
      const all = ring.size <= (ring.kind === "zn" ? 1e5 : 400);
      return all ? shuffle(Array.from({ length: ring.size }, (_, i) => i), rng) : Array.from({ length: 400 }, () => ring.random(rng));
    }
    const small = ["1", "-1", "2", "-2", "3", "-3", "4", "-4", "5", "-5", "7", "10", "-10"].map(t => ring.parse(t));
    if (ring.kind === "Z" && k > 0) { const ds = divisors(c[0]); if (ds) return ds; } // every integer root divides a_0
    if (ring.kind === "Z") return small.concat(Array.from({ length: 30 }, (_, i) => BigInt(i + 6)).flatMap(x => [x, -x]));
    return small.concat(["1/2", "-1/2", "1/3", "-2/3", "3/2"].map(t => ring.parse(t)));
  }
  function dodgeValues(ring, c, k, rng) {
    const d = c.length - 1;
    if (ring.finite) {
      if (ring.size <= 400) return shuffle(Array.from({ length: ring.size }, (_, i) => i), rng);
      const n = Math.max(4, Math.min(300, Math.floor(3e6 / (ring.size * (d + 1)))));
      return Array.from({ length: n }, () => ring.random(rng));
    }
    const P = t => ring.parse(t);
    if (ring.kind === "R") { // a_0 or a_d huge with the other end's sign keeps p positive (or negative)
      const end = k === 0 ? c[d] : k === d ? c[0] : null, sg = end && end[0] < 0n ? "-" : "";
      const ups = Array.from({ length: 31 }, (_, m) => `${sg}10^${m}`);
      return (end ? ups : ["0", "1", "-1", "2", "-2"].concat(Array.from({ length: 24 }, (_, m) => [`10^${m - 6}`, `-10^${m - 6}`]).flat())).map(P);
    }
    const ps = ["0", "1", "-1", "2", "-2", "3", "-3", "5", "-5", "7", "11", "-13", "101", "-1009", "10007", "1000003", "-1000033", "10^9+7", "10^12+39"];
    return ps.concat(ring.kind === "Q" ? ["1/2", "-2/3", "7/5", "1/101"] : []).map(P);
  }
  // the v for a_k that wins when it's the last coefficient (wantRoot: for A), or null if Amog can't find one
  function lastMove(ring, c, k, wantRoot, rng, nz = k === 0 || k === c.length - 1) {
    const ok = v => !(nz && ring.isZero(v));
    if (ring.kind === "prod" || ring.kind === "iprod") return lastProd(ring, c, k, wantRoot, rng, nz);
    if (!wantRoot && (ring.kind === "C" || (ring.kind === "R" && (c.length - 1) % 2))) return null; // there's always a root
    const t0 = now();
    if (wantRoot) for (const x of aimPoints(ring, c, k, rng)) {
      const v = aim(ring, c, k, x);
      if (v != null && ok(v)) return v;
      if (now() - t0 > 400) break;
    }
    for (const v of dodgeValues(ring, c, k, rng)) {
      if (!ok(v)) continue;
      const cc = c.slice(); cc[k] = v;
      if (!!ring.root(cc) === wantRoot) return v;
      if (now() - t0 > 600) break;
    }
    return null;
  }
  function lastProd(ring, c, k, wantRoot, rng, nz) { // a root in a product is a root in every factor
    const parts = ring.parts, fin = ring.kind === "prod";
    const proj = j => c.map(v => (v === null ? null : fin ? ring.dec(v)[j] : v[j]));
    const join = vs => (fin ? ring.enc(vs) : vs);
    if (wantRoot) {
      const vs = [];
      for (let j = 0; j < parts.length; j++) { const v = lastMove(parts[j], proj(j), k, true, rng, false); if (v == null) return null; vs.push(v); }
      if (nz && vs.every((v, j) => parts[j].isZero(v)))
        for (let j = 0; j < parts.length; j++) { const v = lastMove(parts[j], proj(j), k, true, rng, true); if (v != null) { vs[j] = v; break; } }
      const v = join(vs);
      return nz && ring.isZero(v) ? null : v;
    }
    for (const j of shuffle(parts.map((_, j) => j), rng)) {
      const v = lastMove(parts[j], proj(j), k, false, rng, false);
      if (v != null) return join(parts.map((p, i) => (i === j ? v : p.one)));
    }
    return null;
  }
  const allowedOf = (ring, g, k, vs) => vs.filter(v => !(G.needsNonzero(g, k) && ring.isZero(v)));
  function guess(ring, g, rng, ms) {
    const me = g.turn, u = G.unset(g), t0 = now();
    const anyMove = () => { const k = pick(u, rng); return { k, v: pick(allowedOf(ring, g, k, samples(ring, rng, 6)), rng) }; };
    if (ring.kind === "C" || (ring.kind === "R" && g.d % 2)) return { ...anyMove(), wins: me === "A" }; // A has already won
    if (u.length === 1) {
      const v = lastMove(ring, g.c, u[0], me === "A", rng);
      return v != null ? { k: u[0], v, wins: true } : { ...anyMove(), wins: false };
    }
    let moves = [];
    for (const k of u) for (const v of allowedOf(ring, g, k, samples(ring, rng, 7))) moves.push({ k, v });
    moves = shuffle(moves, rng).slice(0, 40);
    if (u.length === 2) { // the opponent moves last: find a move their best last move can't answer
      for (const m of moves) {
        const c = g.c.slice(); c[m.k] = m.v;
        if (lastMove(ring, c, u.find(k => k !== m.k), other(me) === "A", rng) == null) return { ...m, wins: true };
        if (now() - t0 > ms * 2) break;
      }
      return { ...moves[0], wins: false };
    }
    const vals = samples(ring, rng, 12), stats = moves.map(() => [0, 0]);
    for (let round = 0; round < 50 && (round < 1 || now() - t0 < ms); round++)
      for (let i = 0; i < moves.length; i++) {
        stats[i][1]++;
        if (playout(ring, g, moves[i], vals, rng) === me) stats[i][0]++;
        if (now() - t0 > ms * 2) break;
      }
    let bi = 0, bs = -1;
    stats.forEach(([w, n], i) => { const sc = (w + 1) / (n + 2); if (sc > bs) { bs = sc; bi = i; } });
    return { ...moves[bi], wins: null };
  }
  function playout(ring, g, m, vals, rng) {
    const c = g.c.slice(), d = g.d;
    c[m.k] = m.v;
    let turn = other(g.turn), left = c.map((v, k) => (v === null ? k : -1)).filter(k => k >= 0);
    while (left.length > 1) {
      const k = pick(left, rng);
      let v = pick(vals, rng);
      if ((k === 0 || k === d) && ring.isZero(v)) v = ring.one;
      c[k] = v; left = left.filter(j => j !== k); turn = other(turn);
    }
    return lastMove(ring, c, left[0], turn === "A", rng) != null ? turn : other(turn);
  }

  // what Amog plays: {k, v, perfect, wins} (wins: true/false when Amog knows, null for a hunch)
  function choose(ring, g, opts = {}) {
    const rng = opts.rng || Math.random, sol = solver(ring, g.d, g.first);
    if (sol) try { return { ...sol.best(g, rng), perfect: true }; } catch (e) { if (e !== ABORT) throw e; }
    return { ...guess(ring, g, rng, opts.ms ?? 700), perfect: false };
  }
  // who wins from here with perfect play: {winner, why} or null when Amog can't tell
  function verdict(ring, g, budget) {
    const sol = solver(ring, g.d, g.first);
    if (sol) try { return { winner: sol.value(g, budget), why: "solved" }; } catch (e) { if (e !== ABORT) throw e; }
    const u = G.unset(g).length, last = u % 2 ? g.turn : other(g.turn);
    if (ring.kind === "C") return { winner: "A", why: "fta" };
    if (ring.kind === "R" && g.d % 2) return { winner: "A", why: "ivt" };
    if (ring.kind === "Q") return { winner: last, why: "last" };
    if (ring.kind === "R" && last === "A") return { winner: "A", why: "last" };
    if (ring.kind === "Z" && last === "S") return { winner: "S", why: "last" };
    return null;
  }

  root.CoeffAmog = { choose, verdict, solver, lastMove, samples, MAX_N };
})(typeof globalThis !== "undefined" ? globalThis : this);
