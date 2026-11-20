// Tiny vector helpers for the simulation. The sim never imports three.js, so it runs headless in Node.
export interface V3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const set = (o: V3, a: V3): V3 => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a: V3, b: V3, s: number): V3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const hlen = (a: V3): number => Math.hypot(a.x, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const norm = (a: V3): V3 => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : v3(); };
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Look direction for yaw/pitch. Yaw 0 faces -Z, positive yaw turns left; positive pitch looks up. */
export const lookDir = (yaw: number, pitch: number): V3 => {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
};
export const forwardXZ = (yaw: number): V3 => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
export const rightXZ = (yaw: number): V3 => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });
/** Yaw that faces from a towards b. */
export const yawTo = (a: V3, b: V3): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));
export const pitchTo = (a: V3, b: V3): number => Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));

/** Deterministic PRNG (visual jitter only; gameplay has no randomness). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
