// Box meshes with the extra per-face data the materials need.
import * as THREE from 'three/webgpu';

export interface BoxShape { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }

// each face: normal, the two in-plane axes (u, v), and its four corners as signs
const FACES: { n: [number, number, number]; u: number; v: number; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], u: 2, v: 1, c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], u: 2, v: 1, c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], u: 0, v: 2, c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], u: 0, v: 2, c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], u: 0, v: 1, c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], u: 0, v: 1, c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

/**
 * One geometry for many boxes. Attributes beyond position/normal:
 *   fuv   metres across the face from its corner     fsize  the face's size in metres
 *   tint  a per-box random number
 * `origin` is subtracted from every position (dynamic boxes are built around their own centre).
 */
export function boxesGeometry(boxes: BoxShape[], origin?: { x: number; y: number; z: number }): THREE.BufferGeometry {
  const n = boxes.length * 24;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), fuv = new Float32Array(n * 2), fsize = new Float32Array(n * 2), tint = new Float32Array(n);
  const idx: number[] = [];
  let v = 0;
  boxes.forEach((b, bi) => {
    const c = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
    const h = [(b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2];
    const o = origin ? [origin.x, origin.y, origin.z] : [0, 0, 0];
    const t = Math.abs(Math.sin(bi * 12.9898 + c[0] * 3.1 + c[1] * 1.7 + c[2] * 2.3) * 43758.5453) % 1;
    for (const f of FACES) {
      for (const s of f.c) {
        pos[v * 3] = c[0] + s[0] * h[0] - o[0]; pos[v * 3 + 1] = c[1] + s[1] * h[1] - o[1]; pos[v * 3 + 2] = c[2] + s[2] * h[2] - o[2];
        nor[v * 3] = f.n[0]; nor[v * 3 + 1] = f.n[1]; nor[v * 3 + 2] = f.n[2];
        fuv[v * 2] = (s[f.u] + 1) * h[f.u]; fuv[v * 2 + 1] = (s[f.v] + 1) * h[f.v];
        fsize[v * 2] = h[f.u] * 2; fsize[v * 2 + 1] = h[f.v] * 2;
        tint[v] = t;
        v++;
      }
      idx.push(v - 4, v - 3, v - 2, v - 4, v - 2, v - 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('fuv', new THREE.BufferAttribute(fuv, 2));
  g.setAttribute('fsize', new THREE.BufferAttribute(fsize, 2));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
