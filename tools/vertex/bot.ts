// A scripted player for tests: drives the real simulation through the same Input the keyboard produces.
// It has perfect aim and timing but no powers the player lacks.
import { Game } from '../../vertex/src/sim/game.ts';
import type { Ev, Input } from '../../vertex/src/sim/player.ts';
import { emptyInput, eyeOf, feetOf, hspeed } from '../../vertex/src/sim/player.ts';
import type { V3 } from '../../vertex/src/sim/math.ts';
import { yawTo, pitchTo, forwardXZ } from '../../vertex/src/sim/math.ts';
import type { Box } from '../../vertex/src/sim/world.ts';
import type { Enemy } from '../../vertex/src/sim/enemies.ts';
import { weakPos } from '../../vertex/src/sim/enemies.ts';
import { DT, T } from '../../vertex/src/sim/tuning.ts';

export type Pt = V3 | (() => V3);
const at = (p: Pt): V3 => (typeof p === 'function' ? p() : p);

/** Acts run in order: each waits for its own trigger (seconds after takeoff, the apex, or a condition). */
export interface Act { at: number | 'apex' | (() => boolean); do: () => void; done?: boolean }

export interface JumpOpts {
  sprint?: boolean;
  slide?: boolean;        // slide into the jump for the boost
  brake?: boolean;        // slow down in the air to land on the mark (default true)
  via?: V3[];             // steer through these points first
  acts?: Act[];           // things to do in the air
  r?: number;             // landing tolerance (horizontal)
  timeout?: number;
  early?: number;         // jump this many metres before the edge
  quick?: boolean;        // do not stop on the target (crumbling platforms)
  now?: boolean;          // jump from where we stand instead of running to an edge
  hold?: { at: V3; until: () => boolean };  // hover over this spot until the condition holds (climbing past an overhang)
  label?: string;
}

export class Bot {
  g: Game;
  inp: Input = emptyInput();
  events: Ev[] = [];
  verbose = false;
  label = '';

  constructor(g: Game) {
    this.g = g;
    this.inp.yaw = g.player.yaw;
    this.step(2);
  }

  get p() { return this.g.player; }

  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.g.step(this.inp);
      for (const e of this.g.events) {
        if (e.type === 'death') throw new Error(`[${this.label}] died: ${e.reason} at ${this.where()}`);
        this.events.push(e);
      }
      this.g.events.length = 0;
    }
  }

  where(): string {
    const p = this.p;
    return `(${p.pos.x.toFixed(2)}, ${feetOf(p).toFixed(2)}, ${p.pos.z.toFixed(2)}) v=(${p.vel.x.toFixed(1)}, ${p.vel.y.toFixed(1)}, ${p.vel.z.toFixed(1)}) t=${this.g.world.time.toFixed(2)}`;
  }

  keys(o: Partial<Input>): void { Object.assign(this.inp, o); }
  idle(): void { this.keys({ moveX: 0, moveZ: 0, jump: false, sprint: false, crouch: false, fire: false, dash: false }); }

  wait(seconds: number): void { this.idle(); this.step(Math.ceil(seconds / DT)); }

  waitFor(cond: () => boolean, timeout = 12, label = 'waitFor'): void {
    this.idle();
    for (let t = 0; !cond(); t += DT) {
      if (t > timeout) throw new Error(`[${label}] timed out at ${this.where()}`);
      this.step();
    }
  }

  /** Like waitFor, but keeps whatever keys are held. */
  waitForKeys(cond: () => boolean, timeout = 12, label = 'waitFor'): void {
    for (let t = 0; !cond(); t += DT) {
      if (t > timeout) throw new Error(`[${label}] timed out at ${this.where()}`);
      this.step();
    }
  }

  /** Is there floor under a hull-sized footprint at this spot? */
  supported(x: number, z: number): boolean {
    const p = this.p;
    return this.g.world.overlaps({ x, y: feetOf(p) - 0.06, z }, { x: p.half.x, y: 0.05, z: p.half.z });
  }

  hdist(t: V3): number { return Math.hypot(t.x - this.p.pos.x, t.z - this.p.pos.z); }

  /** Run along the ground to a point. */
  walkTo(target: Pt, o: { r?: number; sprint?: boolean; timeout?: number; label?: string } = {}): void {
    this.label = o.label ?? this.label;
    this.idle();
    let air = 0;
    for (let t = 0; ; t += DT) {
      const to = at(target);
      const d = this.hdist(to);
      if (d < (o.r ?? 0.3)) break;
      if (t > (o.timeout ?? 8)) throw new Error(`[${this.label}] walkTo timed out at ${this.where()}`);
      air = this.p.grounded ? 0 : air + DT;
      if (air > 0.4) throw new Error(`[${this.label}] walked off at ${this.where()}`);
      this.inp.yaw = yawTo(this.p.pos, to);
      this.inp.moveZ = 1;
      this.inp.sprint = (o.sprint ?? true) && d > 2;
      if (d < 1.2 && hspeed(this.p) > d * 6) this.inp.moveZ = 0;
      this.step();
    }
    this.idle();
  }

  /** Stand still. */
  settle(): void {
    this.idle();
    for (let t = 0; t < 2 && (hspeed(this.p) > 0.3 || !this.p.grounded); t += DT) this.step();
  }

  // --- shooting --------------------------------------------------------------------------------
  /** Fire one shot with the given view angles (one tick), then restore the yaw. */
  shootAngles(yaw: number, pitch: number, weapon = this.inp.weapon): void {
    const keep = { yaw: this.inp.yaw, pitch: this.inp.pitch, mz: this.inp.moveZ, mx: this.inp.moveX };
    // if the weapon is still cycling or being drawn, wait for it rather than waste the shot
    this.inp.weapon = weapon;
    for (let t = 0; t < 0.6 && (this.p.cool[weapon] > 0 || this.p.weapon !== weapon); t += DT) this.step();
    this.keys({ yaw, pitch, weapon, fire: true, moveZ: 0, moveX: 0 });
    this.step();
    this.keys({ yaw: keep.yaw, pitch: keep.pitch, fire: false, moveZ: keep.mz, moveX: keep.mx });
  }

  shootAt(point: Pt, weapon = this.inp.weapon): void {
    const eye = eyeOf(this.p), to = at(point);
    this.shootAngles(yawTo(eye, to), pitchTo(eye, to), weapon);
  }

  /** Wait (holding still) until the weapon can fire again. */
  ready(weapon = this.inp.weapon): void {
    this.inp.weapon = weapon;
    for (let t = 0; t < 3 && (this.p.cool[weapon] > 0 || this.p.weapon !== weapon); t += DT) this.step();
  }

  dashAt(point: Pt): void {
    const eye = eyeOf(this.p), to = at(point);
    const keep = { yaw: this.inp.yaw, pitch: this.inp.pitch, mz: this.inp.moveZ, mx: this.inp.moveX };
    this.keys({ yaw: yawTo(eye, to), pitch: pitchTo(eye, to), dash: true, moveZ: 1, moveX: 0 });
    this.step();
    this.keys({ dash: false });
    this.step(Math.ceil(T.dashLock / DT));
    this.keys({ yaw: keep.yaw, pitch: keep.pitch, moveZ: keep.mz, moveX: keep.mx });
  }

  // --- air control -------------------------------------------------------------------------------
  /** One tick of steering towards a point. */
  steer(to: V3, brake: boolean): void {
    const p = this.p;
    const dx = to.x - p.pos.x, dz = to.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const sp = hspeed(p);
    let want = Math.max(sp, T.walk);
    if (brake) {
      // slow down only as much as it takes to come down on the mark, never so much that we fall short
      const h = feetOf(p) - to.y, vy = p.vel.y;
      const disc = vy * vy + 2 * T.gravity * h;
      const tLand = p.grounded || disc < 0 ? 0 : (vy + Math.sqrt(disc)) / T.gravity;
      want = Math.min(want, tLand > 0.02 ? d / tLand : Math.sqrt(2 * 16 * Math.max(0, d - 0.15)));
    }
    const wx = d > 1e-6 ? (dx / d) * want - p.vel.x : -p.vel.x, wz = d > 1e-6 ? (dz / d) * want - p.vel.z : -p.vel.z;
    if (Math.hypot(wx, wz) < 0.25) { this.inp.moveZ = 0; return; }
    this.inp.yaw = Math.atan2(-wx, -wz);
    this.inp.moveZ = 1;
  }

  /**
   * Run to the edge, jump, fly to the target and stop on it.
   * Acts fire at a time after takeoff (seconds) or at the apex.
   */
  jumpTo(target: Pt, o: JumpOpts = {}): void {
    const p = this.p;
    this.label = o.label ?? this.label;
    this.idle();
    const first = () => (o.via && o.via.length ? o.via[0] : at(target));
    // run-up
    let airT = 0;
    for (let t = 0; !o.now; t += DT) {
      if (t > 6) throw new Error(`[${this.label}] no edge found at ${this.where()}`);
      // a hit can knock us into the air for a moment; only a real fall is a failure
      airT = p.grounded ? 0 : airT + DT;
      if (airT > 0.6) throw new Error(`[${this.label}] fell during run-up at ${this.where()}`);
      const to = first();
      const yaw = yawTo(p.pos, to);
      const f = forwardXZ(yaw);
      this.keys({ yaw, moveZ: 1, sprint: o.sprint ?? true });
      const sp = Math.max(hspeed(p), 1);
      // where is the edge along our heading?
      let edge = 0;
      while (edge < 8 && this.supported(p.pos.x + f.x * edge, p.pos.z + f.z * edge)) edge += 0.05;
      if (o.slide && edge < 3.2) this.inp.crouch = true;
      if (p.grounded && edge - (o.early ?? 0) <= sp * DT * 2 + 0.05) break;
      if (this.hdist(to) < 0.5 && !o.via) { this.idle(); return; }   // already there: nothing to jump
      this.step();
    }
    if (o.now) this.keys({ yaw: yawTo(p.pos, first()), moveZ: 1 });
    this.keys({ jump: true });
    this.step();
    this.keys({ jump: false, crouch: false });
    this.fly(target, o);
  }

  /** Airborne part of a jump: steer, run the acts, land. */
  fly(target: Pt, o: JumpOpts = {}): void {
    const p = this.p;
    const acts = (o.acts ?? []).map((a) => ({ ...a, done: false }));
    const via = [...(o.via ?? [])];
    let prevVy = p.vel.y;
    let held = false;
    const floor = Math.min(feetOf(p), at(target).y) - 14;
    for (let t = 0; ; t += DT) {
      if (t > (o.timeout ?? 8)) throw new Error(`[${this.label}] flight timed out at ${this.where()}`);
      const goal = at(target);
      while (via.length && this.hdist(via[0]) < 0.6) via.shift();
      const to = via.length ? via[0] : goal;
      const next = acts.find((a) => !a.done);
      if (next) {
        const go = next.at === 'apex' ? prevVy > 0 && p.vel.y <= 0 : typeof next.at === 'number' ? t >= next.at : next.at();
        if (go) { next.done = true; next.do(); }
      }
      prevVy = p.vel.y;
      if (p.grounded && t > 0.05) {
        if (Math.abs(feetOf(p) - goal.y) < 0.6 && this.hdist(goal) < (o.r ?? 3)) break;
        throw new Error(`[${this.label}] landed in the wrong place at ${this.where()} (wanted ${goal.x.toFixed(1)}, ${goal.y.toFixed(1)}, ${goal.z.toFixed(1)})`);
      }
      if (feetOf(p) < floor) throw new Error(`[${this.label}] fell past the target at ${this.where()}`);
      if (o.hold && !held && !o.hold.until()) this.steer(o.hold.at, true);
      else { held = true; this.steer(to, (o.brake ?? true) && !via.length); }
      this.step();
      if (this.verbose && Math.round(t / DT) % 12 === 0) console.log(`  ${this.label} ${this.where()}`);
    }
    if (o.quick) { this.idle(); return; }
    // stop on the platform
    for (let t = 0; t < 1.5 && hspeed(p) > 0.5; t += DT) {
      if (!p.grounded) throw new Error(`[${this.label}] slid off after landing at ${this.where()}`);
      const goal = at(target);
      this.inp.sprint = false;
      if (this.hdist(goal) > 0.4) { this.inp.yaw = yawTo(p.pos, goal); this.inp.moveZ = hspeed(p) > this.hdist(goal) * 5 ? 0 : 1; } else this.inp.moveZ = 0;
      this.step();
    }
    this.idle();
  }

  /** Hop on the spot and kill an enemy while airborne (for the charge), then come back down where we stood. */
  jumpKill(e: Enemy, weapon = 1, label = 'jumpKill'): void {
    const p = this.p;
    this.label = label;
    this.settle();
    this.ready(weapon);
    const home = { x: p.pos.x, y: feetOf(p), z: p.pos.z };
    this.keys({ jump: true });
    this.step();
    this.keys({ jump: false });
    this.step(14);
    for (let t = 0; e.alive; t += DT) {
      if (p.grounded || t > 2) throw new Error(`[${label}] target survived the jump (hp ${e.hp}) at ${this.where()}`);
      if (p.cool[weapon] <= 0) this.shootAt(e.pos, weapon); else this.step();
    }
    this.fly(home, { r: 2.5 });
  }

  /** Stand and shoot until it dies. `weak` aims at the weak point. */
  killGround(e: Enemy, weapon = 1, weak = false, label = 'kill'): void {
    this.label = label;
    this.settle();
    for (let t = 0; e.alive; t += DT) {
      if (t > 12) throw new Error(`[${label}] could not kill it (hp ${e.hp}) at ${this.where()}`);
      this.ready(weapon);
      this.shootAt(weak ? weakPos(e)! : e.pos, weapon);
    }
  }

  /** Kick up between two facing walls until above exitY, then land on the exit. */
  climb(exit: V3, firstWallDir: V3, o: { timeout?: number; label?: string } = {}): void {
    const p = this.p;
    this.label = o.label ?? this.label;
    this.idle();
    this.keys({ jump: true });
    this.step();
    let over = false;
    for (let t = 0, i = 0; ; t += DT, i++) {
      if (t > (o.timeout ?? 12)) throw new Error(`[${this.label}] climb timed out at ${this.where()}`);
      if (feetOf(p) > exit.y + 0.15) over = true;
      const above = over;
      if (p.grounded && t > 0.2) {
        if (Math.abs(feetOf(p) - exit.y) < 0.3) break;
        throw new Error(`[${this.label}] climb ended on the floor at ${this.where()}`);
      }
      this.inp.jump = i % 2 === 0;
      if (above) {
        this.inp.jump = false;
        this.steer(exit, true);
      } else {
        const dir = p.lastWall ?? firstWallDir;
        this.inp.yaw = Math.atan2(-dir.x, -dir.z);
        this.inp.moveZ = 1;
      }
      this.step();
    }
    this.idle();
  }

  /** The moving box whose resting top centre is nearest a point. */
  mover(near: V3): Box {
    let best: Box | null = null, bd = Infinity;
    for (const b of this.g.world.dynamic) {
      if (!b.def.mover) continue;
      const cx = (b.def.min.x + b.def.max.x) / 2, cz = (b.def.min.z + b.def.max.z) / 2;
      const d = Math.hypot(cx - near.x, b.def.max.y - near.y, cz - near.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) throw new Error('no mover');
    return best;
  }
}

export const topOf = (b: Box): V3 => ({ x: (b.min.x + b.max.x) / 2, y: b.max.y, z: (b.min.z + b.max.z) / 2 });
