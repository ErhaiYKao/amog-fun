// The intended route through each stage of the tower, as bot scripts. If a script fails after a level edit,
// either the jump became impossible or the script needs the same edit.
import type { Act, Bot } from './bot.ts';
import type { Enemy } from '../../vertex/src/sim/enemies.ts';
import type { Target } from '../../vertex/src/sim/weapons.ts';
import { topOf } from './bot.ts';
import type { V3 } from '../../vertex/src/sim/math.ts';
import { sidePoint, SIDE_YAW } from '../../vertex/src/sim/level.ts';
import { feetOf } from '../../vertex/src/sim/player.ts';

const DOWN = -1.55;

export function stage1(b: Bot): void {
  const M = b.g.level.marks;
  for (const k of ['s1.p1', 's1.p2', 's1.p3']) b.jumpTo(M[k], { label: k, sprint: false });
  b.jumpTo(M['s1.c01'], { label: 's1.c01 sprint gap' });
  for (const k of ['s1.q1', 's1.q2', 's1.q3']) b.jumpTo(M[k], { label: k, sprint: false });
  b.walkTo(sidePoint(1, 1.0, 18.4, 6.9), { label: 'wrap setup', sprint: false });
  b.jumpTo(M['s1.q4in'], { label: 's1 wraparound', via: [M['s1.wrap']], sprint: false });
  b.jumpTo(M['s1.c12'], { label: 's1.c12' });
  b.walkTo(sidePoint(2, -14.5, 16, 6.9), { label: 'beam start' });
  b.walkTo(M['s1.beam'], { label: 'beam', sprint: false });
  b.walkTo(M['s1.chimney'], { label: 'chimney floor' });
  b.climb(M['s1.top'], sidePoint(2, 1, 0, 0), { label: 'chimney' });
  // slide under the lintel
  b.label = 'slide';
  b.walkTo(sidePoint(2, 5, 15.5, 14.9));
  b.keys({ yaw: SIDE_YAW[2], moveZ: 1, sprint: true });
  b.step(40);
  b.keys({ crouch: true });
  b.waitForKeys(() => b.hdist(M['s1.slid']) < 0.7 || sideS(2, b.p.pos) > 12.2, 4, 'slide');
  b.idle();
  b.jumpTo(M['s1.c23'], { label: 's1.c23' });
  b.walkTo(sidePoint(3, -18.5, 16, 14.9), { label: 'runway start' });
  b.jumpTo(M['s1.g1'], { label: 's1 long jump', slide: true, brake: false });
  // the lift
  const lift = b.mover(M['s1.lift0']);
  b.waitFor(() => lift.max.y < 15.0 && lift.vel.y === 0 && b.g.world.time % 7 < 0.3, 12, 'lift down');
  b.jumpTo(() => topOf(lift), { label: 'onto lift', sprint: false, r: 1.6 });
  b.waitFor(() => lift.max.y > 21.3, 8, 'lift up');
  b.jumpTo(M['s1.h1'], { label: 's1.h1', sprint: false });
  b.jumpTo(M['s2'], { label: 'deck 2', sprint: false, r: 6 });
}

export function stage2(b: Bot): void {
  const M = b.g.level.marks;
  const down = () => b.shootAngles(b.inp.yaw, DOWN, 0);
  const back = (pitch: number) => () => b.shootAngles(b.inp.yaw + Math.PI, pitch, 0);
  const reload = () => b.waitFor(() => b.p.shells === 2, 3, 'reload');
  b.jumpTo(M['s2.a1'], { label: 's2.a1 recoil ledge', acts: [{ at: 0.02, do: down }] });
  reload();
  b.jumpTo(M['s2.c01'], { label: 's2 recoil gap', acts: [{ at: 0.03, do: back(-1.1) }], brake: false, r: 5 });
  reload();
  for (const k of ['s2.b1', 's2.b2', 's2.b3']) { b.jumpTo(M[k], { label: k, acts: [{ at: 0.02, do: down }], sprint: false }); reload(); }
  b.jumpTo(M['s2.c12'], { label: 's2.c12', r: 4.5 });
  b.walkTo(sidePoint(2, -18.5, 16, 40), { label: 'tunnel runway' });
  b.jumpTo(M['s2.e2'], { label: 's2 tunnel backshot', acts: [{ at: 0.03, do: back(0) }], brake: false, r: 3.5 });
  reload();
  b.jumpTo(M['s2.c23'], { label: 's2 across and up', acts: [{ at: 0.03, do: back(-1.25) }] });
  reload();
  b.walkTo(sidePoint(3, -18.5, 16, 44.5), { label: 'lethal runway' });
  b.jumpTo(M['s2.g2'], { label: 's2 lethal floor', acts: [{ at: 0.03, do: back(-1.0) }, { at: 0.55, do: back(-1.2) }], brake: true, r: 2.5 });
  reload();
  b.jumpTo(M['s3'], { label: 'deck 3 double kick', acts: [{ at: 0.02, do: down }, { at: 0.46, do: down }], sprint: false, r: 6 });
}

const up = (p: V3, dy: number): V3 => ({ x: p.x, y: p.y + dy, z: p.z });

function tools(b: Bot) {
  const L = b.g.level;
  const E = (name: string): Enemy => b.g.enemies[L.ids[name]];
  const Tg = (name: string): Target => b.g.targets[L.ids[name]];
  const down = () => b.shootAngles(b.inp.yaw, DOWN, 0);
  const reload = () => b.waitFor(() => b.p.shells === 2, 3, 'reload');
  /** Shoot an enemy with the shotgun as we pass over it. */
  const K = (e: Enemy, within = 1.7): Act => ({ at: () => b.hdist(e.pos) < within && b.p.cool[0] <= 0, do: () => b.shootAt(e.pos, 0) });
  /** Dash at a point straight away. */
  const D = (to: V3 | (() => V3)): Act => ({ at: 0, do: () => b.dashAt(to) });
  /** Dash once the climb is spent. */
  const Dtop = (to: V3): Act => ({ at: () => b.p.vel.y < 1, do: () => b.dashAt(to) });
  return { M: L.marks, E, Tg, down, reload, K, D, Dtop };
}

export function stage3(b: Bot): void {
  const { M, E, down, reload, K, D, Dtop } = tools(b);
  b.jumpTo(M['s3.a1'], { label: 's3 first sentinel', acts: [K(E('s3.e0')), Dtop(up(M['s3.a1'], 2.5))], r: 4.5 });
  b.walkTo(M['s3.a1']);
  b.jumpKill(E('s3.e1'), 1, 's3.e1');
  reload();
  b.walkTo(sidePoint(0, 9.6, 16, 52), { label: 'overhang edge', sprint: false });
  b.settle();
  b.ready(0);
  b.jumpTo(M['s3.c01'], {
    label: 's3 overhang', now: true, r: 3.5,
    hold: { at: sidePoint(0, 12.4, 16, 52), until: () => feetOf(b.p) > 62.4 },
    acts: [{ at: 0.02, do: down }, { at: 0.46, do: down }, Dtop(up(sidePoint(0, 13.5, 16, 62), 4.5))],
  });
  reload();
  b.walkTo(sidePoint(1, -18, 16.5, 62), { label: 'bridge run-up' });
  const e3 = E('s3.e3'), e4 = E('s3.e4');
  b.jumpTo(M['s3.c12'], { label: 's3 sentinel bridge', acts: [K(E('s3.e2')), D(() => up(e3.pos, 4.6)), K(e3), D(() => up(e4.pos, 4.6)), K(e4), Dtop(up(M['s3.c12'], 2.5))], r: 3.5 });
  b.jumpKill(E('s3.e5'), 1, 's3.e5');
  for (let i = 0; i < 5; i++) b.jumpTo(M[`s3.d${i}`], { label: `s3.d${i}`, sprint: false, r: 1.2 });
  b.jumpTo(M['s3.c23'], { label: 's3.c23', sprint: false, r: 4 });
  reload();
  b.jumpKill(E('s3.e6'), 1, 's3.e6');
  b.walkTo(sidePoint(3, -18, 16, 66), { label: 'gap run-up' });
  b.ready(0);
  b.jumpTo(M['s3.f1'], { label: 's3 second gap', acts: [{ at: 0.03, do: () => b.shootAngles(b.inp.yaw + Math.PI, -1.0, 0) }, Dtop(up(M['s3.f1'], 2.5))], r: 4.5 });
  b.jumpKill(E('s3.e7'), 1, 's3.e7');
  reload();
  b.walkTo(sidePoint(3, 3, 16, 66), { label: 'wall run-up' });
  b.jumpTo(M['s4'], { label: 's3 wall to deck 4', acts: [{ at: 0.02, do: down }, { at: 0.46, do: down }, Dtop(up(M['s4'], 3))], r: 6 });
}

export function stage4(b: Bot): void {
  const { M, E, Tg } = tools(b);
  // A: switch, pillars, door
  b.ready(1);
  b.shootAt(Tg('s4.sw').pos, 1);
  if (!b.g.world.signal('g4a')) throw new Error('gate switch missed');
  for (let i = 0; i < 3; i++) b.jumpTo(M[`s4.p${i}`], { label: `s4.p${i}`, sprint: false, r: 1, quick: true });
  b.jumpTo(sidePoint(0, 5, 16, 76), { label: 's4.a1', sprint: false, r: 2, quick: true });
  b.walkTo(sidePoint(0, 11, 16, 76), { label: 'through the gate' });
  b.jumpTo(M['s4.c01'], { label: 's4.c01', sprint: false });
  // B: anchor swing
  b.walkTo(sidePoint(1, -18, 16.5, 76), { label: 'anchor run-up' });
  b.ready(1);
  b.jumpTo(M['s4.b1'], { label: 's4 anchor swing', acts: [{ at: 0.12, do: () => b.shootAt(Tg('s4.n0').pos, 1) }], r: 2.5 });
  // C: targets, then the window
  for (const k of ['s4.t0', 's4.t1', 's4.t2']) { b.ready(1); b.shootAt(() => Tg(k).pos, 1); }
  if (b.p.charges < 1) throw new Error('target sequence paid nothing');
  b.walkTo(sidePoint(1, 2, 16.5, 79), { label: 'window run-up' });
  b.jumpTo(M['s4.c12'], { label: 's4 window dash', acts: [{ at: 0.2, do: () => b.dashAt(M['s4.win']) }], r: 3 });
  // D: crumbling steps
  for (let i = 0; i < 4; i++) b.jumpTo(M[`s4.d${i}`], { label: `s4.d${i}`, sprint: false, quick: true, r: 1.3 });
  b.jumpTo(sidePoint(2, 6, 16.5, 83), { label: 's4.e1', sprint: false, r: 2 });
  // E: rail off the mirror into the hidden switch (aim at the switch's mirror image)
  b.walkTo(M['s4.stand'], { r: 0.15, sprint: false, label: 'mirror stand' });
  b.settle();
  b.ready(2);
  b.shootAt(sidePoint(2, 6.5, 22.5, 2 * 92 - 84.65), 2);
  if (!b.g.world.signal('g4e')) throw new Error('mirror shot missed the switch');
  b.walkTo(sidePoint(2, 11.5, 16.5, 83), { label: 'through the rail gate' });
  b.jumpTo(M['s4.c23'], { label: 's4.c23', sprint: false });
  // F: the warden, then its beam
  b.killGround(E('s4.w0'), 2, true, 's4 warden');
  b.walkTo(sidePoint(3, -13.2, 16.5, 83), { label: 'beam start' });
  b.walkTo(M['s4.beam'], { sprint: false, label: 'beam' });
  // H: two anchors up
  b.ready(1);
  b.jumpTo(M['s5'], {
    label: 's4 anchor climb', now: true, r: 6,
    acts: [{ at: 0.1, do: () => b.shootAt(Tg('s4.n1').pos, 1) }, { at: () => !b.p.pull, do: () => b.shootAt(Tg('s4.n2').pos, 1) }],
  });
}

export function stage5(b: Bot): void {
  const { M, E, Tg, down, reload, K, D, Dtop } = tools(b);
  // A: sentinel for the charge, conductor for the bridge
  b.jumpTo(sidePoint(0, -6, 16.5, 100), { label: 's5.a1', sprint: false, r: 2 });
  b.jumpKill(E('s5.e8'), 1, 's5.e8');
  b.killGround(E('s5.c0'), 1, false, 's5 conductor');
  b.walkTo(sidePoint(0, 1, 16.5, 100), { label: 'onto the bridge' });
  b.walkTo(M['s5.c01'], { label: 'bridge' });
  // C: warden first, then the stones
  b.killGround(E('s5.w1'), 2, true, 's5 warden');
  b.walkTo(sidePoint(1, -18, 16.5, 100), { label: 'stones run-up' });
  b.ready(0);
  const e10 = E('s5.e10');
  b.jumpTo(M['s5.c1'], { label: 's5 sentinel stones', acts: [K(E('s5.e9')), D(() => up(e10.pos, 5)), K(e10), Dtop(up(sidePoint(1, 7.5, 16.5, 106), 4.5))], r: 3.5 });
  b.jumpTo(M['s5.c12'], { label: 's5.c12', sprint: false });
  // E: crumbling steps, switch, chimney against the clock
  b.jumpTo(M['s5.d0'], { label: 's5.d0', sprint: false, quick: true, r: 1.2 });
  b.jumpTo(M['s5.d1'], { label: 's5.d1', sprint: false, quick: true, r: 1.2 });
  b.jumpTo(M['s5.floor'], { label: 's5 chimney floor', sprint: false, r: 1.6 });
  b.ready(1);
  b.shootAt(Tg('s5.sw').pos, 1);
  if (!b.g.world.signal('g5e')) throw new Error('lid switch missed');
  b.walkTo(M['s5.chimney'], { label: 'under the fin' });
  b.climb(M['s5.top'], sidePoint(2, 1, 0, 0), { label: 's5 chimney' });
  // F
  b.jumpKill(E('s5.e11'), 1, 's5.e11');
  b.walkTo(sidePoint(2, 7, 16, 119), { label: 'roof' });
  b.jumpTo(M['s5.c23'], { label: 's5.c23' });
  // G: the crown
  b.killGround(E('s5.c1'), 1, false, 's5 crown conductor');
  reload();
  b.ready(0);
  b.jumpTo(M['s5.st1'], { label: 's5 step 1', acts: [{ at: 0.02, do: down }], sprint: false, r: 1.6 });
  reload();
  b.jumpTo(M['s5.st2'], { label: 's5 step 2', acts: [{ at: 0.02, do: down }], sprint: false, r: 1.6 });
  b.jumpTo(M['s5.rim'], { label: 's5 summit rim', sprint: false, r: 3 });
  b.walkTo(M['summit'], { r: 1, label: 'summit' });
}

/** s coordinate of a world point on a side. */
export function sideS(side: number, p: V3): number {
  return [p.x, -p.z, -p.x, p.z][side & 3];
}

export const ROUTES = [stage1, stage2, stage3, stage4, stage5];
export const feet = (b: Bot): number => feetOf(b.p);
