/* Dots & Boxes — geometry + AI ("Amog").
 *
 * Board: R x C boxes. Edges are indexed horizontals first, then verticals.
 *   h(r,c) = r*C + c                  r in [0,R], c in [0,C)
 *   v(r,c) = (R+1)*C + r*(C+1) + c    r in [0,R), c in [0,C]
 *
 * AI levels:
 *   easy   – grabs boxes most of the time, otherwise plays fairly randomly
 *   medium – always captures, plays safe moves, then sacrifices as little as possible
 *   hard   – medium + chain/loop control (double-dealing) using a strings-and-coins
 *            component evaluation, and an exact endgame solver once the position is small
 */
(function (root) {
  "use strict";

  function makeGeometry(R, C) {
    const H = (R + 1) * C;
    const E = H + R * (C + 1);
    const NB = R * C;
    const h = (r, c) => r * C + c;
    const v = (r, c) => H + r * (C + 1) + c;
    const box = (r, c) => r * C + c;
    const edgeBoxes = Array.from({ length: E }, () => []);
    const boxEdges = [];
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        const b = box(r, c);
        const es = [h(r, c), h(r + 1, c), v(r, c), v(r, c + 1)];
        boxEdges[b] = es;
        for (const e of es) edgeBoxes[e].push(b);
      }
    // endpoints (dot row/col) for drawing
    const ends = [];
    for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) ends[h(r, c)] = [r, c, r, c + 1];
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) ends[v(r, c)] = [r, c, r + 1, c];
    return { R, C, H, E, NB, edgeBoxes, boxEdges, ends };
  }

  // ---------- small helpers ----------
  function computeSides(G, drawn) {
    const s = new Int8Array(G.NB);
    for (let b = 0; b < G.NB; b++) for (const e of G.boxEdges[b]) s[b] += drawn[e];
    return s;
  }
  function missingEdge(G, drawn, b, except) {
    for (const e of G.boxEdges[b]) if (!drawn[e] && e !== except) return e;
    return -1;
  }
  function across(G, e, b) {
    for (const x of G.edgeBoxes[e]) if (x !== b) return x;
    return -1;
  }
  function undrawn(G, drawn) {
    const out = [];
    for (let e = 0; e < G.E; e++) if (!drawn[e]) out.push(e);
    return out;
  }
  function isSafe(G, sides, e) {
    for (const b of G.edgeBoxes[e]) if (sides[b] >= 2) return false;
    return true;
  }
  function safeMoves(G, drawn, sides) {
    return undrawn(G, drawn).filter(e => isSafe(G, sides, e));
  }
  function capturable(G, sides) {
    const out = [];
    for (let b = 0; b < G.NB; b++) if (sides[b] === 3) out.push(b);
    return out;
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // Take every available box greedily (mutates drawn/sides). Returns boxes taken.
  function greedy(G, drawn, sides, taken) {
    let count = 0;
    const st = capturable(G, sides);
    while (st.length) {
      const b = st.pop();
      if (sides[b] !== 3) continue;
      const e = missingEdge(G, drawn, b, -1);
      drawn[e] = 1;
      for (const x of G.edgeBoxes[e]) {
        sides[x]++;
        if (sides[x] === 4) { count++; if (taken) taken.push(x); }
        else if (sides[x] === 3) st.push(x);
      }
    }
    return count;
  }

  function giveaway(G, drawn, sides, e) {
    const d = drawn.slice(), s = sides.slice();
    d[e] = 1;
    for (const x of G.edgeBoxes[e]) s[x]++;
    return greedy(G, d, s);
  }

  /* Look down the chain that starts at capturable box b.
   *  free   – taking b can never be wrong (not at the "last two" / "last four" point)
   *  take   – edge that captures b
   *  dd     – double-dealing edge (decline the last 2 of a chain / 4 of a loop), or -1
   *  kind   – "chain" | "loop"
   *  group  – boxes belonging to this capture front */
  function analyzeCapture(G, drawn, sides, b) {
    const take = missingEdge(G, drawn, b, -1);
    let came = take, cur = across(G, take, b), L = 0;
    const path = [];
    while (cur !== -1 && sides[cur] === 2 && L <= G.NB) {
      path.push(cur); L++;
      const nx = missingEdge(G, drawn, cur, came);
      came = nx;
      cur = across(G, nx, cur);
    }
    const end3 = cur !== -1 && sides[cur] === 3;
    const free = L === 0 || (end3 ? L >= 3 : L >= 2);
    let dd = -1;
    if (!free) {
      if (!end3 && L === 1) dd = came;
      else if (end3 && L === 2) dd = missingEdge(G, drawn, path[0], take);
    }
    const group = [b, ...path];
    if (end3) group.push(cur);
    return { box: b, take, free, dd, kind: end3 ? "loop" : "chain", group };
  }

  // ---------- strings & coins component evaluation ----------
  // Components of a position with no safe moves and nothing capturable.
  function components(G, drawn, sides) {
    const map = new Map();
    for (const e of undrawn(G, drawn)) {
      const d = drawn.slice(), s = sides.slice(), taken = [];
      d[e] = 1;
      for (const x of G.edgeBoxes[e]) s[x]++;
      greedy(G, d, s, taken);
      if (!taken.length) continue;
      taken.sort((a, b) => a - b);
      const key = taken.join(",");
      let c = map.get(key);
      if (!c) {
        const set = new Set(taken), es = new Set();
        for (const bx of taken) for (const ee of G.boxEdges[bx]) if (!drawn[ee]) es.add(ee);
        c = { boxes: taken, set, len: taken.length, loop: es.size === taken.length && taken.length >= 4, moves: [] };
        map.set(key, c);
      }
      c.moves.push(e);
    }
    return [...map.values()];
  }

  const fMemo = new Map();
  const tkey = c => (c.loop ? "L" : "C") + c.len;
  // Net score for the player to move, who must open one of the components.
  function F(list) {
    if (!list.length) return 0;
    const key = list.map(tkey).sort().join(",");
    if (fMemo.has(key)) return fMemo.get(key);
    let best = -Infinity;
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      const t = tkey(list[i]);
      if (seen.has(t)) continue;
      seen.add(t);
      const rest = list.slice(0, i).concat(list.slice(i + 1));
      best = Math.max(best, -oppValue(list[i], F(rest)));
    }
    fMemo.set(key, best);
    return best;
  }
  function oppValue(c, fRest) {
    const n = c.len;
    if (c.loop) return Math.max(n + fRest, n - 8 - fRest);
    if (n <= 2) return n + fRest; // opened hard-heartedly, no double-deal possible
    return Math.max(n + fRest, n - 4 - fRest);
  }

  function openingMove(G, drawn, sides) {
    const comps = components(G, drawn, sides);
    if (!comps.length) return pick(undrawn(G, drawn));
    let best = null, bestV = -Infinity;
    for (let i = 0; i < comps.length; i++) {
      const rest = comps.slice(0, i).concat(comps.slice(i + 1));
      const v = -oppValue(comps[i], F(rest));
      if (v > bestV || (v === bestV && comps[i].len < best.len)) { bestV = v; best = comps[i]; }
    }
    return representativeMove(G, best);
  }
  function representativeMove(G, c) {
    if (!c.loop && c.len === 2) {
      // hard-hearted handout: the edge between the two boxes
      const mid = c.moves.find(e => G.edgeBoxes[e].length === 2 && G.edgeBoxes[e].every(x => c.set.has(x)));
      if (mid !== undefined) return mid;
    }
    if (!c.loop) {
      const end = c.moves.find(e => G.edgeBoxes[e].filter(x => c.set.has(x)).length === 1);
      if (end !== undefined) return end;
    }
    return c.moves[0];
  }

  // ---------- exact endgame solver ----------
  const BUDGET = {};
  function solve(G, drawnIn, maxNodes) {
    const drawn = Uint8Array.from(drawnIn);
    const sides = computeSides(G, drawn);
    const L = undrawn(G, drawn);
    if (L.length === 0 || L.length > 30) return null;
    const local = new Int32Array(G.E).fill(-1);
    L.forEach((e, i) => (local[e] = i));
    const FULL = L.length === 30 ? 0x3fffffff : (1 << L.length) - 1;
    const memo = new Map();
    let mask = 0, nodes = 0;

    const play = e => {
      drawn[e] = 1; mask |= 1 << local[e];
      let got = 0;
      for (const x of G.edgeBoxes[e]) if (++sides[x] === 4) got++;
      return got;
    };
    const undo = e => {
      drawn[e] = 0; mask &= ~(1 << local[e]);
      for (const x of G.edgeBoxes[e]) sides[x]--;
    };
    const moves = () => {
      const caps = capturable(G, sides);
      if (!caps.length) return L.filter(e => !drawn[e]);
      const opts = new Set();
      for (const b of caps) {
        const a = analyzeCapture(G, drawn, sides, b);
        if (a.free) return [a.take];
        opts.add(a.take);
        if (a.dd >= 0) opts.add(a.dd);
      }
      return [...opts];
    };
    const negamax = () => {
      if (mask === FULL) return 0;
      const k = mask;
      const m = memo.get(k);
      if (m !== undefined) return m;
      if (++nodes > maxNodes) throw BUDGET;
      let best = -Infinity;
      for (const e of moves()) {
        const got = play(e);
        const v = got > 0 ? got + negamax() : -negamax();
        undo(e);
        if (v > best) best = v;
      }
      memo.set(k, best);
      return best;
    };

    try {
      const scored = [];
      for (const e of moves()) {
        const got = play(e);
        const v = got > 0 ? got + negamax() : -negamax();
        undo(e);
        scored.push({ e, v, got });
      }
      const top = Math.max(...scored.map(s => s.v));
      const best = scored.filter(s => s.v === top);
      // prefer grabbing boxes, then safe-looking moves, then anything
      const greedyFirst = best.filter(s => s.got > 0);
      const choice = greedyFirst.length ? pick(greedyFirst) : pick(best);
      return { edge: choice.e, value: top, nodes };
    } catch (err) {
      if (err === BUDGET) return null;
      throw err;
    }
  }

  // ---------- move choice ----------
  function chooseMove(G, drawnIn, level) {
    const drawn = Uint8Array.from(drawnIn);
    const sides = computeSides(G, drawn);
    const open = undrawn(G, drawn);
    const caps = capturable(G, sides);
    const safe = safeMoves(G, drawn, sides);

    if (level === "easy") {
      if (caps.length && Math.random() < 0.85) return missingEdge(G, drawn, pick(caps), -1);
      if (safe.length && Math.random() < 0.6) return pick(safe);
      return pick(open);
    }

    if (level === "medium") {
      if (caps.length) return missingEdge(G, drawn, caps[0], -1);
      if (safe.length) return pick(safe);
      return minGiveaway(G, drawn, sides, open);
    }

    // hard
    // exact play once the tree is small: always in the loony endgame, and late in the safe phase
    if ((!safe.length && open.length <= 30) || open.length <= 22) {
      const res = solve(G, drawn, 300000);
      if (res) return res.edge;
    }
    if (caps.length) return captureDecision(G, drawn, sides, caps);
    if (safe.length) return pick(safe);
    return openingMove(G, drawn, sides);
  }

  function minGiveaway(G, drawn, sides, open) {
    let best = [], bestN = Infinity;
    for (const e of open) {
      const n = giveaway(G, drawn, sides, e);
      if (n < bestN) { bestN = n; best = [e]; } else if (n === bestN) best.push(e);
    }
    return pick(best);
  }

  function captureDecision(G, drawn, sides, caps) {
    const fronts = caps.map(b => analyzeCapture(G, drawn, sides, b));
    const free = fronts.find(f => f.free);
    if (free) return free.take;
    const a = fronts.find(f => f.dd >= 0);
    if (!a) return fronts[0].take;

    const d = drawn.slice(), s = sides.slice();
    const k = greedy(G, d, s);
    if (!undrawn(G, d).length || safeMoves(G, d, s).length) return a.take;
    const fr = F(components(G, d, s));
    const takeAll = k + fr;
    const dd = a.kind === "loop" ? k - 8 - fr : k - 4 - fr;
    if (dd <= takeAll) return a.take;
    // double-deal: first clear every other front, then decline this one
    const other = fronts.find(f => !a.group.includes(f.box));
    return other ? other.take : a.dd;
  }

  const api = { makeGeometry, chooseMove, computeSides, solve };
  root.DBAI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
