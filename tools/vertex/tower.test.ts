// The tower is completable: a bot plays the intended route through every stage, then the whole run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../vertex/src/sim/game.ts';
import { buildTower } from '../../vertex/src/sim/tower.ts';
import { Bot } from './bot.ts';
import { ROUTES } from './routes.ts';

const level = buildTower();

ROUTES.forEach((route, i) => {
  test(`stage ${i + 1} (${level.stages[i].name}) can be finished from its checkpoint`, () => {
    const g = new Game(level, 'practice');
    g.warp(level.checkpoints.findIndex((c) => c.stage === i && c.start));
    const b = new Bot(g);
    b.verbose = !!process.env.VERBOSE;
    route(b);
    assert.equal(g.deaths, 0);
    console.log(`  stage ${i + 1}: ${g.time.toFixed(1)} s`);
  });
});

test('a full Tower Run reaches the finish', () => {
  const g = new Game(level, 'run');
  const b = new Bot(g);
  for (const route of ROUTES) route(b);
  b.wait(0.2);
  assert.equal(g.finished, true);
  assert.equal(g.deaths, 0);
  console.log(`  full run: ${g.time.toFixed(1)} s, splits ${g.splits.map((s) => s.toFixed(1)).join(' / ')}`);
});

test('every checkpoint is a safe place to stand', () => {
  const g = new Game(level, 'practice');
  level.checkpoints.forEach((c, i) => {
    g.warp(i);
    const idle = { moveX: 0, moveZ: 0, yaw: c.yaw, pitch: 0, jump: false, sprint: false, crouch: false, fire: false, dash: false, weapon: 0 };
    for (let t = 0; t < 600; t++) g.step(idle);          // five seconds: long enough for anything nearby to shoot
    assert.ok(g.player.grounded, `${c.name}: standing`);
    assert.ok(Math.abs(g.player.pos.y - g.player.half.y - c.feet.y) < 0.05, `${c.name}: on the floor it names`);
    assert.equal(g.player.health, 100, `${c.name}: nothing hurts you on the pad`);
    assert.equal(g.checkpoint, i, `${c.name}: no later checkpoint overlaps it`);
  });
  assert.equal(g.deaths, 0);
});

test('five minutes of random inputs on the real tower: no NaN, never inside geometry', () => {
  for (const seed of [1, 2, 3]) {
    let a = seed * 2654435761 >>> 0;
    const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const g = new Game(level, 'practice');
    g.warp(Math.floor(rnd() * level.checkpoints.length));
    const inp = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, sprint: false, crouch: false, fire: false, dash: false, weapon: 0 };
    const shrunk = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < 120 * 100; t++) {
      if (t % 17 === 0) {
        inp.moveX = Math.floor(rnd() * 3) - 1; inp.moveZ = rnd() < 0.7 ? 1 : Math.floor(rnd() * 3) - 1;
        inp.sprint = rnd() < 0.7; inp.crouch = rnd() < 0.15; inp.weapon = Math.floor(rnd() * 3);
        inp.yaw += (rnd() - 0.5) * 1.5; inp.pitch = (rnd() - 0.5) * 3;
      }
      inp.jump = rnd() < 0.2; inp.fire = rnd() < 0.3; inp.dash = rnd() < 0.05;
      if (t % 600 === 0) g.player.charges = 2;            // keep dashes and paid wall kicks in the mix
      g.step(inp);
      g.events.length = 0;
      const p = g.player;
      assert.ok(Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.vel.x + p.vel.y + p.vel.z), `finite at tick ${t}`);
      shrunk.x = p.half.x - 0.01; shrunk.y = p.half.y - 0.01; shrunk.z = p.half.z - 0.01;
      assert.ok(!g.world.overlaps(p.pos, shrunk), `inside geometry at tick ${t}: ${p.pos.x.toFixed(2)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(2)}`);
    }
  }
});
