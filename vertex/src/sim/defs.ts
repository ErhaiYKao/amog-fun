// Static level description: what a level file produces and the simulation consumes.
import type { V3 } from './math.ts';
import type { BoxDef } from './world.ts';

export type Path =
  | { kind: 'line'; to: V3; period: number; phase: number }
  | { kind: 'orbit'; rx: number; rz: number; period: number; phase: number };

export interface EnemyDef {
  kind: 'sentinel' | 'warden' | 'conductor';
  pos: V3;
  stage: number;
  path?: Path;
  phase?: number;      // attack cycle offset (seconds)
  signal?: string;     // conductor: this signal turns on when it dies
  weak?: V3;           // warden: weak point offset from pos
}

export interface TargetDef {
  kind: 'switch' | 'anchor' | 'charge';
  pos: V3;
  stage: number;
  radius: number;
  signal?: string;     // switch
  seconds?: number;    // switch: how long the signal stays on (0 = for good)
  railOnly?: boolean;  // switch: only the rail rifle trips it
  group?: string;      // charge: hit every target of the group within the window
  window?: number;
  path?: Path;
}

export interface CheckpointDef {
  feet: V3;
  yaw: number;
  min: V3;
  max: V3;
  stage: number;
  start: boolean;      // first checkpoint of its stage
  name: string;
}

export interface HintDef { pos: V3; r: number; text: string; stage: number }

export interface LevelDef {
  boxes: BoxDef[];
  enemies: EnemyDef[];
  targets: TargetDef[];
  checkpoints: CheckpointDef[];
  hints: HintDef[];
  finish: { min: V3; max: V3 };
  stages: { name: string; y: number }[];
  marks: Record<string, V3>;
  ids: Record<string, number>;   // named enemies and targets -> index
}

export function pathAt(base: V3, path: Path | undefined, time: number, out: V3): V3 {
  if (!path) { out.x = base.x; out.y = base.y; out.z = base.z; return out; }
  const u = (((time / path.period + path.phase) % 1) + 1) % 1;
  if (path.kind === 'line') {
    const tri = u < 0.5 ? u * 2 : 2 - u * 2;
    const e = tri * tri * (3 - 2 * tri);
    out.x = base.x + path.to.x * e; out.y = base.y + path.to.y * e; out.z = base.z + path.to.z * e;
  } else {
    const a = u * Math.PI * 2;
    out.x = base.x + Math.cos(a) * path.rx; out.y = base.y; out.z = base.z + Math.sin(a) * path.rz;
  }
  return out;
}
