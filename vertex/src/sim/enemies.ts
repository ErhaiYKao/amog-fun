// Enemies are obstacles on rails: their motion is a function of world time and their attacks run on fixed
// cycles, so the same inputs always meet the same fight.
import type { V3 } from './math.ts';
import { v3, sub, norm, dist, addScaled } from './math.ts';
import type { EnemyDef } from './defs.ts';
import { pathAt } from './defs.ts';
import type { Hit, World } from './world.ts';
import type { Ev, Player } from './player.ts';
import { impulse } from './player.ts';
import { DT } from './tuning.ts';

export const ENEMY = {
  sentinel: { hp: 60, radius: 0.8, rebuild: 12, cycle: 2.6, warn: 0.55, range: 46, shotSpeed: 15, shotDamage: 20, shotRadius: 0.32, shotLife: 5 },
  warden: { hp: 220, radius: 1.05, weakRadius: 0.34, weakMult: 4, track: 1.5, lock: 0.5, cool: 1.1, range: 70, damage: 45, beamRadius: 0.3 },
  conductor: { hp: 90, radius: 0.85 },
} as const;

export interface Enemy {
  id: number;
  def: EnemyDef;
  pos: V3;
  hp: number;
  alive: boolean;
  t: number;          // attack clock
  state: 'idle' | 'track' | 'lock' | 'cool';
  aim: V3;            // warden: where the beam points (unit)
  beamEnd: V3;        // warden: where the beam stops
  stagger: number;
  flash: number;      // seconds since last hit (rendering)
  deadT: number;      // seconds since it died
  sees: boolean;
}

export interface Shot { pos: V3; vel: V3; life: number; r: number; damage: number; id: number }

export function makeEnemy(def: EnemyDef, id: number): Enemy {
  return {
    id, def, pos: { ...def.pos }, hp: ENEMY[def.kind].hp, alive: true, t: -(def.phase ?? 0), state: 'idle',
    aim: v3(0, 0, -1), beamEnd: { ...def.pos }, stagger: 0, flash: 9, deadT: 0, sees: false,
  };
}

export const radiusOf = (e: Enemy): number => ENEMY[e.def.kind].radius;
export const weakPos = (e: Enemy): V3 | null => (e.def.weak ? { x: e.pos.x + e.def.weak.x, y: e.pos.y + e.def.weak.y, z: e.pos.z + e.def.weak.z } : null);

const hit: Hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };
let shotId = 1;

/** Segment (a -> a + dir*len) against a box grown by r. */
function segBox(a: V3, dir: V3, len: number, c: V3, h: V3, r: number): boolean {
  let t0 = 0, t1 = len;
  const o = [a.x, a.y, a.z], d = [dir.x, dir.y, dir.z];
  const lo = [c.x - h.x - r, c.y - h.y - r, c.z - h.z - r], hi = [c.x + h.x + r, c.y + h.y + r, c.z + h.z + r];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return false; continue; }
    let a1 = (lo[i] - o[i]) / d[i], a2 = (hi[i] - o[i]) / d[i];
    if (a1 > a2) { const s = a1; a1 = a2; a2 = s; }
    t0 = Math.max(t0, a1); t1 = Math.min(t1, a2);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * `stage` is the stage the player is in: enemies only engage on their own stage, so nothing snipes across floors.
 * `safe` is true while the player stands in a checkpoint: nothing targets a spawn point.
 */
export function stepEnemies(w: World, p: Player, stage: number, safe: boolean, enemies: Enemy[], shots: Shot[], ev: Ev[], hurt: (n: number, from: V3) => void): void {
  for (const e of enemies) {
    e.flash += DT;
    if (!e.alive) {
      // sentinels are fabricated again after a while, so a wasted kill never strands a run
      e.deadT += DT;
      if (e.def.kind === 'sentinel' && e.deadT >= ENEMY.sentinel.rebuild) {
        e.alive = true; e.hp = ENEMY.sentinel.hp; e.t = 0; e.stagger = 0;
        pathAt(e.def.pos, e.def.path, w.time, e.pos);
        ev.push({ type: 'rebuild', pos: { ...e.pos } });
      }
      continue;
    }
    pathAt(e.def.pos, e.def.path, w.time, e.pos);
    if (e.def.kind === 'conductor') continue;
    if (e.stagger > 0) { e.stagger -= DT; continue; }
    const c = ENEMY[e.def.kind];
    const range = 'range' in c ? c.range : 0;
    const d = dist(e.pos, p.pos);
    e.sees = p.alive && !safe && e.def.stage === stage && d < range && w.los(e.pos, p.pos);

    if (e.def.kind === 'sentinel') {
      const s = ENEMY.sentinel;
      // the clock only runs while it can see you, so the first shot is always a full cycle after contact
      if (!e.sees && e.t < s.cycle - s.warn) { if (e.t > 0) e.t = Math.max(0, e.t - DT); continue; }
      const before = e.t;
      e.t += DT;
      if (before < s.cycle - s.warn && e.t >= s.cycle - s.warn) ev.push({ type: 'telegraph', pos: { ...e.pos }, kind: 'sentinel' });
      if (e.t >= s.cycle) {
        e.t = 0;
        if (e.sees) {
          const dir = norm(sub(p.pos, e.pos));
          shots.push({ pos: addScaled(e.pos, dir, s.radius), vel: { x: dir.x * s.shotSpeed, y: dir.y * s.shotSpeed, z: dir.z * s.shotSpeed }, life: s.shotLife, r: s.shotRadius, damage: s.shotDamage, id: shotId++ });
          ev.push({ type: 'enemyShot', pos: { ...e.pos }, kind: 'sentinel' });
        }
      }
    } else {
      const s = ENEMY.warden;
      if (e.state === 'idle') {
        if (e.sees) { e.state = 'track'; e.t = 0; ev.push({ type: 'telegraph', pos: { ...e.pos }, kind: 'warden' }); }
        continue;
      }
      e.t += DT;
      if (e.state === 'track') {
        e.aim = norm(sub(p.pos, e.pos));
        if (!e.sees) { e.state = 'idle'; continue; }
        if (e.t >= s.track) { e.state = 'lock'; e.t = 0; }
      } else if (e.state === 'lock') {
        if (e.t >= s.lock) {
          const len = Math.min(w.ray(e.pos, e.aim, 200, hit), 200);
          e.beamEnd = addScaled(e.pos, e.aim, len);
          ev.push({ type: 'beam', a: { ...e.pos }, b: { ...e.beamEnd } });
          if (p.alive && segBox(e.pos, e.aim, len, p.pos, p.half, s.beamRadius)) {
            hurt(s.damage, e.pos);
            impulse(p, { x: e.aim.x * 5, y: 2, z: e.aim.z * 5 });
          }
          e.state = 'cool'; e.t = 0;
        }
      } else if (e.t >= s.cool) { e.state = 'idle'; e.t = 0; }
      if (e.state === 'track' || e.state === 'lock') {
        const len = Math.min(w.ray(e.pos, e.aim, 200, hit), 200);
        e.beamEnd = addScaled(e.pos, e.aim, len);
      }
    }
  }

  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const sp = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
    const dir = { x: s.vel.x / sp, y: s.vel.y / sp, z: s.vel.z / sp };
    const step = sp * DT;
    let gone = false;
    if (w.ray(s.pos, dir, step, hit) !== Infinity) gone = true;
    else if (p.alive && segBox(s.pos, dir, step, p.pos, p.half, s.r)) {
      hurt(s.damage, s.pos);
      impulse(p, { x: dir.x * 3, y: 1.5, z: dir.z * 3 });
      gone = true;
    }
    s.pos.x += s.vel.x * DT; s.pos.y += s.vel.y * DT; s.pos.z += s.vel.z * DT;
    s.life -= DT;
    if (gone || s.life <= 0) {
      ev.push({ type: 'boom', pos: { ...s.pos } });
      shots.splice(i, 1);
    }
  }
}
