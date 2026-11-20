// VERTEX, the prototype tower: five stages wound around one core. Every platform here was placed by hand
// and every required jump is replayed by a bot in tools/vertex/tower.test.ts.
// Movers and paths given through Builder.box/enemy/target use side coordinates: to = {x: ds, y: dy, z: dr}.
import type { LevelDef } from './defs.ts';
import { Builder, CORE } from './level.ts';

export const STAGE_Y = [0, 24, 52, 76, 100];
export const TOP_Y = 128;

export function buildTower(): LevelDef {
  const b = new Builder();

  // ---------------------------------------------------------------------------------------------
  // Stage 1: MOVEMENT. Jump, sprint, steer, kick off walls, slide, carry momentum.
  // ---------------------------------------------------------------------------------------------
  b.beginStage('Movement', STAGE_Y[0]);
  // the megastructure itself: core and corner pylons (shared by every stage)
  b.raw(-CORE, -40, -CORE, CORE, TOP_Y - 1, CORE, 'wall');
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.raw(sx * 27, -60, sz * 27, sx * 32, TOP_Y + 40, sz * 32, 'wall');
  // ring beams tie the pylons together under every deck: far from the course, but something to land on
  for (const ry of [...STAGE_Y, TOP_Y - 4]) {
    for (const sg of [1, -1]) {
      b.raw(-27, ry - 5, sg * 28.5, 27, ry - 4, sg * 30.5, 'dark');
      b.raw(sg * 28.5, ry - 5, -27, sg * 30.5, ry - 4, 27, 'dark');
    }
  }

  let y = 0;
  b.raw(-21, y - 1.2, 11, -11, y, 21, 'deck');
  b.raw(-11, y - 1.2, 11.5, -CORE, y - 0.2, 13.5, 'dark');
  b.checkpoint('s1', 0, -16, 16, y, true);
  b.hint(0, -16, 16, y, 5, 'WASD move · SPACE jump · SHIFT sprint');
  // three easy hops
  b.plat('s1.p1', 0, -6.5, 16, 0.8, 3, 3);
  b.plat('s1.p2', 0, 0, 17, 1.6, 3, 3);
  b.plat('s1.p3', 0, 6.5, 15.5, 2.4, 4, 3);
  b.hint(0, 6.5, 15.5, 2.4, 3, 'SPRINT, then JUMP at the edge');
  // sprint gap to the south-east corner
  b.plat('s1.c01', 0, 18.5, 16, 2.4, 5, 6);
  b.checkpoint('s1.cp1', 1, -16, 18.5, 2.4, false);

  // east face: rising stairs, then a wraparound
  b.plat('s1.q1', 1, -9, 18, 3.9, 3, 3);
  b.plat('s1.q2', 1, -3.5, 16.5, 5.4, 3, 3);
  b.plat('s1.q3', 1, 1.75, 18, 6.9, 3.5, 3);
  b.box(1, 3.5, 4.1, 12, 20.1, 5.4, 13, 'wall');              // the fin you have to swing around
  b.box(1, 3.5, 4.1, CORE, 12, 9, 11, 'dark');
  b.hint(1, 1.75, 18, 6.9, 2.5, 'Jump out around the wall and steer back in');
  b.mark('s1.wrap', 1, 3.8, 20.9, 6.9);
  b.mark('s1.q4in', 1, 5.8, 19.6, 6.9);
  b.plat('s1.q4', 1, 6, 19, 6.9, 3.8, 4);
  b.plat('s1.c12', 1, 16, 17, 6.9, 6, 6);
  b.checkpoint('s1.cp2', 2, -17, 16, 6.9, false);

  // north face: a beam, the chimney, a slide tunnel
  b.box(2, -14, -4, 15.7, 16.3, 6.4, 6.9, 'safe');
  b.mark('s1.beam', 2, -4.5, 16, 6.9);
  b.box(2, -4, 1, 9, 18, 6.2, 6.9, 'deck');                 // chimney floor
  b.box(2, -4, 1, CORE, 9, 5.6, 6.2, 'dark');
  b.mark('s1.chimney', 2, -0.6, 16, 6.9);
  b.box(2, -3, -2, CORE, 18, 9.1, 21, 'wall');              // near fin (hangs: walk in under it)
  b.box(2, 1, 13, CORE, 18, 6.2, 14.9, 'wall');             // far fin; its roof is the way on
  b.mark('s1.top', 2, 3.5, 15.5, 14.9);
  b.checkpoint('s1.cp3', 2, 3.5, 15.5, 14.9, false, 2);
  b.hint(2, -1, 16, 6.9, 3, 'Jump at a wall, then JUMP again to kick off it. Walls facing each other chain forever');
  b.box(2, 7.5, 11.5, CORE, 18, 16.15, 21, 'wall');         // low lintel: slide under it
  b.hint(2, 4.5, 15.5, 14.9, 2.5, 'CTRL or C while running: SLIDE');
  b.mark('s1.slid', 2, 12.4, 15.5, 14.9);
  b.plat('s1.c23', 2, 17.25, 16, 14.9, 5.5, 6);
  b.checkpoint('s1.cp4', 3, -16, 17, 14.9, false);

  // west face: slide-hop long jump, a rising lift, two steps to the next deck
  b.box(3, -19, -11, 13, 19, 14.4, 14.9, 'safe');           // runway (joins the corner)
  b.hint(3, -16, 16, 14.9, 3, 'Too far for a sprint jump. SLIDE first, then jump: speed carries');
  b.plat('s1.g1', 3, 1.2, 16, 14.9, 5.6, 4);
  b.box(3, 5, 8, 14.5, 17.5, 14.4, 14.9, 'mover', { mover: { to: { x: 2.5, y: 6.5, z: 0 }, period: 7, phase: 0 } });
  b.mark('s1.lift0', 3, 6.5, 16, 14.9);
  b.mark('s1.lift1', 3, 9, 16, 21.4);
  b.plat('s1.h1', 3, 9.5, 20.6, 22.9, 3, 2.4, { strut: false });
  b.box(3, 9.2, 9.8, 19.4, 21, 21.5, 22.4, 'dark');

  // ---------------------------------------------------------------------------------------------
  // Stage 2: RECOIL. The shotgun kicks. Use it.
  // ---------------------------------------------------------------------------------------------
  y = STAGE_Y[1];
  b.beginStage('Recoil', y);
  b.box(3, 13, 21, 11, 21, y - 1.2, y, 'deck');
  b.box(3, 16, 18, CORE, 11, y - 1.2, y - 0.2, 'dark');
  b.checkpoint('s2', 0, -16, 17, y, true);
  b.hint(0, -16, 17, y, 4, 'KS-2 shotgun: LOOK DOWN and FIRE as you jump. The recoil is real');
  // A: a ledge no jump can reach
  b.plat('s2.a1', 0, -5.5, 17, y + 4, 7, 6, { down: 6 });
  b.hint(0, -5.5, 17, y + 4, 3, 'Two shells. They reload while you stand (or slide) on the ground');
  // B: a gap no jump can cross
  b.plat('s2.c01', 0, 15, 16, y + 4, 10, 6);
  b.checkpoint('s2.cp1', 1, -16, 15, y + 4, false);
  // C: three pillars, 4 m each: you must let the shells reload
  b.plat('s2.b1', 1, -8.75, 16.5, y + 8, 3.5, 4, { down: 5 });
  b.plat('s2.b2', 1, -2.75, 16.5, y + 12, 3.5, 4, { down: 5 });
  b.plat('s2.b3', 1, 3.25, 16.5, y + 16, 3.5, 4, { down: 5 });
  b.plat('s2.c12', 1, 14.5, 16, y + 16, 9, 6);
  b.checkpoint('s2.cp2', 2, -16, 14.5, y + 16, false);
  // E: the tunnel: no room to go up, so fire backwards
  b.box(2, -15, 1, 12.5, 19.5, y + 19.9, y + 21, 'wall');
  b.box(2, -15, 1, CORE, 12.5, y + 20.2, y + 20.8, 'dark');
  b.hint(2, -16, 16, y + 16, 3.5, 'No headroom. Turn around mid-jump and FIRE BACKWARDS to fly forwards');
  b.plat('s2.e2', 2, 2.5, 16, y + 16, 7, 6);
  // F: across and up
  b.plat('s2.c23', 2, 16, 16, y + 20.5, 6, 6, { down: 3 });
  b.checkpoint('s2.cp3', 3, -16, 16, y + 20.5, false);
  b.hint(2, 2.5, 16, y + 16, 3, 'Across and up: aim the kick down and behind you');
  // G: 18 m of nothing you can touch
  b.box(3, -13, 5, 11, 21, y + 19.6, y + 20.2, 'lethal', { solid: false, lethal: true });
  b.box(3, -13, 5, CORE, 11, y + 19.2, y + 19.9, 'dark');
  b.hint(3, -16, 16, y + 20.5, 3, 'Orange kills. One jump, as many kicks as you have');
  b.plat('s2.g2', 3, 7.5, 16, y + 20.5, 5, 6);
  b.hint(3, 7.5, 16, y + 20.5, 2.5, 'Seven and a half metres up. Kick, then kick again');

  // ---------------------------------------------------------------------------------------------
  // Stage 3: COMBAT. Sentinels are fuel: an airborne kill pays a charge and a shell.
  // ---------------------------------------------------------------------------------------------
  y = STAGE_Y[2];
  b.beginStage('Combat', y);
  b.box(3, 13, 21, 11, 21, y - 8, y, 'deck');
  b.checkpoint('s3', 0, -16, 17, y, true);
  b.hint(0, -16, 17, y, 4, 'SENTINEL below the gap. Kill it WHILE AIRBORNE: +1 charge, +1 shell. Shooting down at it also kicks you up');
  // A: the first sentinel, parked under a gap too wide to jump
  b.enemy('s3.e0', 'sentinel', 0, -3.5, 17, y - 1.4);
  b.plat('s3.a1', 0, 6.5, 17, y, 7, 6);
  b.hint(0, 6.5, 17, y, 3, 'RIGHT CLICK or Q: DASH. It spends a charge and throws all your speed where you look');
  // B: a ledge ten metres up with nothing to kick off
  b.enemy('s3.e1', 'sentinel', 0, 6.5, 23, y + 2.5);
  b.plat('s3.c01', 0, 17, 16, y + 10, 6, 6, { th: 0.6 });
  b.checkpoint('s3.cp1', 1, -16, 17, y + 10, false);
  b.hint(1, -16, 17, y + 10, 3, 'Stepping stones. Kill, dash, kill, dash');
  // C: the sentinel bridge: 26 m of air and three drones
  b.enemy('s3.e2', 'sentinel', 1, -6.5, 16.5, y + 8.4);
  b.enemy('s3.e3', 'sentinel', 1, 0.5, 16.5, y + 8.4, { phase: 0.8 });
  b.enemy('s3.e4', 'sentinel', 1, 7.5, 16.5, y + 8.4, { phase: 1.6 });
  b.plat('s3.c12', 1, 16, 16, y + 10, 6, 6);
  b.checkpoint('s3.cp2', 2, -16, 16, y + 10, false);
  // D: small pillars under fire
  b.enemy('s3.e5', 'sentinel', 2, -1.5, 22, y + 15.5, { path: { kind: 'orbit', rx: 3, rz: 3, period: 6, phase: 0 } });
  for (let i = 0; i < 5; i++) b.plat(`s3.d${i}`, 2, -9.5 + 4 * i, i % 2 ? 17.5 : 15, y + 10.8 + 0.8 * i, 1.4, 1.4, { down: 2.5 });
  b.plat('s3.c23', 2, 15, 16, y + 14, 8, 6);
  b.checkpoint('s3.cp3', 3, -16, 16, y + 14, false);
  // F: one more gap, then the wall up to stage 4
  b.enemy('s3.e6', 'sentinel', 3, -5.5, 16, y + 12.6);
  b.plat('s3.f1', 3, 5.5, 16, y + 14, 7, 6);
  b.enemy('s3.e7', 'sentinel', 3, 6, 23, y + 18);
  b.hint(3, 5.5, 16, y + 14, 3, 'Ten metres. Everything you have: kick, kick, dash');

  // ---------------------------------------------------------------------------------------------
  // Stage 4: PRECISION. Switches, timed gates, anchors, mirrors, moving targets.
  // ---------------------------------------------------------------------------------------------
  y = STAGE_Y[3];
  b.beginStage('Precision', y);
  b.box(3, 13, 21, 11, 21, y - 8, y, 'deck');
  b.checkpoint('s4', 0, -16, 17, y, true);
  b.hint(0, -16, 17, y, 4, 'Shoot the SWITCH over the door. The gate stays open for five seconds. Keys 1 2 3 change weapon');
  // A: timed gate behind three small pillars
  for (let i = 0; i < 3; i++) b.plat(`s4.p${i}`, 0, -7.5 + 4 * i, 16, y, 1.2, 1.2, { down: 2 });
  b.plat('s4.a1', 0, 8.25, 16, y, 9.5, 5);
  b.box(0, 8, 8.6, CORE, 15, y - 6, y + 12, 'wall');
  b.box(0, 8, 8.6, 17, 24, y - 6, y + 12, 'wall');
  b.box(0, 8, 8.6, 15, 17, y + 3, y + 12, 'wall');
  b.box(0, 8.1, 8.5, 15, 17, y, y + 3, 'gate', { when: { signal: 'g4a', on: false } });
  b.target('s4.sw', 'switch', 0, 7.7, 16, y + 4.3, { signal: 'g4a', seconds: 5.5 });
  b.plat('s4.c01', 0, 17, 16, y, 6, 6);
  b.checkpoint('s4.cp1', 1, -16, 17, y, false);
  b.hint(1, -16, 17, y, 3, 'PP-1 pistol (2): shoot the ANCHOR node mid-jump. It pulls you, and keeps the speed you had');
  // B: anchor swing
  b.target('s4.n0', 'anchor', 1, -5.5, 16.5, y + 10);
  b.plat('s4.b1', 1, 3.5, 16.5, y + 3, 5, 5);
  b.hint(1, 3.5, 16.5, y + 3, 2.5, 'Hit all three moving targets inside 2.6 s for a charge. Then: through the window');
  // C: moving targets, then a window in a wall of light
  b.target('s4.t0', 'charge', 1, 1, 24, y + 5.5, { group: 'c4', radius: 0.45, path: { kind: 'line', to: { x: 5, y: 0, z: 0 }, period: 4, phase: 0 } });
  b.target('s4.t1', 'charge', 1, 6, 25, y + 7.5, { group: 'c4', radius: 0.45, path: { kind: 'line', to: { x: -5, y: 0, z: 0 }, period: 4, phase: 0.3 } });
  b.target('s4.t2', 'charge', 1, 3.5, 24.5, y + 9.5, { group: 'c4', radius: 0.45, path: { kind: 'line', to: { x: 0, y: -2.5, z: 0 }, period: 3, phase: 0.5 } });
  const leth = { solid: false, lethal: true };
  b.box(1, 12, 12.4, 9, 15.5, y - 3, y + 14, 'lethal', leth);
  b.box(1, 12, 12.4, 17.5, 24, y - 3, y + 14, 'lethal', leth);
  b.box(1, 12, 12.4, 15.5, 17.5, y - 3, y + 3.5, 'lethal', leth);
  b.box(1, 12, 12.4, 15.5, 17.5, y + 7, y + 14, 'lethal', leth);
  b.mark('s4.win', 1, 12.2, 16.5, y + 6.2);
  b.plat('s4.c12', 1, 17, 16.5, y + 3, 5, 6);
  b.checkpoint('s4.cp2', 2, -16.5, 17, y + 3, false);
  b.hint(2, -16.5, 17, y + 3, 3, 'These crumble half a second after you touch them');
  // D: crumbling steps
  for (let i = 0; i < 4; i++) b.plat(`s4.d${i}`, 2, -10 + 4 * i, i % 2 ? 18 : 16, y + 4 + i, 2, 2, { look: 'dissolve', extra: { dissolve: { delay: 0.45, back: 3 } } });
  b.plat('s4.e1', 2, 8.75, 16.5, y + 7, 8.5, 5);
  // E: the rail gate. Its switch hides behind a wall; the mirror overhead sees it.
  b.box(2, 9, 9.6, CORE, 15.5, y + 1, y + 18, 'wall');
  b.box(2, 9, 9.6, 17.5, 24, y + 1, y + 18, 'wall');
  b.box(2, 9, 9.6, 15.5, 17.5, y + 10, y + 18, 'wall');
  b.box(2, 9.1, 9.5, 15.5, 17.5, y + 7, y + 10, 'gate', { when: { signal: 'g4e', on: false } });
  b.box(2, 4.5, 9, 20, 20.5, y + 6.5, y + 12.5, 'wall');
  b.box(2, 4.5, 9, 17.5, 21.5, y + 16, y + 16.4, 'mirror', { mirror: true });
  b.box(2, 6.2, 6.8, 20.5, 21.9, y + 8.3, y + 8.8, 'dark');
  b.target('s4.rsw', 'switch', 2, 6.5, 22.5, y + 8.65, { signal: 'g4e', seconds: 0, railOnly: true });
  b.mark('s4.mirror', 2, 6.5, 19.5, y + 16);
  b.mark('s4.stand', 2, 6.5, 16.5, y + 7);
  b.hint(2, 6.5, 16.5, y + 7, 3, 'RR-9 rail (3) bounces off MIRRORS. The white switch behind the wall only answers the rail');
  b.plat('s4.c23', 2, 16.5, 16.5, y + 7, 6, 6);
  b.checkpoint('s4.cp3', 3, -16.5, 16.5, y + 7, false);
  b.hint(3, -16.5, 16.5, y + 7, 3, 'WARDEN: its beam locks on, then fires. Keep moving, or put one rail into the weak point on top');
  // F: a narrow beam under a warden
  b.box(3, -13.5, -1, 16.1, 16.9, y + 6.5, y + 7, 'safe');
  b.mark('s4.beam', 3, -1.5, 16.5, y + 7);
  b.box(3, -8, -6, 23.5, 25.5, y - 4, y + 8.9, 'wall');
  b.enemy('s4.w0', 'warden', 3, -7, 24.5, y + 10, { weak: { x: 0, y: 1.35, z: 0 } });
  // G: sweeping bars, then two anchors up to stage 5
  b.plat('s4.f1', 3, 2.5, 16.5, y + 7, 7, 5);
  b.box(3, -0.6, -0.3, 14, 19, y + 7.3, y + 7.7, 'lethal', { ...leth, mover: { to: { x: 5.9, y: 0, z: 0 }, period: 3.2, phase: 0 } });
  b.box(3, -0.6, -0.3, 14, 19, y + 7.3, y + 7.7, 'lethal', { ...leth, mover: { to: { x: 5.9, y: 0, z: 0 }, period: 3.2, phase: 0.5 } });
  b.target('s4.n1', 'anchor', 3, 9.5, 16, y + 19);
  b.target('s4.n2', 'anchor', 3, 15, 16, y + 30);
  b.hint(3, 2.5, 16.5, y + 7, 3, 'Hop the bars. Two anchors lead up: pull, then pull again');

  // ---------------------------------------------------------------------------------------------
  // Stage 5: GAUNTLET. All of it, in a row.
  // ---------------------------------------------------------------------------------------------
  y = STAGE_Y[4];
  b.beginStage('Gauntlet', y);
  b.box(3, 13, 21, 11, 21, y - 8, y, 'deck');
  b.checkpoint('s5', 0, -16, 17, y, true);
  b.hint(0, -16, 17, y, 4, 'CONDUCTOR: it holds the barrier up and the bridge away. Kill it and the level rearranges');
  // A: a conductor's barrier
  b.plat('s5.a1', 0, -3, 16.5, y, 10, 5);
  b.box(0, -2.2, -1.8, 9, 24, y - 6, y + 12, 'lethal', { ...leth, when: { signal: 'k5a', on: false } });
  b.enemy('s5.c0', 'conductor', 0, -5, 25, y + 5, { signal: 'k5a' });
  b.enemy('s5.e8', 'sentinel', 0, -5, 25, y + 8.5, { path: { kind: 'orbit', rx: 3.5, rz: 3.5, period: 5, phase: 0 } });
  b.box(0, 2, 14, 15.5, 17.5, y - 0.4, y, 'bridge', { when: { signal: 'k5a', on: true } });
  b.plat('s5.c01', 0, 17, 16, y, 6, 6);
  b.checkpoint('s5.cp1', 1, -16, 17, y, false);
  // C: sentinel stones under a warden's eye
  b.box(1, 13, 15, 23, 25, y, y + 8.9, 'wall');
  b.box(1, 13.6, 14.4, 19.5, 23, y + 1.2, y + 1.9, 'dark');
  b.enemy('s5.w1', 'warden', 1, 14, 24, y + 10, { weak: { x: 0, y: 1.35, z: 0 } });
  b.enemy('s5.e9', 'sentinel', 1, -7, 16.5, y - 1.5);
  b.enemy('s5.e10', 'sentinel', 1, 0, 16.5, y + 0.5, { phase: 1 });
  b.plat('s5.c1', 1, 9, 16.5, y + 6, 6, 6);
  b.plat('s5.c12', 1, 17, 16.5, y + 7.5, 6, 6);
  b.checkpoint('s5.cp2', 2, -17, 16.5, y + 7.5, false);
  b.hint(2, -17, 16.5, y + 7.5, 3, 'The switch opens the lid for five seconds. Climb fast');
  // E: crumbling steps into a timed chimney
  b.plat('s5.d0', 2, -11.5, 17, y + 8.3, 1.6, 1.6, { look: 'dissolve', extra: { dissolve: { delay: 0.45, back: 3 } } });
  b.plat('s5.d1', 2, -8.8, 15.5, y + 9.1, 1.6, 1.6, { look: 'dissolve', extra: { dissolve: { delay: 0.45, back: 3 } } });
  b.box(2, -7, 0, 9, 18, y + 9.3, y + 10, 'deck');
  b.box(2, -4, -1, CORE, 9, y + 8.7, y + 9.3, 'dark');
  b.mark('s5.floor', 2, -5.6, 15.5, y + 10);
  b.mark('s5.chimney', 2, -1.6, 15.5, y + 10);
  b.box(2, -4, -3, CORE, 18, y + 12.2, y + 27, 'wall');
  b.box(2, 0, 10, CORE, 18, y + 9.3, y + 19, 'wall');
  b.box(2, 0, 0.5, CORE, 18, y + 19, y + 27, 'gate', { when: { signal: 'g5e', on: false } });
  b.target('s5.sw', 'switch', 2, -1.5, 9.6, y + 11.2, { signal: 'g5e', seconds: 5 });
  b.mark('s5.top', 2, 3, 15.5, y + 19);
  b.checkpoint('s5.cp3', 2, 5, 15.5, y + 19, false, 2);
  b.enemy('s5.e11', 'sentinel', 2, 11.5, 22, y + 22);
  b.plat('s5.c23', 2, 16, 16, y + 19, 6, 6);
  b.checkpoint('s5.cp4', 3, -16, 16, y + 19, false);
  b.hint(3, -16, 16, y + 19, 3, 'The crown of light guards the summit. Its conductor is above you');
  // G: the summit
  for (let k = 0; k < 4; k++) b.box(k, -7.4, 7.4, 6.4, 7.4, y + 21, y + 33, 'lethal', { ...leth, when: { signal: 'k5g', on: false } });
  b.enemy('s5.c1', 'conductor', 3, -10, 22, y + 25, { signal: 'k5g' });
  b.box(3, -12, -9, 9, 12, y + 21.5, y + 22, 'bridge', { when: { signal: 'k5g', on: true } });
  b.box(3, -6, -3, 8.5, 11.5, y + 24.9, y + 25.4, 'bridge', { when: { signal: 'k5g', on: true } });
  b.mark('s5.st1', 3, -10.5, 10.5, y + 22);
  b.mark('s5.st2', 3, -4.5, 10, y + 25.4);
  b.mark('s5.rim', 3, -4.5, 5, TOP_Y - 1);
  b.marks['summit'] = { x: 0, y: TOP_Y - 1, z: 0 };
  b.raw(-2.5, TOP_Y - 1.02, -2.5, 2.5, TOP_Y - 0.97, 2.5, 'finish', { solid: false, decor: true });
  b.finish = { min: { x: -2.5, y: TOP_Y - 0.95, z: -2.5 }, max: { x: 2.5, y: TOP_Y + 3, z: 2.5 } };
  return b.build();
}
