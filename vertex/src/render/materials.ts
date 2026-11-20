// TSL materials. Everything is procedural: panel seams, stains, edge trims, energy fields, the sky.
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
// The TSL typings are stricter than the node API really is (userData nodes, mixed float/vec3 maths), so the
// shader graphs in this file are deliberately untyped.
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  attribute, positionWorld, positionLocal, normalWorld, vec3, float, mix, smoothstep, fract, floor, abs, min,
  time, sin, mx_noise_float, color, step, userData, normalize, hash,
} = TSL as any;
import type { Look } from '../sim/world.ts';

export const CYAN = 0x4fd6e8, ORANGE = 0xff8a3c, WHITE = 0xf4f6f8, RED = 0xff3b2f;

type N = any;

const fuv = attribute('fuv', 'vec2');
const fsize = attribute('fsize', 'vec2');
const tint = attribute('tint', 'float');
/** Metres to the nearest edge of the face being shaded. */
const edge = min(min(fuv.x, fuv.y), min(fsize.x.sub(fuv.x), fsize.y.sub(fuv.y)));
const an = abs(normalWorld);
/** World-aligned coordinates in the plane of the face, so panels line up across neighbouring boxes. */
const pu = mix(positionWorld.x, positionWorld.z, step(0.5, an.x));
const pv = mix(positionWorld.y, positionWorld.z, step(0.5, an.y));
const top = smoothstep(0.5, 0.9, normalWorld.y);
const side = float(1).sub(step(0.5, an.y));

/** 0 on a panel seam, 1 away from it. */
const seams = (size: number, width = 0.03): N => {
  const du = abs(fract(pu.div(size)).sub(0.5)).oneMinus().sub(0.5).mul(size);   // metres to the nearest grid line
  const dv = abs(fract(pv.div(size)).sub(0.5)).oneMinus().sub(0.5).mul(size);
  return smoothstep(0, width, min(du, dv));
};

const concrete = (base: number, seamSize: number): N => {
  const blotch = mx_noise_float(positionWorld.mul(0.3)).mul(0.1);
  const grain = mx_noise_float(positionWorld.mul(4.5)).mul(0.035);
  // rain streaks down the vertical faces
  const streak = mx_noise_float(vec3(pu.mul(1.6), pv.mul(0.07), 3.0)).mul(0.11).mul(side);
  const shade = float(0.86).add(blotch).add(grain).sub(streak).add(tint.sub(0.5).mul(0.12));
  const ao = smoothstep(0, 0.45, edge).mul(0.28).add(0.72);
  return color(base).mul(shade).mul(seams(seamSize).mul(0.4).add(0.6)).mul(ao);
};

/** A line of light just inside the edges of a face. */
const trim = (inner: number, outer: number): N => smoothstep(outer, inner, edge).mul(smoothstep(0.0, 0.02, edge));

const fadeIn = userData('fade', 'float');

function standard(o: { color: N; emissive?: N; rough?: number; metal?: number; dynamic?: boolean }): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = o.color;
  m.roughness = o.rough ?? 0.92;
  m.metalness = o.metal ?? 0.0;
  if (o.dynamic) {
    // dissolve: cells of noise drop out as the box fades, with a hot rim on the cells about to go
    const n = mx_noise_float(positionLocal.mul(2.2)).mul(0.5).add(0.5);
    const gone = fadeIn.mul(1.25).sub(0.12);
    m.opacityNode = step(n, gone);
    m.alphaTest = 0.5;
    const rim = smoothstep(0.14, 0.0, gone.sub(n)).mul(step(n, gone)).mul(float(1).sub(step(0.999, fadeIn)));
    m.emissiveNode = (o.emissive ?? float(0)).add(color(WHITE).mul(rim).mul(2.5));
  } else if (o.emissive) m.emissiveNode = o.emissive;
  return m;
}

function energy(o: { color: number; pattern: N; opacity: N; dynamic: boolean }): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(o.color).mul(o.pattern);
  m.opacityNode = o.dynamic ? o.opacity.mul(fadeIn) : o.opacity;
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.fog = false;
  return m;
}

/** The material for a kind of box. `dynamic` boxes fade through userData.fade. */
export function boxMaterial(look: Look, dynamic: boolean): THREE.Material {
  switch (look) {
    case 'wall': {
      // megastructure: big panels, and sparse slits of light running round the faces
      const row = fract(pv.div(8));
      const lit = step(0.55, hash(floor(pu.div(3)).add(floor(pv.div(8)).mul(57.0)))).mul(side);
      const slit = smoothstep(0.035, 0.02, abs(row.sub(0.5))).mul(lit).mul(smoothstep(0.1, 0.4, abs(fract(pu.div(3)).sub(0.5)).oneMinus().sub(0.5).mul(3)));
      const warm = step(0.86, hash(floor(pu.div(3)).mul(13.0).add(floor(pv.div(8)))));
      return standard({ color: concrete(0x39404a, 4), emissive: mix(color(CYAN), color(ORANGE), warm).mul(slit).mul(1.6), rough: 0.95, dynamic });
    }
    case 'dark':
      return standard({ color: concrete(0x20252d, 2), rough: 0.55, metal: 0.6, dynamic });
    case 'metal':
      return standard({ color: concrete(0x555c66, 1), rough: 0.4, metal: 0.8, dynamic });
    case 'deck': {
      const e = trim(0.1, 0.22).mul(top);
      return standard({ color: concrete(0x7a828c, 2), emissive: color(WHITE).mul(e).mul(1.1), rough: 0.9, dynamic });
    }
    case 'mover': {
      const pulse = sin(time.mul(4)).mul(0.25).add(0.75);
      const e = trim(0.08, 0.2).mul(top.mul(0.8).add(0.2)).mul(pulse);
      return standard({ color: concrete(0x8a929b, 1), emissive: color(WHITE).mul(e).mul(1.6), rough: 0.6, metal: 0.3, dynamic });
    }
    case 'dissolve': {
      // dashed white edge + hatching: reads as "this will not hold"
      const dash = step(0.5, fract(fuv.x.add(fuv.y).mul(2.0)));
      const hatch = smoothstep(0.42, 0.5, abs(fract(pu.add(pv).mul(1.5)).sub(0.5))).mul(0.5).mul(top);
      const e = trim(0.06, 0.18).mul(dash).add(hatch.mul(0.35));
      return standard({ color: concrete(0x596069, 1), emissive: color(ORANGE).mul(e).mul(1.3), rough: 0.8, dynamic: true });
    }
    case 'mirror': {
      const glint = smoothstep(0.9, 1.0, sin(pu.add(pv).mul(1.3).sub(time.mul(1.5)))).mul(0.6);
      return standard({ color: color(0xdfeaf2), emissive: color(0x9fd8ff).mul(glint.add(0.25).add(trim(0.05, 0.15).mul(1.5))), rough: 0.06, metal: 1, dynamic });
    }
    case 'lethal': {
      const stripes = step(0.5, fract(pu.add(pv).mul(0.9).add(time.mul(0.8))));
      const flicker = mx_noise_float(vec3(pu.mul(3), pv.mul(3), time.mul(3))).mul(0.25).add(0.85);
      const rim = trim(0.0, 0.25);
      return energy({ color: 0xff5a1f, pattern: stripes.mul(0.75).add(0.55).add(rim.mul(1.6)).mul(flicker).mul(1.8), opacity: stripes.mul(0.2).add(0.42).add(rim.mul(0.4)), dynamic });
    }
    case 'gate': {
      const grid = float(1).sub(seams(0.5, 0.05));
      const scan = smoothstep(0.9, 1.0, sin(pv.mul(6).sub(time.mul(5))));
      return energy({ color: CYAN, pattern: grid.mul(0.9).add(scan.mul(0.6)).add(0.35).add(trim(0, 0.2).mul(1.2)), opacity: grid.mul(0.35).add(0.28).add(trim(0, 0.2).mul(0.4)), dynamic: true });
    }
    case 'bridge': {
      const grid = float(1).sub(seams(0.5, 0.04));
      return energy({ color: WHITE, pattern: grid.mul(1.2).add(0.45).add(trim(0, 0.12).mul(2.2)), opacity: grid.mul(0.35).add(0.4).add(trim(0, 0.12).mul(0.4)), dynamic: true });
    }
    case 'checkpoint': {
      const d = fuv.sub(fsize.mul(0.5)).length();
      const rings = smoothstep(0.75, 1.0, sin(d.mul(9).sub(time.mul(3)))).mul(smoothstep(1.25, 0.9, d));
      return energy({ color: CYAN, pattern: rings.mul(2).add(0.2), opacity: rings.mul(0.8).add(0.08).mul(top), dynamic: false });
    }
    case 'finish': {
      const d = fuv.sub(fsize.mul(0.5)).length();
      const rings = smoothstep(0.6, 1.0, sin(d.mul(6).sub(time.mul(4)))).mul(smoothstep(2.6, 2.0, d));
      return energy({ color: ORANGE, pattern: rings.mul(2.5).add(0.3), opacity: rings.mul(0.85).add(0.1).mul(top), dynamic: false });
    }
    default: {
      // 'safe' / 'concrete': the platforms you are meant to stand on carry a cyan edge
      const e = trim(0.07, 0.17).mul(top).add(trim(0.04, 0.1).mul(side).mul(0.5));
      return standard({ color: concrete(0x6d757f, 2), emissive: color(CYAN).mul(e).mul(1.5), rough: 0.88, dynamic });
    }
  }
}

/** Sky dome: star field above, a band of haze at the horizon, a furnace glow in the void below. */
export function skyMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const d = normalize(positionLocal);
  const up = d.y;
  const zenith = color(0x04060b), mid = color(0x0a1622), haze = color(0x15394a), ember = color(0x5a2208), pit = color(0x120603);
  let c = mix(mid, zenith, smoothstep(0.0, 0.7, up));
  c = mix(c, haze, smoothstep(0.32, 0.0, abs(up.add(0.03))).mul(0.85));
  const below = smoothstep(0.0, -0.75, up);
  c = mix(c, mix(ember, pit, smoothstep(-0.25, -1.0, up)), below);
  // drifting haze bands
  const band = mx_noise_float(vec3(d.x.mul(3), up.mul(14), d.z.mul(3).add(time.mul(0.01)))).mul(0.5).add(0.5);
  c = c.add(haze.mul(band).mul(smoothstep(0.4, 0.0, abs(up))).mul(0.35));
  // stars: one per cell of a direction grid, twinkling
  const g = d.mul(140);
  const cell = floor(g);
  const h = hash(cell.x.add(cell.y.mul(157.0)).add(cell.z.mul(113.0)));
  const inCell = fract(g).sub(0.5).length();
  const star = step(0.992, h).mul(smoothstep(0.35, 0.05, inCell)).mul(smoothstep(0.02, 0.25, up));
  const twinkle = sin(time.mul(h.mul(6).add(1)).add(h.mul(40))).mul(0.4).add(0.8);
  m.colorNode = c.add(vec3(star.mul(twinkle).mul(1.6)));
  m.side = THREE.BackSide;
  m.depthWrite = false;
  m.fog = false;
  return m;
}

/** Far towers: dark slabs with a grid of lit windows that slowly change. */
export function cityMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const cu = floor(pu.div(7)), cv = floor(pv.div(9));
  const h = hash(cu.add(cv.mul(71.0)));
  const slow = step(0.5, fract(h.mul(7).add(time.mul(0.02))));
  const win = step(0.93, h).mul(smoothstep(0.5, 0.3, abs(fract(pu.div(7)).sub(0.5)))).mul(smoothstep(0.5, 0.42, abs(fract(pv.div(9)).sub(0.5)))).mul(side).mul(slow.mul(0.6).add(0.4));
  const warm = step(0.8, hash(cu.mul(3.0).add(cv)));
  m.colorNode = color(0x0c1118).add(mix(color(CYAN), color(ORANGE), warm).mul(win).mul(1.4));
  return m;
}

/** Glowing solid colour for enemies, pickups and effects; brightness above 1 feeds the bloom. */
export function glow(hex: number, strength = 1.5, opts: { transparent?: boolean; additive?: boolean; opacity?: number; fresnel?: boolean } = {}): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(hex).mul(strength);
  if (opts.transparent || opts.additive) { m.transparent = true; m.depthWrite = false; m.opacity = opts.opacity ?? 1; }
  if (opts.additive) m.blending = THREE.AdditiveBlending;
  m.fog = false;
  return m;
}

export function metal(hex: number, rough = 0.35, emissiveHex?: number, emissiveStrength = 1): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.color = new THREE.Color(hex);
  m.roughness = rough;
  m.metalness = 0.85;
  if (emissiveHex !== undefined) m.emissiveNode = color(emissiveHex).mul(emissiveStrength);
  return m;
}
