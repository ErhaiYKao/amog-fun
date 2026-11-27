// node --test tools/dotsandboxes/rules.test.mjs : the pure rules the online referee (worker/dotsandboxes.js) uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../public/dotsandboxes/rules.js");
const AI = require("../../public/dotsandboxes/ai.js");

test("edge numbering matches ai.js", () => {
  for (const n of D.SIZES) {
    const a = D.geometry(n), b = AI.makeGeometry(n, n);
    assert.equal(a.E, b.E);
    assert.deepEqual(a.boxEdges, b.boxEdges);
    assert.deepEqual(a.edgeBoxes, b.edgeBoxes);
  }
});

test("bad sizes refused", () => {
  for (const n of [2, 7, "4", undefined, 4.5]) assert.throws(() => D.newGame(n, 0));
});

test("closing a box scores and moves again; otherwise the turn passes", () => {
  const s = D.newGame(3, 0), g = D.geometry(3);
  const [top, bottom, left, right] = g.boxEdges[0];
  assert.equal(D.play(s, top), 0); assert.equal(s.turn, 1);
  assert.equal(D.play(s, bottom), 0); assert.equal(s.turn, 0);
  assert.equal(D.play(s, left), 0); assert.equal(s.turn, 1);
  assert.equal(D.play(s, right), 1); assert.equal(s.turn, 1, "the closer goes again");
  assert.deepEqual(s.score, [0, 1]); assert.equal(s.owner[0], 1);
  assert.equal(D.moveError(s, 0, 5), "it's not your turn");
  assert.equal(D.moveError(s, 1, top), "that line is already drawn");
  for (const e of [-1, g.E, 1.5, "3", null]) assert.match(D.moveError(s, 1, e), /not a line/);
});

test("one line can close two boxes", () => {
  const s = D.newGame(3, 0), g = D.geometry(3);
  const shared = g.boxEdges[0][3]; // right of box 0 = left of box 1
  for (const e of [...g.boxEdges[0], ...g.boxEdges[1]]) if (e !== shared && s.by[e] === -1) { s.turn = 0; D.play(s, e); }
  s.turn = 0;
  assert.equal(D.play(s, shared), 2);
  assert.equal(s.score[0], 2);
});

test("random games: every box owned once, scores add up, game over only at the end", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let k = 0; k < 300; k++) {
    const n = D.SIZES[k % 4], s = D.newGame(n, k % 2), g = D.geometry(n);
    let moves = 0;
    while (!s.over) {
      const free = s.by.map((x, e) => (x === -1 ? e : -1)).filter(e => e >= 0);
      const e = free[Math.floor(rnd() * free.length)];
      assert.equal(D.moveError(s, 1 - s.turn, e), "it's not your turn");
      assert.equal(D.moveError(s, s.turn, e), null);
      D.play(s, e); moves++;
    }
    assert.equal(moves, g.E);
    assert.ok(s.owner.every(o => o === 0 || o === 1));
    assert.equal(s.score[0] + s.score[1], g.NB);
    assert.equal(s.score[0], s.owner.filter(o => o === 0).length);
    assert.equal(D.moveError(s, s.turn, 0), "the game is over");
    assert.equal(D.winner(s), s.score[0] === s.score[1] ? -1 : s.score[0] > s.score[1] ? 0 : 1);
  }
});
