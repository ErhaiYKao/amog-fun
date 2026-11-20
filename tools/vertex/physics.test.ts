// Movement and gameplay invariants on small synthetic levels.  node --test tools/vertex/
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../vertex/src/sim/game.ts';
import { Builder } from '../../vertex/src/sim/level.ts';
import type { Input } from '../../vertex/src/sim/player.ts';
import { emptyInput, eyeOf, feetOf, hspeed, stepPlayer, makePlayer, placePlayer } from '../../vertex/src/sim/player.ts';
import { World } from '../../vertex/src/sim/world.ts';
import { DT, T, SHOTGUN } from '../../vertex/src/sim/tuning.ts';
import { Stepper } from '../../vertex/src/sim/clock.ts';

/** A big floor at y = 0 with optional extras. The player starts at the origin facing -z. */
function arena(extra: (b: Builder) => void = () => {}, mode: 'practice' | 'run' = 'practice'): Game {
  const b = new Builder();
  b.beginStage('test', 0);
  b.raw(-200, -1, -200, 200, 0, 200, 'deck');
  b.checkpoints.push({ feet: { x: 0, y: 0, z: 0 }, yaw: 0, min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 }, stage: 0, start: true, name: 'start' });
  b.finish = { min: { x: 900, y: 0, z: 900 }, max: { x: 901, y: 1, z: 901 } };
  extra(b);
  return new Game(b.build(), mode);
}

function run(g: Game, seconds: number, f: (inp: Input, t: number, tick: number) => void): Input {
  const inp = emptyInput();
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { f(inp, i * DT, i); g.step(inp); }
  return inp;
}

const settle = (g: Game) => run(g, 0.2, () => {});

test('walk and sprint settle at their speeds', () => {
  const g = arena(); settle(g);
  run(g, 1.5, (i) => { i.moveZ = 1; });
  assert.ok(Math.abs(hspeed(g.player) - T.walk) < 0.05, `walk ${hspeed(g.player)}`);
  run(g, 1.5, (i) => { i.moveZ = 1; i.sprint = true; });
  assert.ok(Math.abs(hspeed(g.player) - T.sprint) < 0.05, `sprint ${hspeed(g.player)}`);
  assert.ok(g.player.vel.z < 0, 'yaw 0 runs towards -z');
  run(g, 0.6, (i) => { i.moveZ = 0; i.sprint = false; });
  assert.equal(hspeed(g.player), 0, 'friction stops you dead');
});

test('jump apex is about 1.65 m and takes the same time every time', () => {
  const g = arena(); settle(g);
  let apex = 0, air = 0;
  run(g, 1.2, (i, _t, n) => { i.jump = n === 0; apex = Math.max(apex, feetOf(g.player)); if (!g.player.grounded) air++; });
  assert.ok(Math.abs(apex - 1.65) < 0.04, `apex ${apex}`);
  assert.ok(Math.abs(air * DT - (2 * T.jumpV) / T.gravity) < 0.03, `airtime ${air * DT}`);
  assert.ok(g.player.grounded);
});

test('holding jump does not auto-hop; a buffered press does', () => {
  const g = arena(); settle(g);
  let jumps = 0;
  const count = () => { jumps += g.events.filter((e) => e.type === 'jump').length; g.events.length = 0; };
  run(g, 2.5, (i) => { i.jump = true; count(); });
  assert.equal(jumps, 1);
  // press 80 ms before landing: still jumps on the landing tick
  run(g, 0.3, (i) => { i.jump = false; });
  jumps = 0;
  let pressedAt = -1;
  run(g, 2, (i, t, n) => {
    count();
    if (n === 0) i.jump = true; else if (pressedAt < 0) i.jump = false;
    if (pressedAt < 0 && !g.player.grounded && g.player.vel.y < 0 && feetOf(g.player) < 0.6) { i.jump = true; pressedAt = t; }
    else if (pressedAt >= 0) i.jump = t - pressedAt < 0.02;
  });
  assert.equal(jumps, 2, 'buffered jump fired');
});

test('coyote time: a jump just after leaving a ledge still works, a late one does not', () => {
  for (const [delay, ok] of [[0.06, true], [0.14, false]] as const) {
    const g = arena((b) => { b.raw(-2, 0, -6, 2, 10, 2, 'deck'); });
    placePlayer(g.player, { x: 0, y: 10, z: 0 }, 0);
    settle(g);
    let left = -1, jumped = false;
    run(g, 1.6, (i, t) => {
      i.moveZ = 1;
      if (left < 0 && !g.player.grounded) left = t;
      i.jump = left >= 0 && t - left >= delay && t - left < delay + 0.02;
      if (g.events.some((e) => e.type === 'jump')) jumped = true;
      g.events.length = 0;
    });
    assert.equal(jumped, ok, `delay ${delay}`);
  }
});

test('bunnyhopping keeps speed; air strafing adds to it', () => {
  const g = arena(); settle(g);
  run(g, 1, (i) => { i.moveZ = 1; i.sprint = true; });
  const v0 = hspeed(g.player);
  // straight hops, jump re-pressed in the buffer window before each landing
  run(g, 4, (i, _t, n) => { i.moveZ = 1; i.sprint = true; i.jump = g.player.grounded ? n % 2 === 0 : g.player.vel.y < -7; });
  assert.ok(hspeed(g.player) > v0 - 0.2, `kept ${hspeed(g.player)} of ${v0}`);
  assert.ok(!g.player.grounded || g.events.some((e) => e.type === 'jump'), 'was actually hopping');
  // now strafe: hold right and turn right at a steady rate
  const v1 = hspeed(g.player);
  let yaw = 0;
  run(g, 4, (i, _t, n) => {
    i.moveZ = 0; i.moveX = 1;
    yaw -= 0.9 * DT; i.yaw = yaw;
    i.jump = g.player.grounded ? n % 2 === 0 : g.player.vel.y < -7;
  });
  assert.ok(hspeed(g.player) > v1 + 2, `strafing gained ${hspeed(g.player) - v1}`);
  assert.ok(hspeed(g.player) < 40, 'but not absurdly');
});

test('air control: full steering below walking speed, braking above, no free speed', () => {
  const g = arena(); settle(g);
  // standing jump, then hold forward: reaches walking speed, not more
  run(g, 0.6, (i, _t, n) => { i.jump = n === 0; i.moveZ = 1; });
  assert.ok(Math.abs(hspeed(g.player) - T.walk) < 1.01, `standing jump air speed ${hspeed(g.player)}`);
  // fast and holding back: slows down
  const h = arena(); settle(h);
  h.player.vel.z = -20; h.player.vel.y = 9; h.player.grounded = false; h.player.pos.y += 0.1;
  run(h, 0.3, (i) => { i.moveZ = -1; });
  assert.ok(hspeed(h.player) < 20 - 5 && hspeed(h.player) > 8, `braked to ${hspeed(h.player)}`);
  // fast and holding forward: unchanged
  const k = arena(); settle(k);
  k.player.vel.z = -20; k.player.vel.y = 9; k.player.grounded = false; k.player.pos.y += 0.1;
  run(k, 0.3, (i) => { i.moveZ = 1; });
  assert.ok(Math.abs(hspeed(k.player) - 20) < 1e-9);
});

test('nothing tunnels: a 5 cm wall stops a 300 m/s player, a 5 cm floor stops a long fall', () => {
  const g = arena((b) => { b.raw(-50, 0, -30.05, 50, 50, -30, 'wall'); b.raw(40, 20, 40, 60, 20.05, 60, 'deck'); });
  settle(g);
  g.player.vel.z = -300;
  run(g, 0.5, () => {});
  assert.ok(g.player.pos.z > -30 + T.radius - 0.01, `z ${g.player.pos.z}`);
  placePlayer(g.player, { x: 50, y: 400, z: 50 }, 0);
  run(g, 9, () => {});
  assert.ok(Math.abs(feetOf(g.player) - 20.05) < 0.01, `landed at ${feetOf(g.player)}`);
});

test('low ledges are stepped onto; taller ones are walls', () => {
  const g = arena((b) => { b.raw(-2, 0, -8, 2, 0.3, -4, 'deck'); b.raw(-2, 0, -14, 2, 1.0, -8, 'deck'); });
  settle(g);
  run(g, 3, (i) => { i.moveZ = 1; });
  assert.ok(Math.abs(feetOf(g.player) - 0.3) < 0.01, `feet ${feetOf(g.player)}`);
  assert.ok(g.player.pos.z > -8 + T.radius - 0.01);
});

test('shotgun recoil is an impulse on real velocity', () => {
  const g = arena(); settle(g);
  // fire straight down from rest: v = 8 m/s up -> 1.28 m
  let apex = 0;
  run(g, 1.5, (i, _t, n) => { i.pitch = -Math.PI / 2; i.fire = n === 0; apex = Math.max(apex, feetOf(g.player)); });
  assert.ok(Math.abs(apex - 64 / 50) < 0.06, `apex ${apex}`);
  // jump and fire down on the same tick: (9.08 + 8)^2 / 50
  const h = arena(); settle(h);
  apex = 0;
  run(h, 2.5, (i, _t, n) => { i.pitch = -1.55; i.fire = n <= 1; i.jump = n === 0; apex = Math.max(apex, feetOf(h.player)); });
  assert.ok(Math.abs(apex - (17.08 * 17.08) / 50) < 0.15, `recoil jump apex ${apex}`);
  // fire backwards in the air: forward speed goes up by the recoil
  const k = arena(); settle(k);
  run(k, 0.5, (i) => { i.moveZ = 1; i.sprint = true; });
  run(k, 0.1, (i, _t, n) => { i.jump = n === 0; i.moveZ = 0; });
  const before = -k.player.vel.z;
  run(k, 2 * DT, (i, _t, n) => { i.yaw = Math.PI; i.fire = n === 0; });
  assert.ok(Math.abs(-k.player.vel.z - before - 8) < 0.3, `gained ${-k.player.vel.z - before}`);
});

test('two shells in the air, no more; they come back on the ground', () => {
  const g = arena(); settle(g);
  let shots = 0;
  run(g, 3, (i) => { i.pitch = -1.55; i.fire = true; shots += g.events.filter((e) => e.type === 'shot').length; g.events.length = 0; if (g.player.grounded && shots >= 2) i.fire = false; });
  assert.equal(shots, 2);
  run(g, 3, (i) => { i.fire = false; });
  assert.equal(g.player.shells, SHOTGUN.shells);
});

test('dash needs a charge, spends it, and redirects momentum', () => {
  const g = arena(); settle(g);
  run(g, 0.2, (i, _t, n) => { i.jump = n === 0; });
  const v = { ...g.player.vel };
  run(g, 0.05, (i, _t, n) => { i.dash = n === 0; });
  assert.ok(Math.abs(g.player.vel.x - v.x) < 1e-9 && hspeed(g.player) < 0.01, 'no charge: nothing happens');
  g.player.charges = 2;
  run(g, 3 * DT, (i, _t, n) => { i.dash = n === 1; i.moveZ = 1; });
  assert.equal(g.player.charges, 1);
  assert.ok(Math.abs(hspeed(g.player) - T.dashSpeed) < 0.01 && Math.abs(g.player.vel.y) < 0.01, 'level dash at dash speed');
  // holding the key does not dash again
  run(g, 1, (i) => { i.dash = true; });
  assert.equal(g.player.charges, 1, 'one press, one dash');
  run(g, 0.5, (i) => { i.dash = false; });
  run(g, 3 * DT, (i, _t, n) => { i.dash = n === 1; });
  run(g, 0.5, (i) => { i.dash = false; });
  run(g, 3 * DT, (i, _t, n) => { i.dash = n === 1; });
  assert.equal(g.player.charges, 0, 'never below zero');
});

test('wall kicks: first is free, same wall again costs a charge, the facing wall is free', () => {
  const build = (b: Builder) => { b.raw(1.2, 0, -50, 2, 60, 50, 'wall'); b.raw(-4, 0, -50, -3.2, 60, 50, 'wall'); };
  const g = arena(build); settle(g);
  const kicks = () => { const n = g.events.filter((e) => e.type === 'walljump').length; g.events.length = 0; return n; };
  // fall past the +x wall from high up, mashing jump into it the whole way down
  const drop = (charges: number) => {
    placePlayer(g.player, { x: 0.75, y: 40, z: 0 }, 0);
    g.player.charges = charges; g.events.length = 0;
    let n = 0;
    run(g, 1.5, (i, _t, tick) => { i.yaw = -Math.PI / 2; i.moveZ = 1; i.jump = tick % 2 === 0; n += kicks(); });
    return n;
  };
  assert.equal(drop(0), 1, 'second kick off the same wall refused without a charge');
  assert.equal(drop(1), 2, 'a charge buys one more');
  assert.equal(g.player.charges, 0);
  placePlayer(g.player, { x: 0, y: 0, z: 0 }, 0);
  let n = 0;
  // alternating walls: many free kicks, steady climb
  run(g, 1, (i) => { i.jump = false; i.moveZ = 0; });
  run(g, 4, (i, _t, tick) => {
    const dir = g.player.lastWall ?? { x: 1, y: 0, z: 0 };
    i.yaw = Math.atan2(-dir.x, 0); if (!g.player.lastWall) i.yaw = -Math.PI / 2;
    i.moveZ = 1; i.jump = tick % 2 === 0; n += kicks();
  });
  assert.ok(n >= 6 && feetOf(g.player) > 8, `kicks ${n}, height ${feetOf(g.player)}`);
});

test('airborne kill pays a charge and a shell; a grounded kill pays neither', () => {
  const mk = () => arena((b) => { b.enemies.push({ kind: 'sentinel', pos: { x: 0, y: 1.2, z: -5 }, stage: 0 }); });
  const g = mk(); settle(g);
  run(g, 0.3, (i, _t, n) => { i.fire = n === 0; });
  assert.equal(g.enemies[0].alive, false);
  assert.equal(g.player.charges, 0);
  const h = mk(); settle(h);
  run(h, 0.3, (i, _t, n) => { i.jump = n === 0; i.pitch = Math.atan2(1.2 - eyeOf(h.player).y, 5); i.fire = n === 12; });
  assert.equal(h.enemies[0].alive, false);
  assert.equal(h.player.charges, 1);
  assert.equal(h.player.shells, SHOTGUN.shells, 'shell refunded');
});

test('pistol anchors pull along the line to the node and keep momentum', () => {
  const g = arena((b) => { b.targets.push({ kind: 'anchor', pos: { x: 0, y: 9, z: -14 }, stage: 0, radius: 0.6 }); });
  settle(g);
  const p = g.player;
  run(g, 1.2, (i, _t, n) => { i.weapon = 1; i.yaw = 0; i.pitch = Math.atan2(9 - 1.65, 14); i.fire = n === 30; });
  assert.ok(feetOf(p) > 2 && p.pos.z < -6, `pulled to ${p.pos.z}, ${feetOf(p)}`);
  assert.ok(Math.hypot(p.vel.x, p.vel.y, p.vel.z) > 6, 'still moving after the pull ends');
});

test('rail shots reflect off mirrors and trip rail switches', () => {
  const g = arena((b) => {
    b.raw(-3, 0, -20.5, 3, 6, -20, 'mirror', { mirror: true });
    b.targets.push({ kind: 'switch', pos: { x: 0, y: 1.65, z: 15 }, stage: 0, radius: 0.5, signal: 'gate', seconds: 3, railOnly: true });
  });
  settle(g);
  run(g, 0.2, (i, _t, n) => { i.weapon = 2; i.fire = n >= 14; });
  assert.equal(g.world.signal('gate'), true, 'the reflected shot came back past us and hit the switch');
  run(g, 3.2, (i) => { i.fire = false; });
  assert.equal(g.world.signal('gate'), false, 'timed signal ran out');
});

test('same inputs, same run: the simulation is deterministic', () => {
  const play = () => {
    const g = arena((b) => {
      b.raw(4, 0, -30, 5, 30, 30, 'wall');
      b.enemies.push({ kind: 'sentinel', pos: { x: -6, y: 3, z: -12 }, stage: 0, path: { kind: 'orbit', rx: 3, rz: 3, period: 4, phase: 0 } });
      b.raw(-12, 0, -12, -9, 0.5, -9, 'mover', { mover: { to: { x: 0, y: 4, z: 0 }, period: 3, phase: 0 } });
    });
    run(g, 12, (i, t, n) => {
      i.moveZ = Math.sin(t * 1.3) > -0.3 ? 1 : -1; i.moveX = Math.sin(t * 0.7) > 0 ? 1 : -1;
      i.yaw = Math.sin(t * 0.9) * 2; i.pitch = Math.sin(t * 2.1) * 0.8;
      i.jump = n % 37 < 3; i.fire = n % 90 < 2; i.sprint = n % 200 < 150; i.crouch = n % 310 > 280; i.weapon = Math.floor(t / 4) % 3;
    });
    const p = g.player;
    return [p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z, p.health, p.shells, g.shots.length, g.enemies[0].hp];
  };
  assert.deepEqual(play(), play());
});

test('the frame clock: same number of ticks at 30, 60, 144 and 240 fps, and a suspended tab cannot explode', () => {
  const ticks = (fps: number) => { const s = new Stepper(); let n = 0; for (let i = 0; i < fps * 5; i++) n += s.advance(1 / fps); return n; };
  for (const fps of [30, 60, 144, 240]) assert.ok(Math.abs(ticks(fps) - 600) <= 1, `${fps} fps -> ${ticks(fps)}`);
  const s = new Stepper();
  assert.ok(s.advance(30) <= 12, 'half a minute of suspension is at most a tenth of a second of simulation');
  assert.ok(s.alpha >= 0 && s.alpha < 1);
});

test('death and respawn: practice returns to the checkpoint with the world reset; a run restarts', () => {
  const build = (b: Builder) => {
    b.raw(-3, 0, -12, 3, 0.4, -9, 'lethal', { solid: false, lethal: true });
    b.enemies.push({ kind: 'sentinel', pos: { x: 6, y: 1.2, z: -5 }, stage: 0 });
  };
  for (const mode of ['practice', 'run'] as const) {
    const g = arena(build, mode); settle(g);
    run(g, 0.2, (i, _t, n) => { i.yaw = Math.atan2(-6, 5); i.fire = n === 0; });
    assert.equal(g.enemies[0].alive, false);
    const t0 = g.time;
    run(g, 2, (i) => { i.yaw = 0; i.moveZ = 1; i.fire = false; });
    assert.equal(g.deaths, 1, mode);
    assert.equal(g.enemies[0].alive, true, 'enemies are back');
    assert.equal(g.player.health, T.maxHealth);
    if (mode === 'run') assert.ok(g.time < t0 + 1, 'run clock restarted'); else assert.ok(g.time > t0 + 1.9, 'practice clock keeps going');
  }
});

test('riding a moving platform, and keeping its velocity when you jump off', () => {
  const g = arena((b) => { b.raw(-1.5, 0, -1.5, 1.5, 0.5, 1.5, 'mover', { mover: { to: { x: 12, y: 0, z: 0 }, period: 6, phase: 0 } }); });
  settle(g); settle(g);
  run(g, 1.5, () => {});
  const m = g.world.dynamic[0];
  assert.ok(g.player.grounded && Math.abs(g.player.pos.x - (m.min.x + 1.5)) < 0.02, 'carried');
  const vx = m.vel.x;
  assert.ok(vx > 3);
  run(g, 3 * DT, (i, _t, n) => { i.jump = n === 0; });
  assert.ok(Math.abs(g.player.vel.x - vx) < 0.5, `inherited ${g.player.vel.x} of ${vx}`);
});

test('player step alone never produces NaN, even wedged in a corner', () => {
  const w = new World([{ min: { x: -5, y: -1, z: -5 }, max: { x: 5, y: 0, z: 5 }, look: 'deck', stage: 0, solid: true },
    { min: { x: 1, y: 0, z: -5 }, max: { x: 5, y: 5, z: 5 }, look: 'wall', stage: 0, solid: true },
    { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 5, z: -1 }, look: 'wall', stage: 0, solid: true }]);
  const p = makePlayer(); placePlayer(p, { x: 0, y: 0, z: 0 }, 0);
  const inp = emptyInput(); const ev: never[] = [];
  for (let i = 0; i < 2400; i++) { inp.moveZ = 1; inp.moveX = 1; inp.yaw = -0.6; inp.jump = i % 9 === 0; inp.crouch = i % 50 > 40; w.update(); stepPlayer(w, p, inp, ev); }
  assert.ok(Number.isFinite(p.pos.x + p.pos.y + p.pos.z));
  assert.ok(p.pos.x < 1 - T.radius + 0.01 && p.pos.z > -1 + T.radius - 0.01 && feetOf(p) >= -0.001);
});

test('pressing into a wall does not slow a jump or a fall', () => {
  const g = arena((b) => { b.raw(-5, 0, -1.5, 5, 30, -1, 'wall'); });
  settle(g);
  let apex = 0, air = 0;
  run(g, 1.2, (i, _t, n) => { i.moveZ = 1; i.jump = n === 20; apex = Math.max(apex, feetOf(g.player)); if (!g.player.grounded) air++; });
  assert.ok(Math.abs(apex - 1.65) < 0.04, `apex against a wall ${apex}`);
  assert.ok(Math.abs(air * DT - (2 * T.jumpV) / T.gravity) < 0.03, `airtime against a wall ${air * DT}`);
});
