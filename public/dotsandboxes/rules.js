/* Dots & Boxes rules, pure (page, Node and the Worker's DabRoom referee in worker/dotsandboxes.js).
 * Same edge numbering as ai.js: horizontals first (h(r,c) = r*C + c), then verticals ((R+1)*C + r*(C+1) + c).
 * A game is plain JSON so a Durable Object can store it as is:
 *   { n, first, turn, by: [edge -> player 0/1 or -1], owner: [box -> 0/1 or -1], score: [a, b], last, over }
 * Players are 0 and 1. Closing a box (or two) scores and moves again; otherwise the turn passes. */
(function (root) {
  "use strict";
  const SIZES = [3, 4, 5, 6];
  const geo = {};

  function geometry(n) {
    if (geo[n]) return geo[n];
    const H = (n + 1) * n, E = H + n * (n + 1), boxEdges = [], edgeBoxes = Array.from({ length: E }, () => []);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const b = r * n + c, es = [r * n + c, (r + 1) * n + c, H + r * (n + 1) + c, H + r * (n + 1) + c + 1];
      boxEdges[b] = es;
      for (const e of es) edgeBoxes[e].push(b);
    }
    return (geo[n] = { n, E, NB: n * n, boxEdges, edgeBoxes });
  }

  function newGame(n, first) {
    if (!SIZES.includes(n)) throw new Error("the board is 3×3 to 6×6");
    const g = geometry(n), f = first === 1 ? 1 : 0;
    return { n, first: f, turn: f, by: new Array(g.E).fill(-1), owner: new Array(g.NB).fill(-1), score: [0, 0], last: -1, over: false };
  }

  // Why player p may not draw edge e right now (null if they may).
  function moveError(s, p, e) {
    if (s.over) return "the game is over";
    if (s.turn !== p) return "it's not your turn";
    if (!Number.isInteger(e) || e < 0 || e >= s.by.length) return "that's not a line on this board";
    if (s.by[e] !== -1) return "that line is already drawn";
    return null;
  }

  // Draw edge e for whoever's turn it is. Returns the number of boxes it closed (0, 1 or 2).
  function play(s, e) {
    const g = geometry(s.n), p = s.turn;
    s.by[e] = p; s.last = e;
    let got = 0;
    for (const b of g.edgeBoxes[e]) if (s.owner[b] < 0 && g.boxEdges[b].every(x => s.by[x] !== -1)) { s.owner[b] = p; got++; }
    s.score[p] += got;
    if (!got) s.turn = 1 - p;
    if (s.by.every(x => x !== -1)) s.over = true;
    return got;
  }

  // 0 or 1 for a winner, -1 for a draw, null while the game is on.
  const winner = s => (!s.over ? null : s.score[0] === s.score[1] ? -1 : s.score[0] > s.score[1] ? 0 : 1);

  const api = { SIZES, geometry, newGame, moveError, play, winner };
  root.DABRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
