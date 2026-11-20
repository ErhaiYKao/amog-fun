// The character controller. Fixed 120 Hz step, Quake-family ground/air physics with extra air control
// for precision platforming, slides, wall kicks, charge dashes and anchor pulls.
// Velocity is only ever changed by forces and impulses: nothing here scripts a position.
import type { V3 } from './math.ts';
import { v3, forwardXZ, rightXZ, lookDir, clamp } from './math.ts';
import type { Box, Hit, World } from './world.ts';
import { SKIN } from './world.ts';
import { DT, T, SHOTGUN } from './tuning.ts';

export interface Input {
  moveX: number;    // strafe, right is +1
  moveZ: number;    // forward is +1
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  fire: boolean;
  dash: boolean;
  weapon: number;   // weapon slot wanted (0..2)
}

export const emptyInput = (): Input => ({
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, sprint: false, crouch: false, fire: false, dash: false, weapon: 0,
});

export type Ev =
  | { type: 'jump' | 'walljump' | 'dash' | 'slide' | 'nocharge' | 'respawn' | 'finish' | 'reload' | 'dryfire' }
  | { type: 'land'; speed: number }
  | { type: 'charge'; delta: number; reason: string }
  | { type: 'shot'; weapon: number; from: V3; segs: { a: V3; b: V3 }[]; hit: boolean; kill: boolean }
  | { type: 'impact'; pos: V3; n: V3; kind: 'wall' | 'enemy' | 'weak' | 'target' | 'mirror' }
  | { type: 'hurt'; amount: number; from: V3 }
  | { type: 'death'; reason: string }
  | { type: 'checkpoint'; index: number; stage: number }
  | { type: 'stage'; stage: number }
  | { type: 'kill'; pos: V3; kind: string; airborne: boolean; weak: boolean }
  | { type: 'enemyShot'; pos: V3; kind: string }
  | { type: 'telegraph'; pos: V3; kind: string }
  | { type: 'beam'; a: V3; b: V3 }
  | { type: 'boom'; pos: V3 }
  | { type: 'rebuild'; pos: V3 }
  | { type: 'switch'; pos: V3; signal: string; seconds: number }
  | { type: 'anchor'; pos: V3 }
  | { type: 'target'; pos: V3; done: boolean; ok: boolean }
  | { type: 'dissolve'; pos: V3 };

export interface Player {
  pos: V3;            // centre of the hull
  vel: V3;            // world velocity in the air; relative to the platform while standing on one
  half: V3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  ground: Box | null;
  crouched: boolean;
  sliding: boolean;
  coyote: number;
  jumpBuf: number;
  lastWall: V3 | null;   // normal of the wall last kicked off this airtime
  dashT: number;
  dashDir: V3;
  pull: { to: V3; t: number } | null;
  airTime: number;
  fallV: number;         // vertical speed just before the last floor contact
  health: number;
  charges: number;
  shells: number;
  reloadT: number;
  weapon: number;
  cool: number[];        // per-weapon cycle timers
  alive: boolean;
  prevJump: boolean;
  prevDash: boolean;
  prevFire: boolean;
  prevCrouch: boolean;
  // stats for one airtime, handy for tests and the HUD
  wallJumps: number;
}

export function makePlayer(): Player {
  return {
    pos: v3(), vel: v3(), half: v3(T.radius, T.standH / 2, T.radius),
    yaw: 0, pitch: 0, grounded: false, ground: null, crouched: false, sliding: false,
    coyote: 0, jumpBuf: 0, lastWall: null, dashT: 0, dashDir: v3(), pull: null, airTime: 0, fallV: 0,
    health: T.maxHealth, charges: 0, shells: SHOTGUN.shells, reloadT: 0, weapon: 0, cool: [0, 0, 0],
    alive: true, prevJump: false, prevDash: false, prevFire: false, prevCrouch: false, wallJumps: 0,
  };
}

/** Put the player (feet at `feet`) somewhere, at rest. */
export function placePlayer(p: Player, feet: V3, yaw: number): void {
  p.half.y = T.standH / 2;
  p.pos.x = feet.x; p.pos.y = feet.y + p.half.y + SKIN; p.pos.z = feet.z;
  p.vel.x = p.vel.y = p.vel.z = 0;
  p.yaw = yaw; p.pitch = 0;
  p.grounded = false; p.ground = null; p.crouched = false; p.sliding = false;
  p.coyote = 0; p.jumpBuf = 0; p.lastWall = null; p.dashT = 0; p.pull = null; p.airTime = 0; p.fallV = 0;
  p.wallJumps = 0;
}

export const eyeOf = (p: Player): V3 => ({ x: p.pos.x, y: p.pos.y + p.half.y - T.eyeDrop, z: p.pos.z });
export const feetOf = (p: Player): number => p.pos.y - p.half.y;
export const hspeed = (p: Player): number => Math.hypot(p.vel.x, p.vel.z);

/** World-space velocity (adds the platform's while standing on a mover). */
export function worldVel(p: Player): V3 {
  if (p.grounded && p.ground) return { x: p.vel.x + p.ground.vel.x, y: p.vel.y + p.ground.vel.y, z: p.vel.z + p.ground.vel.z };
  return { x: p.vel.x, y: p.vel.y, z: p.vel.z };
}

const hit: Hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };
const DOWN = v3(0, -0.03, 0);

function accelerate(p: Player, wx: number, wz: number, wishSpeed: number, accel: number): void {
  const cur = p.vel.x * wx + p.vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * wishSpeed * DT, add);
  p.vel.x += wx * a; p.vel.z += wz * a;
}

function airMove(p: Player, wx: number, wz: number): void {
  // Below walking speed this is plain acceleration towards the wish direction: stand-still jumps steer fully.
  // Above it the same push can only turn the velocity (or brake it), never lengthen it...
  const sp0 = Math.hypot(p.vel.x, p.vel.z);
  const cur = p.vel.x * wx + p.vel.z * wz;
  const add = T.walk - cur;
  if (add <= 0) return;
  const a = Math.min(T.airControl * DT, add);
  const ox = p.vel.x, oz = p.vel.z;
  p.vel.x += wx * a; p.vel.z += wz * a;
  const lim = Math.max(sp0, T.walk);
  const sp1 = Math.hypot(p.vel.x, p.vel.z);
  if (sp1 <= lim) return;
  // ...except that carving pays: every radian the velocity turns adds a little speed. This is the air strafe.
  let gain = 0;
  if (sp0 >= T.walk) {
    const turned = Math.abs(Math.atan2(ox * p.vel.z - oz * p.vel.x, ox * p.vel.x + oz * p.vel.z));
    gain = T.carveGain * turned;
  }
  const k = (lim + gain) / sp1;
  p.vel.x *= k; p.vel.z *= k;
}

function leaveGround(p: Player): void {
  if (p.ground) { p.vel.x += p.ground.vel.x; p.vel.y += p.ground.vel.y; p.vel.z += p.ground.vel.z; }
  p.grounded = false;
  p.ground = null;
}

function setCrouch(w: World, p: Player, want: boolean, ev: Ev[]): void {
  const diff = (T.standH - T.crouchH) / 2;
  if (want && !p.crouched) {
    // on the ground the head comes down; in the air the feet come up (crouch-jumps clear higher ledges)
    p.pos.y += p.grounded ? -diff : diff;
    p.half.y = T.crouchH / 2;
    p.crouched = true;
    if (p.grounded) startSlide(p, ev);
  } else if (!want && p.crouched) {
    const h = { x: p.half.x, y: T.standH / 2, z: p.half.z };
    const up = { x: p.pos.x, y: p.pos.y + diff, z: p.pos.z };
    const down = { x: p.pos.x, y: p.pos.y - diff, z: p.pos.z };
    const first = p.grounded ? up : down, second = p.grounded ? down : up;
    const to = !w.overlaps(first, h) ? first : !p.grounded && !w.overlaps(second, h) ? second : null;
    if (to) { p.pos.y = to.y; p.half.y = T.standH / 2; p.crouched = false; p.sliding = false; }
  }
}

function startSlide(p: Player, ev: Ev[]): void {
  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (sp < T.slideMin || p.sliding) return;
  p.sliding = true;
  const boosted = Math.max(sp, Math.min(sp + T.slideBoost, T.slideBoostCap));
  const k = boosted / sp;
  p.vel.x *= k; p.vel.z *= k;
  ev.push({ type: 'slide' });
}

/** Walls within reach, as outward normals. */
function wallsNear(w: World, p: Player): V3[] {
  const out: V3[] = [];
  const dirs = [v3(T.wallProbe, 0, 0), v3(-T.wallProbe, 0, 0), v3(0, 0, T.wallProbe), v3(0, 0, -T.wallProbe)];
  for (const d of dirs) if (w.sweep(p.pos, p.half, d, hit)) out.push({ x: hit.nx, y: 0, z: hit.nz });
  return out;
}

function tryWallJump(w: World, p: Player, ev: Ev[]): boolean {
  const walls = wallsNear(w, p);
  if (!walls.length) return false;
  // free off the first wall and off any wall facing the last one; anything else costs a charge
  const free = (n: V3) => !p.lastWall || n.x * p.lastWall.x + n.z * p.lastWall.z < -0.5;
  let n = walls.find(free) ?? null;
  if (!n) {
    if (p.charges <= 0) { ev.push({ type: 'nocharge' }); return false; }
    n = walls[0];
    p.charges--;
    ev.push({ type: 'charge', delta: -1, reason: 'wall' });
  }
  const into = p.vel.x * n.x + p.vel.z * n.z;
  if (into < 0) { p.vel.x -= n.x * into; p.vel.z -= n.z * into; }
  p.vel.x += n.x * T.wallKick; p.vel.z += n.z * T.wallKick;
  p.vel.y = Math.max(p.vel.y, T.wallJumpV);
  p.lastWall = n;
  p.wallJumps++;
  p.jumpBuf = 0;
  p.dashT = 0;
  ev.push({ type: 'walljump' });
  return true;
}

function tryDash(p: Player, inp: Input, ev: Ev[]): void {
  if (p.dashT > 0) return;
  if (p.charges <= 0) { ev.push({ type: 'nocharge' }); return; }
  // direction: the keys relative to where you look (pitch included), or straight ahead with no keys
  const f = lookDir(p.yaw, p.pitch), r = rightXZ(p.yaw);
  let dx = f.x * inp.moveZ + r.x * inp.moveX;
  let dy = f.y * inp.moveZ;
  let dz = f.z * inp.moveZ + r.z * inp.moveX;
  let l = Math.hypot(dx, dy, dz);
  if (l < 0.01) { dx = f.x; dy = f.y; dz = f.z; l = 1; }
  dx /= l; dy /= l; dz /= l;
  if (p.grounded) { if (dy < 0) { dy = 0; const h = Math.hypot(dx, dz) || 1; dx /= h; dz /= h; } leaveGroundIfUp(p, dy); }
  const speed = Math.max(Math.hypot(p.vel.x, p.vel.y, p.vel.z), T.dashSpeed);
  p.vel.x = dx * speed; p.vel.y = dy * speed; p.vel.z = dz * speed;
  p.dashT = T.dashLock;
  p.dashDir = { x: dx, y: dy, z: dz };
  p.charges--;
  p.pull = null;
  ev.push({ type: 'charge', delta: -1, reason: 'dash' });
  ev.push({ type: 'dash' });
}

function leaveGroundIfUp(p: Player, dy: number): void {
  if (p.grounded && dy > 0.05) leaveGround(p);
}

/** Add an impulse (recoil, knockback). Lifts the player off the ground if it points up. */
export function impulse(p: Player, dv: V3): void {
  if (p.grounded && dv.y > 0.5) leaveGround(p);
  p.vel.x += dv.x; p.vel.z += dv.z;
  if (!p.grounded) p.vel.y += dv.y;
}

/** Move with collision: sweep, slide along what was hit, climb low ledges. */
function slideMove(w: World, p: Player): void {
  let remaining = DT;
  const d = v3();
  for (let bump = 0; bump < 5 && remaining > 1e-7; bump++) {
    d.x = p.vel.x * remaining; d.y = p.vel.y * remaining; d.z = p.vel.z * remaining;
    if (d.x === 0 && d.y === 0 && d.z === 0) break;
    if (!w.sweep(p.pos, p.half, d, hit)) {
      p.pos.x += d.x; p.pos.y += d.y; p.pos.z += d.z;
      break;
    }
    // advance to the contact, then sit exactly a skin's width off the surface along its normal
    const b = hit.box!;
    p.pos.x += d.x * hit.t; p.pos.y += d.y * hit.t; p.pos.z += d.z * hit.t;
    if (hit.nx) p.pos.x = hit.nx > 0 ? b.max.x + p.half.x + SKIN : b.min.x - p.half.x - SKIN;
    else if (hit.ny) p.pos.y = hit.ny > 0 ? b.max.y + p.half.y + SKIN : b.min.y - p.half.y - SKIN;
    else p.pos.z = hit.nz > 0 ? b.max.z + p.half.z + SKIN : b.min.z - p.half.z - SKIN;
    remaining *= 1 - hit.t;
    if (hit.ny === 0) {
      // low ledge: step onto it instead of stopping
      const rise = b.max.y - (p.pos.y - p.half.y);
      if (rise > 0 && rise <= T.step && p.vel.y <= T.jumpV) {
        const up = { x: p.pos.x - hit.nx * 0.02, y: b.max.y + p.half.y + SKIN, z: p.pos.z - hit.nz * 0.02 };
        if (!w.overlaps(up, p.half)) {
          p.pos.x = up.x; p.pos.y = up.y; p.pos.z = up.z;
          if (p.vel.y < 0) { p.fallV = p.vel.y; p.vel.y = 0; }
          continue;
        }
      }
      if (hit.nx) p.vel.x = 0; else p.vel.z = 0;
    } else {
      if (hit.ny > 0) p.fallV = p.vel.y;
      p.vel.y = 0;
    }
  }
}

export function stepPlayer(w: World, p: Player, inp: Input, ev: Ev[]): void {
  p.yaw = inp.yaw;
  p.pitch = clamp(inp.pitch, -1.55, 1.55);
  if (inp.jump && !p.prevJump) p.jumpBuf = T.jumpBuffer;
  const dashPressed = inp.dash && !p.prevDash;
  p.prevJump = inp.jump; p.prevDash = inp.dash;

  // carried by the platform underfoot, shoved by anything that moved into us
  if (p.grounded && p.ground) {
    p.pos.x += p.ground.delta.x; p.pos.y += p.ground.delta.y; p.pos.z += p.ground.delta.z;
  }
  w.depenetrate(p.pos, p.half);

  // ground check
  const wasGrounded = p.grounded;
  let ground: Box | null = null;
  if (p.vel.y <= 0.01 && w.sweep(p.pos, p.half, DOWN, hit) && hit.ny > 0) ground = hit.box;
  if (ground && !ground.active) ground = null;
  if (ground) {
    if (!wasGrounded) {
      // landing: velocity becomes relative to the platform
      p.vel.x -= ground.vel.x; p.vel.z -= ground.vel.z;
      ev.push({ type: 'land', speed: -Math.min(p.fallV, p.vel.y) });
      p.lastWall = null; p.wallJumps = 0; p.dashT = 0;
      p.grounded = true; p.ground = ground;
      if (p.crouched) startSlide(p, ev);
    } else if (ground !== p.ground) {
      const old = p.ground;
      if (old) { p.vel.x += old.vel.x - ground.vel.x; p.vel.z += old.vel.z - ground.vel.z; }
      p.ground = ground;
    }
    p.vel.y = 0;
    p.airTime = 0;
    p.coyote = T.coyote;
    if (ground.def.dissolve && ground.touched < 0) { ground.touched = 0; ev.push({ type: 'dissolve', pos: { ...p.pos } }); }
  } else if (wasGrounded) {
    leaveGround(p);
  }

  setCrouch(w, p, inp.crouch, ev);
  p.prevCrouch = inp.crouch;

  // wish direction
  const f = forwardXZ(p.yaw), r = rightXZ(p.yaw);
  let wx = f.x * inp.moveZ + r.x * inp.moveX, wz = f.z * inp.moveZ + r.z * inp.moveX;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-6) { wx /= wl; wz /= wl; }
  const hasWish = wl > 1e-6;

  if (p.dashT > 0) p.dashT -= DT;
  if (dashPressed) tryDash(p, inp, ev);

  if (p.grounded) {
    if (p.jumpBuf > 0) {
      // jumping on the landing tick skips friction entirely: that is the bunnyhop
      const lift = Math.max(0, p.ground?.vel.y ?? 0);
      leaveGround(p);
      p.vel.y = T.jumpV + lift;
      p.jumpBuf = 0; p.coyote = 0; p.sliding = false;
      ev.push({ type: 'jump' });
    } else if (p.sliding) {
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (!p.crouched || sp < T.slideEnd) p.sliding = false;
      else {
        const ns = Math.max(0, sp - T.slideFriction * DT);
        let dx = p.vel.x / sp, dz = p.vel.z / sp;
        if (hasWish) {
          // turn the slide towards the wish direction at a limited rate
          const crossY = dx * wz - dz * wx;
          const ang = Math.atan2(crossY, dx * wx + dz * wz);
          const turn = clamp(ang, -T.slideSteer * DT, T.slideSteer * DT);
          const c = Math.cos(turn), s = Math.sin(turn);
          const nx = dx * c - dz * s, nz = dx * s + dz * c;
          dx = nx; dz = nz;
        }
        p.vel.x = dx * ns; p.vel.z = dz * ns;
      }
    }
    if (p.grounded && !p.sliding) {
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (sp > 0) {
        const drop = Math.max(sp, T.stopSpeed) * T.friction * DT;
        const k = Math.max(0, sp - drop) / sp;
        p.vel.x *= k; p.vel.z *= k;
      }
      if (hasWish) accelerate(p, wx, wz, p.crouched ? T.crouchWalk : inp.sprint ? T.sprint : T.walk, T.groundAccel);
    }
  }

  if (!p.grounded) {
    p.airTime += DT;
    if (p.jumpBuf > 0) {
      if (p.coyote > 0 && p.vel.y <= 0.01) {
        p.vel.y = T.jumpV; p.jumpBuf = 0; p.coyote = 0;
        ev.push({ type: 'jump' });
      } else if (p.coyote <= 0) tryWallJump(w, p, ev);
    }
    if (p.dashT <= 0) {
      // the tether carries you while an anchor pulls
      if (!p.pull) p.vel.y = Math.max(p.vel.y - T.gravity * DT, -T.terminal);
      if (hasWish) airMove(p, wx, wz);
    }
    p.coyote = Math.max(0, p.coyote - DT);
  }

  // anchor pull: a real acceleration, so it bends whatever momentum you already had
  if (p.pull) {
    const dx = p.pull.to.x - p.pos.x, dy = p.pull.to.y - p.pos.y, dz = p.pull.to.z - p.pos.z;
    const l = Math.hypot(dx, dy, dz);
    p.pull.t -= DT;
    if (l < T.pullStop || p.pull.t <= 0) p.pull = null;
    else {
      const a = T.pullAccel * DT / l;
      if (p.grounded && dy * a > 0) leaveGround(p);
      p.vel.x += dx * a; p.vel.z += dz * a;
      if (!p.grounded) p.vel.y += dy * a;
    }
  }

  slideMove(w, p);
  p.jumpBuf = Math.max(0, p.jumpBuf - DT);

  // shells go back in while you are on the ground
  if (p.grounded && p.shells < SHOTGUN.shells) {
    p.reloadT += DT;
    if (p.reloadT >= SHOTGUN.reload) { p.reloadT = 0; p.shells++; ev.push({ type: 'reload' }); }
  }
  for (let i = 0; i < p.cool.length; i++) if (p.cool[i] > 0) p.cool[i] -= DT;
}
