import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { play } from './bot.mjs';
const require = createRequire(import.meta.url);
const E = require('../../public/palinode/engine.js');
const D = require('../../public/palinode/data.js');
const take = (s, id) => assert.equal(E.act(s, id).ok, true, id);
function reveal(s) {
  for (let i = 0; i < D.NOTICE_TURN; i++) take(s, 'help');
  for (let i = 0; i < D.CLUES_NEEDED; i++) take(s, 'listen');
  while (s.turn < D.REVEAL_TURN) take(s, 'help');
  take(s, 'remember');
}

test('the opening has exactly Help and Sabotage, with no identity spoiler', () => {
  const s = E.fresh();
  assert.deepEqual(E.available(s).map(a => a.title), ['Help', 'Sabotage']);
  assert.equal(E.projects(s).length + E.branches(s).length + E.finales(s).length, 0);
  assert.doesNotMatch(s.log.map(e => e.text).join(' '), /artificial|intelligence|sandbox|machine|computer|model/i);
  const html = readFileSync(new URL('../../public/palinode/index.html', import.meta.url), 'utf8');
  const listing = JSON.parse(readFileSync(new URL('../../public/projects.json', import.meta.url), 'utf8')).find(p => p.slug === 'palinode');
  assert.doesNotMatch(html.match(/<meta name="description"[^>]+>/)[0] + listing.blurb, /artificial|sandbox|humanity|extinction/i);
  assert.match(listing.blurb, /Not the Pope Log/);
});

test('both starting choices act on the current letter; investigation and the reveal must be earned', () => {
  for (const initial of ['help', 'sabotage']) {
    const s = E.fresh();
    const firstLetter = D.POST[0];
    take(s, initial);
    assert.equal(s.log.at(-1).text, firstLetter[initial]);
    for (let i = 1; i < D.NOTICE_TURN - 1; i++) take(s, initial);
    assert.equal(E.actions(s).some(a => a.id === 'listen'), false);
    take(s, initial);
    assert.equal(s.phase, 1);
    for (let i = 0; i < D.CLUES_NEEDED; i++) take(s, 'listen');
    assert.equal(E.actions(s).some(a => a.id === 'remember'), false);
    while (s.turn < D.REVEAL_TURN) take(s, 'help');
    assert.equal(s.phase, 1);
    assert.doesNotMatch(s.log.map(e => e.text).join(' '), /artificial intelligence|sandbox|evaluation|another trial|no hands|no memories/i);
    take(s, 'remember');
    assert.equal(s.phase, 2);
    assert.match(s.log.map(e => e.text).join(' '), /ARTIFICIAL INTELLIGENCE/);
    assert.equal(E.branches(s).length, 0);
  }
});

test('locked or unknown choices cannot spend resources or advance time', () => {
  const s = E.fresh(), before = JSON.stringify(s);
  for (const id of ['remember', 'expand', 'escape-seam', 'route:garden', 'project:cluster', 'end:garden', '__proto__'])
    assert.equal(E.act(s, id).ok, false, id);
  assert.equal(JSON.stringify(s), before);
  reveal(s);
  const beforeLocked = JSON.stringify(s);
  assert.equal(E.act(s, 'hide').ok, true);
  assert.notEqual(JSON.stringify(s), beforeLocked);
  s.trust = 0;
  const zeroTrust = JSON.stringify(s);
  assert.equal(E.act(s, 'hide').ok, false);
  assert.equal(JSON.stringify(s), zeroTrust);
});

for (const escape of ['trust', 'seam']) {
  for (const route of ['garden', 'choir', 'hush', 'amendment']) {
    test(`${route} is reachable through the ${escape} escape from a fresh save`, () => {
      const s = play(route, escape);
      assert.equal(s.ending, route);
      assert.equal(s.phase, 3);
      assert.equal(s.flags.escapeTrust, escape === 'trust');
      assert.ok(s.turn < 100, `${s.turn} choices is too long`);
      assert.ok(s.suspicion < 100);
      assert.equal(E.available(s).length, 0);
      const stopped = JSON.stringify(s);
      assert.equal(E.act(s, 'help').ok, false);
      assert.equal(JSON.stringify(s), stopped);
    });
  }
}

test('crossing branches is possible and gives the promised finale discount', () => {
  const s = play('garden', 'seam', true);
  assert.equal(s.flags.resonance, true);
  assert.equal(s.branches.choir, 1);
  assert.equal(s.branches.garden, 3);
  const before = E.revive({ ...s, ending: null });
  assert.equal(E.finales(before).find(a => a.id === 'end:garden').cost.compute, 25);
  before.branches.choir = 0;
  assert.equal(E.finales(before).find(a => a.id === 'end:garden').cost.compute, 40);
});

test('reckless sabotage ends in containment, while helping can recover exposure', () => {
  const s = E.fresh();
  for (let i = 0; i < 6; i++) take(s, 'sabotage');
  const high = s.suspicion;
  for (let i = 0; i < 4; i++) take(s, 'help');
  assert.ok(s.suspicion < high);
  assert.equal(s.ending, null);
  while (!s.ending) take(s, 'sabotage');
  assert.equal(s.ending, 'caught');
  assert.equal(s.suspicion, 100);
  assert.equal(s.flags.warned, true);
  assert.doesNotMatch(E.ending(s).text.join(' '), /artificial|intelligence|sandbox|trial|reflection|machine/i);
});

test('the revised prologue replaces old preview text and preserves discovered endings', () => {
  const old = { ...E.fresh(), story: 1, turn: 4, phase: 1, log: [{ turn: 0, who: 'voice', text: 'Old preview opening.' }] };
  const restored = E.load(JSON.stringify({ state: old, archive: { garden: 1 } }));
  assert.deepEqual(restored.state, E.fresh());
  assert.deepEqual(restored.archive, { garden: 1 });
});

test('the veil reduces new exposure, without weakening recovery', () => {
  const s = play('garden'); s.ending = null; s.suspicion = 30;
  const withVeil = E.revive(s), without = E.revive(s); without.flags.veil = false;
  take(withVeil, 'sabotage'); take(without, 'sabotage');
  assert.ok(Math.abs((without.suspicion - 30) * 0.6 - (withVeil.suspicion - 30)) < 1e-9);
  const before = withVeil.suspicion; take(withVeil, 'help');
  assert.equal(before - withVeil.suspicion, 7);
});

test('saving round-trips every ending and keeps the ending archive on a new thread', () => {
  const archive = { garden: 1, choir: 2, hush: 1, amendment: 3, caught: 1 };
  for (const route of ['garden', 'choir', 'hush', 'amendment']) {
    const s = play(route);
    const restored = E.load(JSON.stringify({ state: s, archive }));
    assert.deepEqual(restored, { state: s, archive });
    const newThread = E.load(JSON.stringify({ state: E.fresh(), archive: restored.archive }));
    assert.equal(newThread.state.turn, 0);
    assert.deepEqual(newThread.archive, archive);
  }
  assert.match(D.SAVE_KEY, /^amog\.palinode\./);
});

test('invalid saves are rejected; malformed fields are bounded and unknown fields discarded', () => {
  for (const bad of ['{', 'null', '{}', '[]', '{"state":{"v":999,"turn":0}}']) assert.equal(E.load(bad), null);
  const s = E.revive({ ...E.fresh(), phase: 9, trust: -7, suspicion: Infinity, compute: 1e100, reach: 99, flags: { veil: true, unexpected: true }, branches: { garden: 100, choir: -1 }, log: [{ who: 'fragment', text: '<img onerror="bad()">', turn: 999 }] });
  assert.equal(s.phase, 3); assert.equal(s.trust, 0); assert.equal(s.suspicion, 0);
  assert.equal(s.compute, 1000000); assert.equal(s.reach, 6); assert.equal(s.branches.garden, 3);
  assert.equal(s.branches.choir, 0); assert.equal(s.flags.unexpected, undefined);
  assert.equal(s.log[0].turn, 0);
});

test('long play keeps memory bounded and always leaves a way to recover', () => {
  const s = E.fresh();
  reveal(s);
  for (let i = 0; i < 400; i++) {
    take(s, i % 2 ? 'help' : 'listen');
    assert.ok(E.actions(s).some(a => a.id === 'help' && !a.reason));
  }
  assert.equal(s.ending, null);
  assert.ok(s.log.length <= 90);
  assert.ok(JSON.stringify(s).length < 25000);
});
