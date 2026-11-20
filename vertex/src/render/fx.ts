// Pooled effects: glowing shards, tracers, shock rings. All instanced, no allocation while playing.
import * as THREE from 'three/webgpu';
import type { V3 } from '../sim/math.ts';
import { glow } from './materials.ts';

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), d = new THREE.Vector3();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export class Fx {
  group = new THREE.Group();
  // shards
  private N = 700;
  private shards: THREE.InstancedMesh;
  private sp = new Float32Array(this.N * 3);
  private sv = new Float32Array(this.N * 3);
  private sl = new Float32Array(this.N);      // life left
  private sm = new Float32Array(this.N);      // life at birth
  private ss = new Float32Array(this.N);      // size
  private sg = new Float32Array(this.N);      // gravity scale
  private sc = new Float32Array(this.N * 3);
  private si = 0;
  // tracers
  private T = 96;
  private tracers: THREE.InstancedMesh;
  private ta = new Float32Array(this.T * 3);
  private tb = new Float32Array(this.T * 3);
  private tl = new Float32Array(this.T);
  private tm = new Float32Array(this.T);
  private tw = new Float32Array(this.T);
  private tc = new Float32Array(this.T * 3);
  private ti = 0;
  // rings
  private rings: { mesh: THREE.Mesh; life: number; max: number; size: number }[] = [];
  private ri = 0;
  private light = new THREE.PointLight(0xffffff, 0, 30, 1.6);
  private lightT = 0;

  constructor() {
    const mat = glow(0xffffff, 1, { additive: true });
    this.shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1), mat, this.N);
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), glow(0xffffff, 1, { additive: true }), this.T);
    for (const im of [this.shards, this.tracers]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < im.count; i++) { im.setMatrixAt(i, HIDE); im.setColorAt(i, c.setRGB(1, 1, 1)); }
      im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), glow(0xffffff, 1.3, { additive: true }));
      (mesh.material as THREE.Material).side = THREE.DoubleSide;
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, size: 1 });
    }
    this.group.add(this.light);
  }

  /** A spray of shards. `dir` biases the spray (unit vector), spread 0..1 mixes in randomness. */
  burst(pos: V3, hex: number, count: number, speed: number, o: { dir?: V3; spread?: number; life?: number; size?: number; gravity?: number; bright?: number } = {}): void {
    c.setHex(hex);
    const b = o.bright ?? 2;
    for (let n = 0; n < count; n++) {
      const i = this.si; this.si = (this.si + 1) % this.N;
      d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (o.dir) d.multiplyScalar(o.spread ?? 0.5).add(v.set(o.dir.x, o.dir.y, o.dir.z)).normalize();
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.sp[i * 3] = pos.x; this.sp[i * 3 + 1] = pos.y; this.sp[i * 3 + 2] = pos.z;
      this.sv[i * 3] = d.x * sp; this.sv[i * 3 + 1] = d.y * sp; this.sv[i * 3 + 2] = d.z * sp;
      this.sl[i] = this.sm[i] = (o.life ?? 0.5) * (0.6 + Math.random() * 0.6);
      this.ss[i] = (o.size ?? 0.07) * (0.6 + Math.random() * 0.8);
      this.sg[i] = o.gravity ?? 0.4;
      this.sc[i * 3] = c.r * b; this.sc[i * 3 + 1] = c.g * b; this.sc[i * 3 + 2] = c.b * b;
    }
  }

  tracer(a: V3, bb: V3, hex: number, width = 0.02, life = 0.12, bright = 3): void {
    const i = this.ti; this.ti = (this.ti + 1) % this.T;
    this.ta[i * 3] = a.x; this.ta[i * 3 + 1] = a.y; this.ta[i * 3 + 2] = a.z;
    this.tb[i * 3] = bb.x; this.tb[i * 3 + 1] = bb.y; this.tb[i * 3 + 2] = bb.z;
    this.tl[i] = this.tm[i] = life; this.tw[i] = width;
    c.setHex(hex);
    this.tc[i * 3] = c.r * bright; this.tc[i * 3 + 1] = c.g * bright; this.tc[i * 3 + 2] = c.b * bright;
  }

  /** An expanding ring lying in the plane with normal n. */
  ring(pos: V3, n: V3, hex: number, size = 3, life = 0.35): void {
    const r = this.rings[this.ri]; this.ri = (this.ri + 1) % this.rings.length;
    r.mesh.position.set(pos.x, pos.y, pos.z);
    r.mesh.quaternion.setFromUnitVectors(Z, v.set(n.x, n.y, n.z).normalize());
    ((r.mesh.material as THREE.MeshBasicNodeMaterial).color as THREE.Color).setHex(hex);
    r.life = r.max = life; r.size = size;
    r.mesh.visible = true;
  }

  flash(pos: V3, hex: number, intensity = 60): void {
    this.light.position.set(pos.x, pos.y, pos.z);
    this.light.color.setHex(hex);
    this.light.intensity = intensity;
    this.lightT = 0.09;
  }

  update(dt: number): void {
    // shards
    for (let i = 0; i < this.N; i++) {
      if (this.sl[i] <= 0) continue;
      this.sl[i] -= dt;
      if (this.sl[i] <= 0) { this.shards.setMatrixAt(i, HIDE); continue; }
      const k = this.sl[i] / this.sm[i];
      this.sv[i * 3 + 1] -= 25 * this.sg[i] * dt;
      const drag = Math.exp(-2.2 * dt);
      this.sv[i * 3] *= drag; this.sv[i * 3 + 1] *= drag; this.sv[i * 3 + 2] *= drag;
      this.sp[i * 3] += this.sv[i * 3] * dt; this.sp[i * 3 + 1] += this.sv[i * 3 + 1] * dt; this.sp[i * 3 + 2] += this.sv[i * 3 + 2] * dt;
      const sz = this.ss[i] * k;
      q.setFromAxisAngle(UP, i + this.sl[i] * 9);
      m4.compose(v.set(this.sp[i * 3], this.sp[i * 3 + 1], this.sp[i * 3 + 2]), q, s.set(sz, sz, sz));
      this.shards.setMatrixAt(i, m4);
      this.shards.setColorAt(i, c.setRGB(this.sc[i * 3] * k, this.sc[i * 3 + 1] * k, this.sc[i * 3 + 2] * k));
    }
    this.shards.instanceMatrix.needsUpdate = true;
    this.shards.instanceColor!.needsUpdate = true;
    // tracers: a box stretched from a to b that thins out
    for (let i = 0; i < this.T; i++) {
      if (this.tl[i] <= 0) continue;
      this.tl[i] -= dt;
      if (this.tl[i] <= 0) { this.tracers.setMatrixAt(i, HIDE); continue; }
      const k = this.tl[i] / this.tm[i];
      const ax = this.ta[i * 3], ay = this.ta[i * 3 + 1], az = this.ta[i * 3 + 2];
      d.set(this.tb[i * 3] - ax, this.tb[i * 3 + 1] - ay, this.tb[i * 3 + 2] - az);
      const len = d.length() || 1e-3;
      q.setFromUnitVectors(Z, d.divideScalar(len));
      const w = this.tw[i] * (0.3 + 0.7 * k);
      m4.compose(v.set(ax + d.x * len / 2, ay + d.y * len / 2, az + d.z * len / 2), q, s.set(w, w, len));
      this.tracers.setMatrixAt(i, m4);
      this.tracers.setColorAt(i, c.setRGB(this.tc[i * 3] * k, this.tc[i * 3 + 1] * k, this.tc[i * 3 + 2] * k));
    }
    this.tracers.instanceMatrix.needsUpdate = true;
    this.tracers.instanceColor!.needsUpdate = true;
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.life / r.max;
      const sz = r.size * (0.15 + 0.85 * (1 - (1 - k) * (1 - k)));
      r.mesh.scale.setScalar(sz);
      (r.mesh.material as THREE.Material).opacity = (1 - k) * (1 - k);
    }
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; }
  }

  clear(): void {
    this.sl.fill(0); this.tl.fill(0);
    for (let i = 0; i < this.N; i++) this.shards.setMatrixAt(i, HIDE);
    for (let i = 0; i < this.T; i++) this.tracers.setMatrixAt(i, HIDE);
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    this.shards.instanceMatrix.needsUpdate = true;
    this.tracers.instanceMatrix.needsUpdate = true;
  }
}
