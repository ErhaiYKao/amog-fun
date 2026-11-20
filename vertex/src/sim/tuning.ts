// Every gameplay number lives here. Units: metres, seconds.
export const DT = 1 / 120;

export const T = {
  // hull
  radius: 0.4,          // half width of the player box
  standH: 1.8,
  crouchH: 1.0,
  eyeDrop: 0.15,        // eye sits this far below the top of the hull
  step: 0.35,           // ledges this low are climbed without a jump (also ledge forgiveness in the air)

  // ground
  walk: 8,
  sprint: 11,
  crouchWalk: 4,
  groundAccel: 10,      // Quake-style: accel * wishspeed per second
  friction: 6,
  stopSpeed: 2.5,

  // air
  gravity: 25,
  jumpV: 9.08,          // -> 1.65 m apex
  airControl: 24,       // m/s^2 towards the wish direction: full control up to walking speed, a pure turn above it
  carveGain: 1.5,       // m/s gained per radian the velocity is turned in the air (air strafing pays, about 36/speed m/s^2 at best)
  coyote: 0.08,
  jumpBuffer: 0.1,
  terminal: 70,

  // slide
  slideMin: 6,          // need this much speed to start one
  slideBoost: 3,        // entering a slide adds this ...
  slideBoostCap: 13.5,  // ... but never past this speed, so it cannot be spammed for unbounded speed
  slideFriction: 3,     // constant deceleration
  slideSteer: 1.6,      // rad/s the slide can be turned
  slideEnd: 3.5,

  // wall jump
  wallProbe: 0.14,
  wallKick: 6.5,
  wallJumpV: 8.6,

  // dash
  dashSpeed: 17,
  dashLock: 0.14,       // no gravity / no steering for this long

  // resources
  maxCharges: 2,
  maxHealth: 100,
  killHeal: 25,

  // anchors
  pullAccel: 30,
  pullTime: 0.5,
  pullStop: 1.6,

  voidDepth: 45,        // die this far below the lowest geometry
} as const;

export interface WeaponDef {
  name: string;
  short: string;
  cycle: number;        // seconds between shots
  damage: number;       // per pellet
  recoil: number;       // m/s impulse opposite the shot
  range: number;
  auto: boolean;        // hold to fire
}

export const WEAPONS: WeaponDef[] = [
  { name: 'Kinetic Shotgun', short: 'KS-2', cycle: 0.42, damage: 10, recoil: 8, range: 45, auto: true },
  { name: 'Pulse Pistol', short: 'PP-1', cycle: 0.16, damage: 25, recoil: 0, range: 220, auto: false },
  { name: 'Rail Rifle', short: 'RR-9', cycle: 1.1, damage: 150, recoil: 3, range: 320, auto: true },
];

export const SHOTGUN = {
  shells: 2,
  reload: 0.35,         // grounded seconds per shell
  // fixed pellet pattern (yaw, pitch offsets in radians): the spread is the same every shot
  pattern: ((): [number, number][] => {
    const p: [number, number][] = [[0, 0]];
    for (let i = 0; i < 5; i++) p.push([Math.cos((i / 5) * Math.PI * 2) * 0.028, Math.sin((i / 5) * Math.PI * 2) * 0.028]);
    for (let i = 0; i < 6; i++) p.push([Math.cos(((i + 0.5) / 6) * Math.PI * 2) * 0.06, Math.sin(((i + 0.5) / 6) * Math.PI * 2) * 0.06]);
    return p;
  })(),
  stagger: 0.7,
};

export const RAIL = { bounces: 4 };
