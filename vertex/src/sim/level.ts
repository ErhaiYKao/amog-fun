// Level builder. The tower is laid out around a square core; the course laps it anticlockwise while climbing.
// Geometry is authored in "side" coordinates so each face of the tower reads the same way:
//   s = distance along the direction of travel (-16 .. 16 from corner to corner)
//   r = distance out from the tower's axis (the core face is at r = CORE)
//   side 0 = south (travel +x), 1 = east (travel -z), 2 = north (travel -x), 3 = west (travel +z)
import type { V3 } from './math.ts';
import type { BoxDef, Look } from './world.ts';
import type { CheckpointDef, EnemyDef, HintDef, LevelDef, Path, TargetDef } from './defs.ts';

export const CORE = 7;

export const SIDE_YAW = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

export function sidePoint(side: number, s: number, r: number, y: number): V3 {
  switch (side & 3) {
    case 0: return { x: s, y, z: r };
    case 1: return { x: r, y, z: -s };
    case 2: return { x: -s, y, z: -r };
    default: return { x: -r, y, z: s };
  }
}

/** A displacement given in side coordinates (ds along travel, dr outward, dy up). */
export function sideVec(side: number, ds: number, dr: number, dy: number): V3 {
  return sidePoint(side, ds, dr, dy);
}

export interface PlatOpts {
  th?: number;                // thickness (default 0.5)
  look?: Look;
  strut?: boolean;            // cantilever beam back to the core (default true)
  down?: number;              // instead of a slab, a column this tall
  extra?: Partial<BoxDef>;
}

export class Builder {
  boxes: BoxDef[] = [];
  enemies: EnemyDef[] = [];
  targets: TargetDef[] = [];
  checkpoints: CheckpointDef[] = [];
  hints: HintDef[] = [];
  marks: Record<string, V3> = {};
  ids: Record<string, number> = {};
  stages: { name: string; y: number }[] = [];
  finish = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  stage = 0;

  beginStage(name: string, y: number): void {
    this.stage = this.stages.length;
    this.stages.push({ name, y });
  }

  /** Raw world-space box. */
  raw(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, look: Look, extra: Partial<BoxDef> = {}): BoxDef {
    const def: BoxDef = {
      min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
      max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
      look, stage: this.stage, solid: true, ...extra,
    };
    this.boxes.push(def);
    return def;
  }

  /** Box in side coordinates. */
  box(side: number, s0: number, s1: number, r0: number, r1: number, y0: number, y1: number, look: Look, extra: Partial<BoxDef> = {}): BoxDef {
    const a = sidePoint(side, s0, r0, y0), b = sidePoint(side, s1, r1, y1);
    if (extra.mover) extra = { ...extra, mover: { ...extra.mover, to: sideVec(side, extra.mover.to.x, extra.mover.to.z, extra.mover.to.y) } };
    return this.raw(a.x, a.y, a.z, b.x, b.y, b.z, look, extra);
  }

  /** A platform centred on (s, r) with its top at `top`. Records a mark at the top centre. */
  plat(name: string, side: number, s: number, r: number, top: number, ls: number, lr: number, o: PlatOpts = {}): V3 {
    const th = o.down ?? o.th ?? 0.5;
    this.box(side, s - ls / 2, s + ls / 2, r - lr / 2, r + lr / 2, top - th, top, o.look ?? 'safe', o.extra);
    const r0 = r - lr / 2;
    // corner platforms float: a beam back to the core would cut across the next face's course
    const corner = /\.c(01|12|23)$/.test(name);
    if ((o.strut ?? !corner) && r0 > CORE + 0.6 && !o.extra?.mover && !o.extra?.dissolve && !o.extra?.when) {
      const w = Math.min(0.7, ls);
      this.box(side, s - w / 2, s + w / 2, CORE, r0, top - Math.min(th, 0.5) - 0.7, top - Math.min(th, 0.5) - 0.05, 'dark');
    }
    return this.mark(name, side, s, r, top);
  }

  mark(name: string, side: number, s: number, r: number, y: number): V3 {
    const p = sidePoint(side, s, r, y);
    this.marks[name] = p;
    return p;
  }

  pt(side: number, s: number, r: number, y: number): V3 { return sidePoint(side, s, r, y); }

  checkpoint(name: string, side: number, s: number, r: number, y: number, start: boolean, size = 2.5): void {
    const feet = sidePoint(side, s, r, y);
    this.checkpoints.push({
      feet, yaw: SIDE_YAW[side & 3], stage: this.stage, start, name,
      min: { x: feet.x - size, y: y - 0.5, z: feet.z - size }, max: { x: feet.x + size, y: y + 4, z: feet.z + size },
    });
    // a visible pad, flush with the floor
    this.raw(feet.x - 1.2, y - 0.02, feet.z - 1.2, feet.x + 1.2, y + 0.03, feet.z + 1.2, 'checkpoint', { solid: false, decor: true });
    this.marks[name] = feet;
  }

  hint(side: number, s: number, r: number, y: number, radius: number, text: string): void {
    this.hints.push({ pos: sidePoint(side, s, r, y), r: radius, text, stage: this.stage });
  }

  enemy(name: string, kind: EnemyDef['kind'], side: number, s: number, r: number, y: number, extra: Partial<EnemyDef> = {}): number {
    if (extra.path?.kind === 'line') extra = { ...extra, path: { ...extra.path, to: sideVec(side, extra.path.to.x, extra.path.to.z, extra.path.to.y) } };
    this.enemies.push({ kind, pos: sidePoint(side, s, r, y), stage: this.stage, ...extra });
    this.ids[name] = this.enemies.length - 1;
    return this.enemies.length - 1;
  }

  target(name: string, kind: TargetDef['kind'], side: number, s: number, r: number, y: number, extra: Partial<TargetDef> = {}): number {
    let path: Path | undefined = extra.path;
    if (path?.kind === 'line') path = { ...path, to: sideVec(side, path.to.x, path.to.z, path.to.y) };
    this.targets.push({ kind, pos: sidePoint(side, s, r, y), stage: this.stage, radius: kind === 'anchor' ? 0.6 : 0.5, ...extra, path });
    this.ids[name] = this.targets.length - 1;
    return this.targets.length - 1;
  }

  build(): LevelDef {
    return {
      boxes: this.boxes, enemies: this.enemies, targets: this.targets, checkpoints: this.checkpoints,
      hints: this.hints, finish: this.finish, stages: this.stages, marks: this.marks, ids: this.ids,
    };
  }
}
