// Hitscan weapons. Every shot is also a movement tool: the shotgun kicks you, the pistol trips anchors,
// the rail trips distant switches and bounces off mirrors.
import type { V3 } from './math.ts';
import { lookDir, rightXZ, cross, norm, addScaled, dot } from './math.ts';
import type { Hit, World } from './world.ts';
import { raySphere } from './world.ts';
import type { Ev, Input, Player } from './player.ts';
import { eyeOf, impulse } from './player.ts';
import type { Enemy } from './enemies.ts';
import { ENEMY, radiusOf, weakPos } from './enemies.ts';
import type { TargetDef } from './defs.ts';
import { WEAPONS, SHOTGUN, RAIL, T } from './tuning.ts';

export interface Target {
  id: number;
  def: TargetDef;
  pos: V3;
  lit: number;      // charge targets: seconds left lit
  cool: number;     // seconds until usable again
}

export interface Arena {
  world: World;
  enemies: Enemy[];
  targets: Target[];
  damage(e: Enemy, amount: number, weak: boolean, weapon: number): boolean; // true when it dies
  trip(t: Target, weapon: number): boolean;                                 // true when it reacted
}

const hit: Hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };

interface Trace { t: number; enemy: Enemy | null; weak: boolean; target: Target | null; wall: boolean; n: V3; mirror: boolean }

/** Nearest thing along a ray. */
function trace(a: Arena, o: V3, dir: V3, range: number, skipEnemies: Set<Enemy> | null, weapon: number): Trace {
  const r: Trace = { t: range, enemy: null, weak: false, target: null, wall: false, n: { x: 0, y: 1, z: 0 }, mirror: false };
  const tw = a.world.ray(o, dir, range, hit);
  if (tw !== Infinity) { r.t = tw; r.wall = true; r.n = { x: hit.nx, y: hit.ny, z: hit.nz }; r.mirror = !!hit.box?.def.mirror; }
  for (const e of a.enemies) {
    if (!e.alive || skipEnemies?.has(e)) continue;
    let te = raySphere(o, dir, e.pos, radiusOf(e));
    let weak = false;
    const wp = weakPos(e);
    if (wp) {
      const tk = raySphere(o, dir, wp, ENEMY.warden.weakRadius);
      if (tk !== Infinity && tk <= te + 0.25) { te = tk; weak = true; }
    }
    if (te < r.t) { r.t = te; r.enemy = e; r.weak = weak; r.target = null; r.wall = false; r.mirror = false; }
  }
  for (const t of a.targets) {
    if (t.cool > 0) continue;
    if (t.def.kind === 'anchor' && weapon !== 1) continue;
    if (t.def.railOnly && weapon !== 2) continue;
    const tt = raySphere(o, dir, t.pos, t.def.radius);
    if (tt < r.t) { r.t = tt; r.target = t; r.enemy = null; r.wall = false; r.mirror = false; }
  }
  return r;
}

/** Try to fire the current weapon. Returns true if a shot went off. */
export function fire(a: Arena, p: Player, inp: Input, ev: Ev[]): boolean {
  const pressed = inp.fire && !p.prevFire;
  p.prevFire = inp.fire;
  if (inp.weapon !== p.weapon && inp.weapon >= 0 && inp.weapon < WEAPONS.length) {
    p.weapon = inp.weapon;
    p.cool[p.weapon] = Math.max(p.cool[p.weapon], 0.1);
  }
  const wi = p.weapon, def = WEAPONS[wi];
  if (!inp.fire || (!def.auto && !pressed) || p.cool[wi] > 0) return false;
  if (wi === 0 && p.shells <= 0) { if (pressed) ev.push({ type: 'dryfire' }); return false; }
  p.cool[wi] = def.cycle;

  const eye = eyeOf(p);
  const aim = lookDir(p.yaw, p.pitch);
  const segs: { a: V3; b: V3 }[] = [];
  let anyHit = false, anyKill = false;

  if (wi === 0) {
    p.shells--;
    p.reloadT = 0;
    const right = rightXZ(p.yaw), up = cross(right, aim);
    const dealt = new Map<Enemy, { dmg: number; weak: boolean }>();
    SHOTGUN.pattern.forEach(([ox, oy], i) => {
      const dir = norm({ x: aim.x + right.x * ox + up.x * oy, y: aim.y + right.y * ox + up.y * oy, z: aim.z + right.z * ox + up.z * oy });
      const r = trace(a, eye, dir, def.range, null, wi);
      const end = addScaled(eye, dir, r.t);
      if (i % 2 === 0 || r.enemy) segs.push({ a: eye, b: end });
      if (r.enemy) {
        const d = dealt.get(r.enemy) ?? { dmg: 0, weak: false };
        d.dmg += def.damage * (r.weak ? ENEMY.warden.weakMult : 1);
        d.weak = d.weak || r.weak;
        dealt.set(r.enemy, d);
        if (i % 3 === 0) ev.push({ type: 'impact', pos: end, n: { x: -dir.x, y: -dir.y, z: -dir.z }, kind: r.weak ? 'weak' : 'enemy' });
      } else if (r.target) {
        if (a.trip(r.target, wi)) { anyHit = true; ev.push({ type: 'impact', pos: end, n: { x: -dir.x, y: -dir.y, z: -dir.z }, kind: 'target' }); }
      } else if (r.wall && i % 2 === 0) ev.push({ type: 'impact', pos: end, n: r.n, kind: 'wall' });
    });
    for (const [e, d] of dealt) {
      anyHit = true;
      e.stagger = SHOTGUN.stagger;
      if (a.damage(e, d.dmg, d.weak, wi)) anyKill = true;
    }
  } else if (wi === 1) {
    const r = trace(a, eye, aim, def.range, null, wi);
    const end = addScaled(eye, aim, r.t);
    segs.push({ a: eye, b: end });
    const back = { x: -aim.x, y: -aim.y, z: -aim.z };
    if (r.enemy) {
      anyHit = true;
      ev.push({ type: 'impact', pos: end, n: back, kind: r.weak ? 'weak' : 'enemy' });
      if (a.damage(r.enemy, def.damage * (r.weak ? ENEMY.warden.weakMult : 1), r.weak, wi)) anyKill = true;
    } else if (r.target) {
      if (a.trip(r.target, wi)) { anyHit = true; ev.push({ type: 'impact', pos: end, n: back, kind: 'target' }); }
    } else if (r.wall) ev.push({ type: 'impact', pos: end, n: r.n, kind: 'wall' });
  } else {
    // rail: pierces enemies and targets, reflects off mirrors
    let o = eye, dir = aim, left = def.range;
    const done = new Set<Enemy>();
    const tripped = new Set<Target>();
    for (let bounce = 0; bounce <= RAIL.bounces && left > 0; bounce++) {
      const wallT = Math.min(a.world.ray(o, dir, left, hit), left);
      const wallHit = wallT < left;
      const n = { x: hit.nx, y: hit.ny, z: hit.nz }, mirror = wallHit && !!hit.box?.def.mirror;
      for (const e of a.enemies) {
        if (!e.alive || done.has(e)) continue;
        const wp = weakPos(e);
        const tk = wp ? raySphere(o, dir, wp, ENEMY.warden.weakRadius) : Infinity;
        const te = raySphere(o, dir, e.pos, radiusOf(e));
        if (Math.min(tk, te) > wallT) continue;
        const weak = tk <= wallT;
        done.add(e);
        anyHit = true;
        ev.push({ type: 'impact', pos: addScaled(o, dir, Math.min(tk, te)), n: { x: -dir.x, y: -dir.y, z: -dir.z }, kind: weak ? 'weak' : 'enemy' });
        if (a.damage(e, def.damage * (weak ? ENEMY.warden.weakMult : 1), weak, wi)) anyKill = true;
      }
      for (const t of a.targets) {
        if (t.cool > 0 || tripped.has(t) || t.def.kind === 'anchor') continue;
        const tt = raySphere(o, dir, t.pos, t.def.radius);
        if (tt > wallT) continue;
        tripped.add(t);
        if (a.trip(t, wi)) { anyHit = true; ev.push({ type: 'impact', pos: { ...t.pos }, n: { x: -dir.x, y: -dir.y, z: -dir.z }, kind: 'target' }); }
      }
      const end = addScaled(o, dir, wallT);
      segs.push({ a: o, b: end });
      if (!wallHit) break;
      ev.push({ type: 'impact', pos: end, n, kind: mirror ? 'mirror' : 'wall' });
      if (!mirror) break;
      left -= wallT;
      const k = 2 * dot(dir, n);
      dir = norm({ x: dir.x - n.x * k, y: dir.y - n.y * k, z: dir.z - n.z * k });
      o = addScaled(end, n, 0.01);
    }
  }

  // recoil is a plain impulse on the real velocity
  if (def.recoil > 0) impulse(p, { x: -aim.x * def.recoil, y: -aim.y * def.recoil, z: -aim.z * def.recoil });
  ev.push({ type: 'shot', weapon: wi, from: eye, segs, hit: anyHit, kill: anyKill });
  return true;
}

export const pullTo = (p: Player, to: V3): void => { p.pull = { to: { ...to }, t: T.pullTime }; };
