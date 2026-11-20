// The renderer: builds the tower from the level, mirrors simulation state every frame, draws effects.
// It only ever reads the Game; nothing in here feeds back into the simulation.
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Game } from '../sim/game.ts';
import type { Ev } from '../sim/player.ts';
import { eyeOf, hspeed } from '../sim/player.ts';
import type { Box } from '../sim/world.ts';
import type { Enemy } from '../sim/enemies.ts';
import { ENEMY } from '../sim/enemies.ts';
import type { Target } from '../sim/weapons.ts';
import { TOP_Y, STAGE_Y } from '../sim/tower.ts';
import { T, WEAPONS } from '../sim/tuning.ts';
import type { V3 } from '../sim/math.ts';
import { lookDir, mulberry32 } from '../sim/math.ts';
import { boxesGeometry } from './geometry.ts';
import { boxMaterial, cityMaterial, glow, metal, skyMaterial, CYAN, ORANGE, WHITE, RED } from './materials.ts';
import { Fx } from './fx.ts';
import { ViewModel } from './viewmodel.ts';
import type { Quality, Save } from '../settings.ts';

const Zaxis = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tm = new THREE.Matrix4(), ts = new THREE.Vector3();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

/** Stretch a unit box (along z) between two points. */
function span(mesh: THREE.Object3D, a: V3, b: V3, width: number): void {
  tmp.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = tmp.length() || 1e-3;
  mesh.quaternion.setFromUnitVectors(Zaxis, tmp.divideScalar(len));
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.scale.set(width, width, len);
}

interface EnemyView { e: Enemy; root: THREE.Group; parts: Record<string, THREE.Object3D>; scale: number; tethers: { mesh: THREE.Mesh; box: Box }[] }
interface TargetView { t: Target; root: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; pulse: number }

export class View {
  renderer: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(100, 1, 0.04, 1600);
  fx = new Fx();
  gun = new ViewModel();
  backend = 'WebGPU';
  private pipeline: THREE.RenderPipeline | null = null;
  private quality: Quality = 'medium';
  private save: Save;
  private sun = new THREE.DirectionalLight(0xdfeeff, 2.4);
  private sky: THREE.Mesh;
  private dyn: { box: Box; mesh: THREE.Mesh; cx: number; cy: number; cz: number }[] = [];
  private enemies: EnemyView[] = [];
  private targets: TargetView[] = [];
  private shots: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private lasers = new Map<Enemy, THREE.Mesh>();
  private streaks: THREE.InstancedMesh;
  private streakSeed: Float32Array;
  private landing: THREE.Mesh;
  private pull: THREE.Mesh;
  private game: Game | null = null;
  // camera feel
  private eyeY = 0;
  private dip = 0;
  private dipV = 0;
  private fovKick = 0;
  private roll = 0;
  private shake = 0;
  private time = 0;
  orbit = 0;      // menu camera angle

  constructor(canvas: HTMLCanvasElement, save: Save) {
    this.save = save;
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', forceWebGL });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.fog = new THREE.FogExp2(0x0b1a26, 0.0048);
    this.scene.add(this.camera);
    this.camera.add(this.gun.root);

    // light: a cold sun from above, and the furnace glow of the void from below
    this.scene.add(new THREE.HemisphereLight(0x8fb4d8, 0xb3541e, 1.25));
    this.sun.position.set(-70, 110, 80);
    this.scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), skyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.scene.add(this.fx.group);

    // speed streaks: thin slivers of light that rush past the camera when you are fast
    const SN = 90;
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), glow(0xbfefff, 1.4, { additive: true, opacity: 0.5 }), SN);
    this.streaks.frustumCulled = false;
    this.streakSeed = new Float32Array(SN * 3);
    for (let i = 0; i < SN * 3; i++) this.streakSeed[i] = Math.random();
    for (let i = 0; i < SN; i++) this.streaks.setMatrixAt(i, HIDE);
    this.scene.add(this.streaks);

    this.landing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 32), glow(CYAN, 2, { additive: true, opacity: 0.8 }));
    this.landing.rotation.x = -Math.PI / 2;
    this.landing.visible = false;
    this.scene.add(this.landing);
    this.pull = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glow(CYAN, 3, { additive: true }));
    this.pull.visible = false;
    this.scene.add(this.pull);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.backend = (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    this.setQuality(this.save.quality);
    this.resize();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    const shadows = q === 'high';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      const s = this.sun.shadow;
      s.mapSize.set(2048, 2048);
      s.camera.left = s.camera.bottom = -46; s.camera.right = s.camera.top = 46;
      s.camera.near = 1; s.camera.far = 320;
      s.bias = -0.0006; s.normalBias = 0.06;
      s.camera.updateProjectionMatrix();
    }
    if (q === 'low') this.pipeline = null;
    else {
      const { pass } = TSL as unknown as { pass: (s: THREE.Scene, c: THREE.Camera) => { getTextureNode: (n: string) => unknown } };
      const scenePass = pass(this.scene, this.camera);
      const colour = scenePass.getTextureNode('output') as { add: (n: unknown) => unknown };
      const pipeline = new THREE.RenderPipeline(this.renderer);
      (pipeline as unknown as { outputNode: unknown }).outputNode = colour.add((bloom as unknown as (n: unknown, s: number, r: number, t: number) => unknown)(colour, q === 'high' ? 0.5 : 0.42, 0.55, 0.92));
      this.pipeline = pipeline;
    }
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------------------------
  /** Build (or rebuild) everything that depends on the Game instance. */
  attach(game: Game): void {
    if (this.game === game) return;
    const first = this.game === null;
    this.game = game;
    if (first) this.buildWorld(game);
    // entity views hold references into the Game, so they are rebuilt with it
    for (const v of this.enemies) this.scene.remove(v.root);
    for (const v of this.targets) this.scene.remove(v.root);
    for (const l of this.lasers.values()) this.scene.remove(l);
    this.enemies = []; this.targets = []; this.lasers.clear();
    this.rebind(game);
    this.snap();
  }

  /** Enemies and targets are recreated by the sim on every respawn; point the views at the new objects. */
  rebind(game: Game): void {
    if (this.enemies.length !== game.enemies.length) {
      game.enemies.forEach((e) => this.enemies.push(this.makeEnemy(e, game)));
      game.targets.forEach((t) => this.targets.push(this.makeTarget(t)));
    } else {
      game.enemies.forEach((e, i) => {
        const v = this.enemies[i];
        const laser = this.lasers.get(v.e);
        if (laser) { this.lasers.delete(v.e); this.lasers.set(e, laser); }
        v.e = e;
      });
      game.targets.forEach((t, i) => (this.targets[i].t = t));
    }
    game.world.dynamic.forEach((b, i) => { if (this.dyn[i]) this.dyn[i].box = b; });
  }

  private buildWorld(game: Game): void {
    const world = game.world;
    const dynamicSet = new Set(world.dynamic);
    // static boxes: one merged mesh per look
    const byLook = new Map<string, Box[]>();
    for (const b of world.boxes) {
      if (dynamicSet.has(b)) continue;
      const list = byLook.get(b.def.look) ?? [];
      list.push(b); byLook.set(b.def.look, list);
    }
    for (const [look, list] of byLook) {
      const mesh = new THREE.Mesh(boxesGeometry(list.map((b) => b.def)), boxMaterial(look as Box['def']['look'], false));
      const lit = !(mesh.material as THREE.Material).transparent;
      mesh.castShadow = lit; mesh.receiveShadow = lit;
      if (!lit) mesh.renderOrder = 2;
      this.scene.add(mesh);
    }
    // dynamic boxes: one mesh each, built around its own centre
    const mats = new Map<string, THREE.Material>();
    for (const b of world.dynamic) {
      const d = b.def;
      const c = { x: (d.min.x + d.max.x) / 2, y: (d.min.y + d.max.y) / 2, z: (d.min.z + d.max.z) / 2 };
      let mat = mats.get(d.look);
      if (!mat) { mat = boxMaterial(d.look, true); mats.set(d.look, mat); }
      const mesh = new THREE.Mesh(boxesGeometry([d], c), mat);
      mesh.userData.fade = 1;
      const lit = !mat.transparent;
      mesh.castShadow = lit; mesh.receiveShadow = lit;
      if (!lit) mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.dyn.push({ box: b, mesh, cx: c.x - d.min.x, cy: c.y - d.min.y, cz: c.z - d.min.z });
    }
    this.buildBackdrop();
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(ENEMY.sentinel.shotRadius, 1), glow(ORANGE, 3.2));
      m.visible = false;
      this.scene.add(m);
      this.shots.push(m);
    }
  }

  private buildBackdrop(): void {
    const rnd = mulberry32(1234);
    // far towers in rings around the void
    const N = 80;
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMaterial(), N);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = 170 + rnd() * 520;
      const w = 14 + rnd() * 46, h = 160 + rnd() * 620, d = 14 + rnd() * 46;
      tm.compose(tmp.set(Math.cos(a) * r, -260 + h / 2 + rnd() * 120, Math.sin(a) * r), tq.identity(), ts.set(w, h, d));
      city.setMatrixAt(i, tm);
    }
    city.frustumCulled = false;
    this.scene.add(city);
    // great rings turning slowly around the tower
    for (const [y, r, tilt] of [[18, 62, 0.06], [70, 78, -0.1], [118, 58, 0.14]] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.7, 6, 96), metal(0x232a33, 0.5, CYAN, 0.25));
      ring.position.y = y; ring.rotation.x = Math.PI / 2 + tilt;
      ring.userData.spin = (rnd() - 0.5) * 0.08;
      const lights = new THREE.Group();
      for (let i = 0; i < 12; i++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.5), glow(i % 4 === 0 ? ORANGE : CYAN, 3));
        const a = (i / 12) * Math.PI * 2;
        l.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
        l.rotation.z = a + Math.PI / 2;
        lights.add(l);
      }
      ring.add(lights);
      this.rings.push(ring);
      this.scene.add(ring);
    }
    // stage numerals on the core's south face, and a beacon on the summit
    const font = () => {
      STAGE_Y.forEach((y, i) => {
        const cv = document.createElement('canvas');
        cv.width = 512; cv.height = 512;
        const g = cv.getContext('2d')!;
        g.fillStyle = '#fff';
        g.font = '400 300px "JetBrains Mono", ui-monospace, monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i + 1).padStart(2, '0'), 256, 250);
        g.fillRect(96, 440, 320, 10);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, depthWrite: false });
        m.color = new THREE.Color(CYAN).multiplyScalar(1.4);
        m.blending = THREE.AdditiveBlending;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), m);
        plane.position.set(0, y + 8, T.radius * 0 + 7.06);
        this.scene.add(plane);
        const west = plane.clone();
        west.position.set(-7.06, y + 8, 0); west.rotation.y = -Math.PI / 2;
        this.scene.add(west);
      });
    };
    if (document.fonts?.ready) void document.fonts.ready.then(font); else font();
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 600, 8, 1, true), glow(ORANGE, 2.2, { additive: true, opacity: 0.35 }));
    beacon.position.set(0, TOP_Y + 299, 0);
    this.scene.add(beacon);
  }

  private makeEnemy(e: Enemy, game: Game): EnemyView {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};
    const tethers: EnemyView['tethers'] = [];
    if (e.def.kind === 'sentinel') {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.62), metal(0x2b323c, 0.3));
      const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), glow(ORANGE, 3));
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.035, 6, 40), glow(CYAN, 2.2));
      const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.03, 6, 40), glow(WHITE, 1.6));
      r2.rotation.x = Math.PI / 2;
      root.add(core, eye, r1, r2);
      Object.assign(parts, { core, eye, r1, r2 });
    } else if (e.def.kind === 'warden') {
      const body = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05), metal(0x20262e, 0.35));
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.06, 6, 48), glow(ORANGE, 2.4));
      band.rotation.x = Math.PI / 2;
      const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), glow(RED, 3.5));
      const weak = new THREE.Mesh(new THREE.IcosahedronGeometry(ENEMY.warden.weakRadius, 0), glow(WHITE, 3.5));
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 32), glow(CYAN, 2.5));
      if (e.def.weak) { weak.position.set(e.def.weak.x, e.def.weak.y, e.def.weak.z); halo.position.copy(weak.position); }
      root.add(body, band, eye, weak, halo);
      Object.assign(parts, { body, band, eye, weak, halo });
      const laser = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glow(RED, 3, { additive: true }));
      laser.visible = false;
      this.scene.add(laser);
      this.lasers.set(e, laser);
    } else {
      const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.9, 0)), new THREE.LineBasicNodeMaterial({ color: new THREE.Color(CYAN).multiplyScalar(2) }));
      const heart = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), glow(WHITE, 3));
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.86, 0), glow(CYAN, 0.6, { transparent: true, opacity: 0.18 }));
      root.add(cage, heart, shell);
      Object.assign(parts, { cage, heart });
      // tethers to everything it holds in place
      for (const b of game.world.dynamic) {
        if (b.def.when?.signal !== e.def.signal) continue;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glow(b.def.when?.on ? WHITE : ORANGE, 1.6, { additive: true, opacity: 0.6 }));
        this.scene.add(mesh);
        tethers.push({ mesh, box: b });
      }
    }
    this.scene.add(root);
    return { e, root, parts, scale: 1, tethers };
  }

  private makeTarget(t: Target): TargetView {
    const root = new THREE.Group();
    const d = t.def;
    let core: THREE.Mesh, ring: THREE.Mesh;
    if (d.kind === 'anchor') {
      core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), glow(WHITE, 3));
      ring = new THREE.Mesh(new THREE.TorusGeometry(d.radius, 0.07, 8, 36), glow(CYAN, 2.6));
    } else if (d.kind === 'switch') {
      core = new THREE.Mesh(d.railOnly ? new THREE.BoxGeometry(0.5, 0.5, 0.5) : new THREE.OctahedronGeometry(d.radius * 0.85), glow(d.railOnly ? WHITE : CYAN, 3));
      if (d.railOnly) core.rotation.set(0.6, 0.78, 0);
      ring = new THREE.Mesh(new THREE.TorusGeometry(d.radius * 1.25, 0.03, 6, 32), glow(d.railOnly ? WHITE : CYAN, 2));
    } else {
      core = new THREE.Mesh(new THREE.CircleGeometry(d.radius * 0.45, 24), glow(ORANGE, 3));
      (core.material as THREE.Material).side = THREE.DoubleSide;
      ring = new THREE.Mesh(new THREE.RingGeometry(d.radius * 0.72, d.radius, 32), glow(ORANGE, 2.6));
      (ring.material as THREE.Material).side = THREE.DoubleSide;
    }
    root.add(core, ring);
    this.scene.add(root);
    return { t, root, core, ring, pulse: 0 };
  }

  // ---------------------------------------------------------------------------------------------
  /** React to a simulation event with effects. */
  handle(ev: Ev, game: Game): void {
    const p = game.player;
    switch (ev.type) {
      case 'shot': {
        this.gun.fired(ev.weapon);
        const muzzle = this.gun.muzzleWorld(ev.weapon, tmp2);
        const from = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
        const hex = ev.weapon === 0 ? 0xffc27a : ev.weapon === 1 ? CYAN : WHITE;
        ev.segs.forEach((s, i) => this.fx.tracer(i === 0 ? from : s.a, s.b, hex, ev.weapon === 2 ? 0.09 : ev.weapon === 1 ? 0.03 : 0.018, ev.weapon === 2 ? 0.45 : 0.1, ev.weapon === 2 ? 5 : 3));
        this.fx.flash(from, hex, ev.weapon === 0 ? 90 : 40);
        if (ev.weapon === 0) {
          // the recoil shockwave, perpendicular to the barrel
          const d = lookDir(p.yaw, p.pitch);
          this.fx.ring({ x: from.x + d.x * 1.6, y: from.y + d.y * 1.6, z: from.z + d.z * 1.6 }, d, 0xffd9a8, 0.9, 0.14);
          this.fx.burst(from, 0xffb060, 14, 16, { dir: d, spread: 0.35, life: 0.22, size: 0.035, gravity: 0 });
          this.shake = Math.max(this.shake, 0.5);
        } else if (ev.weapon === 2) this.shake = Math.max(this.shake, 0.7);
        break;
      }
      case 'impact': {
        const hex = ev.kind === 'wall' ? 0xffd9a8 : ev.kind === 'weak' ? WHITE : ev.kind === 'mirror' ? 0x9fd8ff : ev.kind === 'target' ? CYAN : ORANGE;
        this.fx.burst(ev.pos, hex, ev.kind === 'wall' ? 4 : 9, ev.kind === 'wall' ? 5 : 9, { dir: ev.n, spread: 0.7, life: 0.3, size: 0.05 });
        if (ev.kind === 'mirror') this.fx.ring(ev.pos, ev.n, 0x9fd8ff, 1.2, 0.25);
        break;
      }
      case 'kill':
        this.fx.burst(ev.pos, ev.kind === 'conductor' ? CYAN : ORANGE, 46, 15, { life: 0.8, size: 0.12, gravity: 0.5 });
        this.fx.burst(ev.pos, WHITE, 18, 22, { life: 0.35, size: 0.06, gravity: 0 });
        this.fx.ring(ev.pos, { x: 0, y: 1, z: 0 }, ev.airborne ? CYAN : ORANGE, 5, 0.45);
        this.fx.flash(ev.pos, ORANGE, 120);
        break;
      case 'charge':
        if (ev.delta > 0) this.fx.burst(eyeOf(p), CYAN, 16, 6, { life: 0.5, size: 0.04, gravity: -0.3 });
        break;
      case 'dash': {
        const d = p.dashDir;
        this.fx.ring(p.pos, d, CYAN, 3.2, 0.3);
        this.fx.ring({ x: p.pos.x + d.x * 1.5, y: p.pos.y + d.y * 1.5, z: p.pos.z + d.z * 1.5 }, d, WHITE, 2, 0.24);
        this.fx.burst(p.pos, CYAN, 26, 9, { dir: { x: -d.x, y: -d.y, z: -d.z }, spread: 0.5, life: 0.45, size: 0.06, gravity: 0 });
        this.fovKick = 14;
        break;
      }
      case 'jump': this.dipV -= 0.4; break;
      case 'walljump':
        this.fx.ring({ x: p.pos.x - (p.lastWall?.x ?? 0) * 0.4, y: p.pos.y - 0.5, z: p.pos.z - (p.lastWall?.z ?? 0) * 0.4 }, p.lastWall ?? { x: 0, y: 1, z: 0 }, WHITE, 1.4, 0.22);
        this.roll += (p.lastWall ? (p.lastWall.x * Math.cos(p.yaw) - p.lastWall.z * Math.sin(p.yaw)) : 0) * 0.05;
        break;
      case 'land': {
        const s = Math.min(ev.speed, 30);
        this.dipV -= s * 0.09;
        this.gun.landed(s);
        if (s > 9) this.fx.ring({ x: p.pos.x, y: p.pos.y - p.half.y + 0.05, z: p.pos.z }, { x: 0, y: 1, z: 0 }, 0xbfd8e8, 1 + s * 0.08, 0.25);
        break;
      }
      case 'hurt': this.shake = Math.max(this.shake, 1); break;
      case 'enemyShot': this.fx.ring(ev.pos, { x: 0, y: 1, z: 0 }, ORANGE, 1.6, 0.2); break;
      case 'boom': this.fx.burst(ev.pos, ORANGE, 12, 7, { life: 0.3, size: 0.07 }); break;
      case 'beam':
        this.fx.tracer(ev.a, ev.b, RED, 0.5, 0.3, 6);
        this.fx.tracer(ev.a, ev.b, WHITE, 0.16, 0.4, 6);
        this.fx.burst(ev.b, RED, 26, 12, { life: 0.5, size: 0.1 });
        break;
      case 'switch':
        this.fx.ring(ev.pos, lookDir(p.yaw, p.pitch), CYAN, 3, 0.4);
        this.fx.burst(ev.pos, CYAN, 22, 9, { life: 0.5, size: 0.07, gravity: 0 });
        break;
      case 'anchor': this.fx.ring(ev.pos, lookDir(p.yaw, p.pitch), CYAN, 2.4, 0.35); break;
      case 'target':
        if (ev.ok) this.fx.burst(ev.pos, ev.done ? WHITE : ORANGE, ev.done ? 24 : 10, 8, { life: 0.4, size: 0.06, gravity: 0 });
        break;
      case 'rebuild': this.fx.ring(ev.pos, { x: 0, y: 1, z: 0 }, ORANGE, 2.5, 0.5); break;
      case 'checkpoint': case 'stage': {
        const f = { x: p.pos.x, y: p.pos.y - p.half.y + 0.1, z: p.pos.z };
        this.fx.ring(f, { x: 0, y: 1, z: 0 }, CYAN, 6, 0.6);
        this.fx.burst(f, CYAN, 24, 7, { dir: { x: 0, y: 1, z: 0 }, spread: 0.9, life: 0.7, size: 0.03, gravity: -0.2 });
        break;
      }
      case 'finish': {
        for (let i = 0; i < 5; i++) this.fx.ring({ x: 0, y: TOP_Y - 0.8 + i * 0.6, z: 0 }, { x: 0, y: 1, z: 0 }, i % 2 ? CYAN : ORANGE, 6 + i * 3, 0.8 + i * 0.15);
        this.fx.burst({ x: 0, y: TOP_Y, z: 0 }, WHITE, 120, 20, { dir: { x: 0, y: 1, z: 0 }, spread: 0.6, life: 1.6, size: 0.1, gravity: 0.3 });
        break;
      }
      case 'respawn': this.snap(); break;
      default: break;
    }
  }

  /** Forget smoothing state (after a teleport). */
  snap(): void {
    this.dip = this.dipV = 0; this.roll = 0; this.shake = 0; this.fovKick = 0;
    if (this.game) this.eyeY = this.game.player.half.y - T.eyeDrop;
  }

  // ---------------------------------------------------------------------------------------------
  /** Mirror the simulation. alpha = how far we are between the last two ticks. */
  sync(game: Game, alpha: number, dt: number, mouse: { dx: number; dy: number; yaw: number; pitch: number }, playing: boolean): void {
    this.time += dt;
    const p = game.player, w = game.world;
    // world
    for (const d of this.dyn) {
      const b = d.box;
      d.mesh.visible = b.fade > 0.001;
      d.mesh.position.set(b.min.x + d.cx, b.min.y + d.cy, b.min.z + d.cz);
      d.mesh.userData.fade = b.fade;
    }
    for (const r of this.rings) r.rotation.z += r.userData.spin * dt;

    // camera
    const px = game.prev.x + (p.pos.x - game.prev.x) * alpha, py = game.prev.y + (p.pos.y - game.prev.y) * alpha, pz = game.prev.z + (p.pos.z - game.prev.z) * alpha;
    const sp = hspeed(p);
    if (playing) {
      const eyeTarget = p.half.y - T.eyeDrop;
      this.eyeY += (eyeTarget - this.eyeY) * (1 - Math.exp(-22 * dt));
      this.dipV += (-180 * this.dip - 22 * this.dipV) * dt;
      this.dip += this.dipV * dt;
      this.fovKick *= Math.exp(-6 * dt);
      this.shake *= Math.exp(-9 * dt);
      this.roll *= Math.exp(-8 * dt);
      const total = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      const fov = this.save.fov + Math.min(16, Math.max(0, total - 11) * 0.75) + this.fovKick;
      if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-10 * dt)); this.camera.updateProjectionMatrix(); }
      // the aim itself is never smoothed or shaken: only position and roll take the hits
      const sh = this.shake * 0.03;
      this.camera.position.set(px + (Math.random() - 0.5) * sh, py + this.eyeY + Math.max(-0.35, this.dip * 0.06) + (Math.random() - 0.5) * sh, pz + (Math.random() - 0.5) * sh);
      const strafe = (p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw)) / 14;
      // look angles come straight from the mouse, not from the last tick, so aiming has no added latency
      this.camera.rotation.set(mouse.pitch, mouse.yaw, this.roll - Math.max(-1, Math.min(1, strafe)) * 0.025, 'YXZ');
      this.gun.root.visible = true;
      this.gun.update(dt, { weapon: p.weapon, shells: p.shells, cool: p.cool[p.weapon], cycle: WEAPONS[p.weapon].cycle, speed: sp, grounded: p.grounded, dx: mouse.dx, dy: mouse.dy, vy: p.vel.y, sliding: p.sliding });
    } else {
      // menu: a slow orbit around the tower, looking up it
      this.orbit += dt * 0.05;
      const r = 104, y = 30 + Math.sin(this.orbit * 0.7) * 16;
      this.camera.position.set(Math.cos(this.orbit + 0.6) * r, y, Math.sin(this.orbit + 0.6) * r);
      this.camera.lookAt(0, y + 34, 0);
      if (this.camera.fov !== 62) { this.camera.fov = 62; this.camera.updateProjectionMatrix(); }
      this.gun.root.visible = false;
    }
    this.sky.position.copy(this.camera.position);
    // low enough in the south-west that the decks, stacked on that corner, do not shade one another
    this.sun.position.set(this.camera.position.x - 70, this.camera.position.y + 110, this.camera.position.z + 80);
    this.sun.target.position.copy(this.camera.position);

    // enemies
    for (const v of this.enemies) {
      const e = v.e;
      const target = e.alive ? 1 : 0;
      v.scale += (target - v.scale) * (1 - Math.exp(-(e.alive ? 6 : 30) * dt));
      v.root.visible = v.scale > 0.02;
      v.root.position.set(e.pos.x, e.pos.y, e.pos.z);
      const punch = e.flash < 0.12 ? 1 + (0.12 - e.flash) * 2.5 : 1;
      v.root.scale.setScalar(v.scale * punch);
      if (e.def.kind === 'sentinel') {
        const s = ENEMY.sentinel;
        const warn = e.alive && e.t > s.cycle - s.warn ? (e.t - (s.cycle - s.warn)) / s.warn : 0;
        v.parts.r1.rotation.set(this.time * 1.7, this.time * 0.9, 0);
        v.parts.r2.rotation.set(Math.PI / 2 + this.time * 1.1, 0, this.time * 1.4);
        v.parts.core.rotation.y = this.time * 0.6;
        // the eye looks at you and swells before it fires
        tmp.set(px - e.pos.x, py - e.pos.y, pz - e.pos.z).normalize().multiplyScalar(0.42);
        v.parts.eye.position.copy(tmp);
        v.parts.eye.scale.setScalar(1 + warn * 1.6 + (e.stagger > 0 ? -0.5 : 0));
      } else if (e.def.kind === 'warden') {
        v.parts.band.rotation.z = this.time * (e.state === 'lock' ? 9 : e.state === 'track' ? 3 : 0.6);
        v.parts.halo.rotation.set(this.time * 2, this.time * 1.3, 0);
        v.parts.weak.rotation.y = this.time * 2;
        v.parts.eye.position.set(e.aim.x * 0.95, e.aim.y * 0.95, e.aim.z * 0.95);
        const laser = this.lasers.get(e);
        if (laser) {
          const on = e.alive && (e.state === 'track' || e.state === 'lock');
          laser.visible = on;
          if (on) {
            const lock = e.state === 'lock';
            span(laser, e.pos, e.beamEnd, lock ? 0.1 + 0.05 * Math.sin(this.time * 60) : 0.025);
            (laser.material as THREE.Material).opacity = lock ? 1 : 0.55;
          }
        }
      } else {
        v.parts.cage.rotation.set(this.time * 0.5, this.time * 0.8, 0);
        v.parts.heart.rotation.set(this.time * 1.3, this.time * 1.1, this.time * 0.7);
        for (const t of v.tethers) {
          t.mesh.visible = e.alive && t.box.fade > 0.05;
          if (t.mesh.visible) span(t.mesh, e.pos, { x: (t.box.min.x + t.box.max.x) / 2, y: Math.min(t.box.max.y, Math.max(t.box.min.y, e.pos.y)), z: (t.box.min.z + t.box.max.z) / 2 }, 0.03 + 0.015 * Math.sin(this.time * 8));
        }
      }
    }
    // targets
    for (const v of this.targets) {
      const t = v.t, d = t.def;
      v.root.position.set(t.pos.x, t.pos.y, t.pos.z);
      const ready = t.cool <= 0;
      if (d.kind === 'anchor') {
        v.ring.rotation.set(this.time * 1.2, this.time * 0.8, 0);
        v.root.scale.setScalar(ready ? 1 + 0.06 * Math.sin(this.time * 5) : 0.55);
      } else if (d.kind === 'switch') {
        const on = w.signal(d.signal!);
        v.core.rotation.y = this.time * (on ? 6 : 1.5);
        v.ring.lookAt(this.camera.position);
        v.root.scale.setScalar(on ? 0.6 : 1 + 0.08 * Math.sin(this.time * 4));
        const left = w.signalTime(d.signal!);
        v.ring.scale.setScalar(on && d.seconds ? 0.4 + 1.6 * (left / d.seconds) : 1);
      } else {
        v.root.lookAt(this.camera.position);
        v.root.visible = ready;
        const lit = t.lit > 0;
        v.core.scale.setScalar(lit ? 1.9 : 1);
        v.ring.scale.setScalar(lit ? 0.7 + 0.5 * (t.lit / (d.window ?? 2.6)) : 1 + 0.07 * Math.sin(this.time * 6));
      }
    }
    // enemy shots
    this.shots.forEach((m, i) => {
      const s = game.shots[i];
      m.visible = !!s;
      if (s) {
        m.position.set(s.pos.x, s.pos.y, s.pos.z);
        m.rotation.set(this.time * 5, this.time * 3, 0);
        if (Math.random() < dt * 40) this.fx.burst(s.pos, ORANGE, 1, 1.5, { life: 0.3, size: 0.06, gravity: 0 });
      }
    });

    // where you would land
    const hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null as Box | null };
    const feet = py - p.half.y;
    const down = playing && !p.grounded ? w.ray({ x: px, y: feet, z: pz }, { x: 0, y: -1, z: 0 }, 60, hit) : Infinity;
    this.landing.visible = down !== Infinity && down > 0.4;
    if (this.landing.visible) {
      this.landing.position.set(px, feet - down + 0.04, pz);
      this.landing.scale.setScalar(1 + Math.min(down, 20) * 0.04);
    }
    // anchor tether
    this.pull.visible = playing && !!p.pull;
    if (p.pull) span(this.pull, { x: px, y: py - 0.2, z: pz }, p.pull.to, 0.04);

    // speed streaks along the velocity
    const total = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    const k = playing ? Math.min(1, Math.max(0, (total - 13) / 16)) : 0;
    (this.streaks.material as THREE.Material).opacity = k * 0.55;
    this.streaks.visible = k > 0.01;
    if (this.streaks.visible) {
      tmp.set(p.vel.x, p.vel.y, p.vel.z).divideScalar(total);
      tq.setFromUnitVectors(Zaxis, tmp);
      const n = this.streaks.count, len = 2 + k * 7;
      for (let i = 0; i < n; i++) {
        const a = this.streakSeed[i * 3] * Math.PI * 2, r = 1.6 + this.streakSeed[i * 3 + 1] * 5;
        const z = ((this.streakSeed[i * 3 + 2] * 40 - this.time * total * 1.2) % 40 + 40) % 40 - 12;
        tmp2.set(Math.cos(a) * r, Math.sin(a) * r, z).applyQuaternion(tq).add(this.camera.position);
        tm.compose(tmp2, tq, ts.set(0.012, 0.012, len));
        this.streaks.setMatrixAt(i, tm);
      }
      this.streaks.instanceMatrix.needsUpdate = true;
    }
    this.fx.update(dt);
  }

  render(): void {
    if (innerWidth < 2 || innerHeight < 2) return;      // hidden or collapsed window: nothing to draw into
    if (this.pipeline && this.quality !== 'low') this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
