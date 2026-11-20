// Collision world: axis-aligned boxes, some of which move, switch on and off, or dissolve.
// Everything the player can collide with is a box, so sweeps are exact and nothing can tunnel.
import type { V3 } from './math.ts';
import { v3, smooth, clamp } from './math.ts';
import { DT } from './tuning.ts';

export type Look =
  | 'concrete' | 'dark' | 'metal' | 'safe' | 'deck' | 'checkpoint' | 'finish'
  | 'lethal' | 'mirror' | 'gate' | 'bridge' | 'dissolve' | 'mover' | 'wall';

export interface BoxDef {
  min: V3;
  max: V3;
  look: Look;
  stage: number;
  solid: boolean;
  lethal?: boolean;                                   // kills on touch (a trigger volume, not solid)
  mirror?: boolean;                                   // reflects rail shots
  mover?: { to: V3; period: number; phase: number };  // slides to base+to and back, once per period
  when?: { signal: string; on: boolean };             // exists only while the signal has this value
  dissolve?: { delay: number; back: number };         // crumbles after being stood on, returns later
  decor?: boolean;                                    // drawn but never collided with
}

export interface Box {
  id: number;
  def: BoxDef;
  min: V3;
  max: V3;
  vel: V3;          // current velocity (movers)
  delta: V3;        // displacement during the last world update
  active: boolean;  // collidable / lethal right now
  fade: number;     // 0..1 presence, for rendering
  touched: number;  // dissolve: seconds since first stood on (-1 = untouched)
}

export interface Hit { t: number; nx: number; ny: number; nz: number; box: Box | null }

export const SKIN = 0.001;

export class World {
  boxes: Box[] = [];
  colliders: Box[] = [];   // boxes that can ever be solid
  lethals: Box[] = [];
  dynamic: Box[] = [];     // boxes whose transform or presence changes
  signals = new Map<string, { on: boolean; timer: number }>();
  time = 0;
  floorY = 0;

  constructor(defs: BoxDef[]) {
    let lo = Infinity;
    defs.forEach((def, id) => {
      const b: Box = {
        id, def,
        min: { ...def.min }, max: { ...def.max },
        vel: v3(), delta: v3(), active: true, fade: 1, touched: -1,
      };
      this.boxes.push(b);
      if (def.decor) return;
      if (def.solid) this.colliders.push(b);
      if (def.lethal) this.lethals.push(b);
      if (def.mover || def.when || def.dissolve) this.dynamic.push(b);
      if (def.solid) lo = Math.min(lo, def.min.y);
    });
    this.floorY = lo;
    this.reset();
  }

  reset(): void {
    this.time = 0;
    this.signals.clear();
    for (const b of this.dynamic) {
      b.touched = -1;
      b.fade = 1;
      b.vel.x = b.vel.y = b.vel.z = 0;
      b.delta.x = b.delta.y = b.delta.z = 0;
      this.place(b, 0);
      b.active = this.present(b);
      b.fade = b.active ? 1 : 0;
    }
  }

  signal(name: string): boolean { return this.signals.get(name)?.on ?? false; }

  /** Turn a signal on (for `seconds`, or for good when seconds is 0) or off. */
  setSignal(name: string, on: boolean, seconds = 0): void {
    this.signals.set(name, { on, timer: on ? seconds : 0 });
  }

  signalTime(name: string): number { return this.signals.get(name)?.timer ?? 0; }

  private present(b: Box): boolean {
    const d = b.def;
    if (d.when && this.signal(d.when.signal) !== d.when.on) return false;
    if (d.dissolve && b.touched >= d.dissolve.delay) return false;
    return true;
  }

  private place(b: Box, time: number): void {
    const m = b.def.mover;
    if (!m) return;
    const u = (((time / m.period + m.phase) % 1) + 1) % 1;
    const tri = u < 0.5 ? u * 2 : 2 - u * 2;
    const e = smooth(clamp((tri - 0.1) / 0.8, 0, 1));
    const d = b.def;
    b.min.x = d.min.x + m.to.x * e; b.max.x = d.max.x + m.to.x * e;
    b.min.y = d.min.y + m.to.y * e; b.max.y = d.max.y + m.to.y * e;
    b.min.z = d.min.z + m.to.z * e; b.max.z = d.max.z + m.to.z * e;
  }

  /** Advance movers, signal timers and dissolving platforms by one tick. */
  update(): void {
    this.time += DT;
    for (const s of this.signals.values()) {
      if (s.on && s.timer > 0) {
        s.timer -= DT;
        if (s.timer <= 0) { s.timer = 0; s.on = false; }
      }
    }
    for (const b of this.dynamic) {
      if (b.def.mover) {
        const ox = b.min.x, oy = b.min.y, oz = b.min.z;
        this.place(b, this.time);
        b.delta.x = b.min.x - ox; b.delta.y = b.min.y - oy; b.delta.z = b.min.z - oz;
        b.vel.x = b.delta.x / DT; b.vel.y = b.delta.y / DT; b.vel.z = b.delta.z / DT;
      }
      const ds = b.def.dissolve;
      if (ds && b.touched >= 0) {
        b.touched += DT;
        if (b.touched >= ds.delay + ds.back) b.touched = -1;
      }
      b.active = this.present(b);
      const target = b.active ? 1 : 0;
      const rate = DT / 0.18;
      b.fade = target > b.fade ? Math.min(target, b.fade + rate) : Math.max(target, b.fade - rate);
    }
  }

  /**
   * Sweep a box (centre c, half extents h) along d. Reports the first solid box hit with t in [0, 1].
   * Boxes already overlapping the start are ignored (see overlap/depenetrate).
   */
  sweep(c: V3, h: V3, d: V3, out: Hit, ignore: Box | null = null): boolean {
    let best = 2;
    const ex = Math.abs(d.x), ey = Math.abs(d.y), ez = Math.abs(d.z);
    for (const b of this.colliders) {
      if (!b.active || b === ignore) continue;
      const lx = b.min.x - h.x, ux = b.max.x + h.x;
      if (c.x + ex <= lx || c.x - ex >= ux) continue;
      const ly = b.min.y - h.y, uy = b.max.y + h.y;
      if (c.y + ey <= ly || c.y - ey >= uy) continue;
      const lz = b.min.z - h.z, uz = b.max.z + h.z;
      if (c.z + ez <= lz || c.z - ez >= uz) continue;

      let tEnter = -Infinity, tExit = Infinity, axis = -1;
      // x
      if (d.x !== 0) {
        const t1 = (lx - c.x) / d.x, t2 = (ux - c.x) / d.x;
        const a = Math.min(t1, t2), z = Math.max(t1, t2);
        if (a > tEnter) { tEnter = a; axis = 0; }
        if (z < tExit) tExit = z;
      } else if (c.x <= lx || c.x >= ux) continue;
      if (d.y !== 0) {
        const t1 = (ly - c.y) / d.y, t2 = (uy - c.y) / d.y;
        const a = Math.min(t1, t2), z = Math.max(t1, t2);
        if (a > tEnter) { tEnter = a; axis = 1; }
        if (z < tExit) tExit = z;
      } else if (c.y <= ly || c.y >= uy) continue;
      if (d.z !== 0) {
        const t1 = (lz - c.z) / d.z, t2 = (uz - c.z) / d.z;
        const a = Math.min(t1, t2), z = Math.max(t1, t2);
        if (a > tEnter) { tEnter = a; axis = 2; }
        if (z < tExit) tExit = z;
      } else if (c.z <= lz || c.z >= uz) continue;

      if (axis < 0 || tEnter >= tExit || tEnter < 0 || tEnter > 1 || tEnter >= best) continue;
      best = tEnter;
      out.t = tEnter;
      out.box = b;
      out.nx = axis === 0 ? (d.x > 0 ? -1 : 1) : 0;
      out.ny = axis === 1 ? (d.y > 0 ? -1 : 1) : 0;
      out.nz = axis === 2 ? (d.z > 0 ? -1 : 1) : 0;
    }
    return best <= 1;
  }

  /** Is a box (centre c, half h) intersecting anything solid? */
  overlaps(c: V3, h: V3, ignore: Box | null = null): boolean {
    for (const b of this.colliders) {
      if (!b.active || b === ignore) continue;
      if (c.x + h.x > b.min.x && c.x - h.x < b.max.x &&
          c.y + h.y > b.min.y && c.y - h.y < b.max.y &&
          c.z + h.z > b.min.z && c.z - h.z < b.max.z) return true;
    }
    return false;
  }

  /** Push a box out of anything it is inside (movers, things that just materialised). */
  depenetrate(c: V3, h: V3): boolean {
    let moved = false;
    for (let iter = 0; iter < 4; iter++) {
      let any = false;
      for (const b of this.colliders) {
        if (!b.active) continue;
        const px1 = c.x + h.x - b.min.x, px2 = b.max.x - (c.x - h.x);
        const py1 = c.y + h.y - b.min.y, py2 = b.max.y - (c.y - h.y);
        const pz1 = c.z + h.z - b.min.z, pz2 = b.max.z - (c.z - h.z);
        if (px1 <= 0 || px2 <= 0 || py1 <= 0 || py2 <= 0 || pz1 <= 0 || pz2 <= 0) continue;
        const m = Math.min(px1, px2, py1, py2, pz1, pz2);
        if (m === py2) c.y += py2 + SKIN;
        else if (m === py1) c.y -= py1 + SKIN;
        else if (m === px1) c.x -= px1 + SKIN;
        else if (m === px2) c.x += px2 + SKIN;
        else if (m === pz1) c.z -= pz1 + SKIN;
        else c.z += pz2 + SKIN;
        any = moved = true;
      }
      if (!any) break;
    }
    return moved;
  }

  /** Does a box (centre c, half h) touch any active lethal volume? */
  touchesLethal(c: V3, h: V3): boolean {
    for (const b of this.lethals) {
      if (!b.active) continue;
      if (c.x + h.x > b.min.x && c.x - h.x < b.max.x &&
          c.y + h.y > b.min.y && c.y - h.y < b.max.y &&
          c.z + h.z > b.min.z && c.z - h.z < b.max.z) return true;
    }
    return false;
  }

  /** Ray against solid boxes. dir must be unit length. Returns distance or Infinity. */
  ray(o: V3, dir: V3, maxT: number, out: Hit): number {
    let best = maxT;
    let found = false;
    for (const b of this.colliders) {
      if (!b.active) continue;
      let tEnter = -Infinity, tExit = Infinity, axis = -1;
      if (dir.x !== 0) {
        const t1 = (b.min.x - o.x) / dir.x, t2 = (b.max.x - o.x) / dir.x;
        const a = Math.min(t1, t2), z = Math.max(t1, t2);
        if (a > tEnter) { tEnter = a; axis = 0; }
        if (z < tExit) tExit = z;
      } else if (o.x <= b.min.x || o.x >= b.max.x) continue;
      if (dir.y !== 0) {
        const t1 = (b.min.y - o.y) / dir.y, t2 = (b.max.y - o.y) / dir.y;
        const a = Math.min(t1, t2), z = Math.max(t1, t2);
        if (a > tEnter) { tEnter = a; axis = 1; }
        if (z < tExit) tExit = z;
      } else if (o.y <= b.min.y || o.y >= b.max.y) continue;
      if (dir.z !== 0) {
        const t1 = (b.min.z - o.z) / dir.z, t2 = (b.max.z - o.z) / dir.z;
        const a = Math.min(t1, t2), z = Math.max(t1, t2);
        if (a > tEnter) { tEnter = a; axis = 2; }
        if (z < tExit) tExit = z;
      } else if (o.z <= b.min.z || o.z >= b.max.z) continue;
      if (axis < 0 || tEnter >= tExit || tEnter < 0 || tEnter >= best) continue;
      best = tEnter;
      found = true;
      out.t = tEnter;
      out.box = b;
      out.nx = axis === 0 ? (dir.x > 0 ? -1 : 1) : 0;
      out.ny = axis === 1 ? (dir.y > 0 ? -1 : 1) : 0;
      out.nz = axis === 2 ? (dir.z > 0 ? -1 : 1) : 0;
    }
    return found ? best : Infinity;
  }

  /** Clear line between two points? */
  los(a: V3, b: V3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return true;
    return this.ray(a, { x: dx / l, y: dy / l, z: dz / l }, l, scratch) === Infinity;
  }
}

const scratch: Hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };

/** Ray vs sphere; returns distance along the (unit) ray or Infinity. */
export function raySphere(o: V3, dir: V3, c: V3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const q = ox * ox + oy * oy + oz * oz - r * r;
  if (q > 0 && b > 0) return Infinity;
  const disc = b * b - q;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}
