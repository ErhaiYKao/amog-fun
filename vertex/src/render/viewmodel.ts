// First-person weapon models, built from primitives. They sway, bob and kick, but never move the aim.
import * as THREE from 'three/webgpu';
import { glow, metal, CYAN, ORANGE, WHITE } from './materials.ts';

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
};
const cyl = (r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), m);
  o.rotation.x = Math.PI / 2;
  o.position.set(x, y, z);
  return o;
};

export class ViewModel {
  root = new THREE.Group();
  private guns: THREE.Group[] = [];
  private shells: THREE.Mesh[] = [];
  private railCore!: THREE.Mesh;
  private muzzles: THREE.Vector3[] = [];
  private flash: THREE.Mesh;
  private flashT = 0;
  private kick = 0;        // recoil spring
  private kickV = 0;
  private swayX = 0;
  private swayY = 0;
  private bob = 0;
  private dip = 0;         // landing / switch dip
  private shown = 0;

  constructor() {
    const dark = metal(0x1b1f26, 0.45), steel = metal(0x4a525e, 0.35), white = metal(0x8a929c, 0.45);
    const cyan = glow(CYAN, 1.15), orange = glow(ORANGE, 1.5);

    // KS-2: twin barrels over a slab receiver
    const sg = new THREE.Group();
    sg.add(cyl(0.032, 0.62, steel, -0.036, 0.03, -0.42), cyl(0.032, 0.62, steel, 0.036, 0.03, -0.42));
    sg.add(box(0.13, 0.05, 0.5, dark, 0, -0.02, -0.36));
    sg.add(box(0.12, 0.13, 0.26, dark, 0, -0.01, -0.02));
    sg.add(box(0.07, 0.17, 0.09, dark, 0, -0.13, 0.05));
    for (const x of [-0.062, 0.062]) sg.add(box(0.006, 0.02, 0.5, cyan, x, 0.0, -0.3));
    sg.add(box(0.02, 0.02, 0.05, cyan, 0, 0.075, -0.7));
    sg.add(box(0.15, 0.06, 0.12, white, 0, -0.045, -0.28));
    for (const x of [-0.036, 0.036]) {
      const sh = box(0.03, 0.03, 0.07, orange.clone(), x, 0.085, 0.03);
      this.shells.push(sh); sg.add(sh);
    }
    this.muzzles.push(new THREE.Vector3(0, 0.03, -0.76));

    // PP-1: compact, with a lit muzzle ring
    const pp = new THREE.Group();
    pp.add(box(0.07, 0.1, 0.34, white, 0, 0.02, -0.2));
    pp.add(box(0.06, 0.05, 0.3, dark, 0, -0.04, -0.2));
    pp.add(box(0.065, 0.17, 0.09, dark, 0, -0.1, -0.02));
    pp.add(cyl(0.022, 0.1, steel, 0, 0.03, -0.4));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 8, 20), cyan);
    ring.position.set(0, 0.03, -0.39);
    pp.add(ring);
    for (const x of [-0.037, 0.037]) pp.add(box(0.004, 0.016, 0.26, cyan, x, 0.03, -0.2));
    this.muzzles.push(new THREE.Vector3(0, 0.03, -0.47));

    // RR-9: two long rails around a core that glows as it recharges
    const rr = new THREE.Group();
    rr.add(box(0.03, 0.06, 0.95, steel, -0.045, 0.03, -0.5), box(0.03, 0.06, 0.95, steel, 0.045, 0.03, -0.5));
    this.railCore = box(0.03, 0.022, 0.9, glow(WHITE, 1.6), 0, 0.03, -0.5);
    rr.add(this.railCore);
    rr.add(box(0.14, 0.15, 0.36, dark, 0, -0.01, 0.0));
    rr.add(box(0.07, 0.17, 0.09, dark, 0, -0.14, 0.08));
    rr.add(box(0.15, 0.04, 0.2, white, 0, 0.085, -0.02));
    for (const z of [-0.2, -0.5, -0.8]) rr.add(box(0.14, 0.085, 0.03, dark, 0, 0.03, z));
    rr.add(box(0.142, 0.012, 0.3, orange, 0, -0.09, 0.0));
    this.muzzles.push(new THREE.Vector3(0, 0.03, -1.0));

    this.guns = [sg, pp, rr];
    for (const g of this.guns) { g.visible = false; this.root.add(g); }
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), glow(WHITE, 6, { additive: true }));
    this.flash.visible = false;
    this.root.add(this.flash);
    // drawn tiny and very close to the eye so it never pokes through a wall you are hugging
    this.root.scale.setScalar(0.16);
  }

  fired(weapon: number): void {
    this.kickV += [9, 3.5, 12][weapon];
    this.flashT = 0.05;
    this.flash.position.copy(this.muzzles[weapon]);
    this.flash.scale.setScalar([1.6, 0.8, 1.3][weapon]);
    this.flash.rotation.z = Math.random() * 6;
  }

  landed(speed: number): void { this.dip = Math.min(0.09, speed * 0.004); }

  /** World-space position of the muzzle (for tracers). */
  muzzleWorld(weapon: number, out: THREE.Vector3): THREE.Vector3 {
    return this.guns[weapon].localToWorld(out.copy(this.muzzles[weapon]));
  }

  update(dt: number, s: { weapon: number; shells: number; cool: number; cycle: number; speed: number; grounded: boolean; dx: number; dy: number; vy: number; sliding: boolean }): void {
    if (this.shown !== s.weapon || !this.guns[s.weapon].visible) {
      this.guns.forEach((g, i) => (g.visible = i === s.weapon));
      this.shown = s.weapon;
      this.dip = 0.12;
    }
    // recoil spring (critically damped-ish)
    this.kickV += (-140 * this.kick - 16 * this.kickV) * dt;
    this.kick += this.kickV * dt;
    // sway follows the mouse, bob follows the feet
    const k = 1 - Math.exp(-12 * dt);
    this.swayX += (Math.max(-1, Math.min(1, -s.dx * 0.004)) - this.swayX) * k;
    this.swayY += (Math.max(-1, Math.min(1, s.dy * 0.004)) - this.swayY) * k;
    if (s.grounded && !s.sliding) this.bob += dt * Math.min(s.speed, 12) * 1.25;
    const bobAmp = s.grounded && !s.sliding ? Math.min(s.speed / 11, 1) * 0.012 : 0;
    this.dip += (0 - this.dip) * (1 - Math.exp(-9 * dt));
    const air = Math.max(-0.05, Math.min(0.05, -s.vy * 0.0025));
    const g = this.guns[s.weapon];
    g.position.set(
      0.36 + this.swayX * 0.03 + Math.cos(this.bob) * bobAmp,
      -0.34 - this.dip + this.swayY * 0.03 + Math.abs(Math.sin(this.bob)) * bobAmp + air + (s.sliding ? -0.04 : 0),
      -0.62 + this.kick * 0.012,
    );
    g.rotation.set(this.kick * 0.03 + this.swayY * 0.05, this.swayX * 0.08 + 0.02, this.swayX * 0.1 + (s.sliding ? 0.25 : 0));
    this.shells.forEach((sh, i) => (sh.visible = i < s.shells));
    if (s.weapon === 2) {
      const ready = 1 - Math.max(0, s.cool) / s.cycle;
      this.railCore.scale.set(1, 1, Math.max(0.02, ready));
      this.railCore.position.z = -0.05 - 0.45 * ready;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      g.add(this.flash);
    } else this.flash.visible = false;
  }
}
