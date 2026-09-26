// Headless balance harness for Amog Space Program.
// Run: node tools/balance-sim.mjs
// Simulates representative rocket configs through the real flight physics and
// prints apogee / max speed / payout so progression can be tuned numerically.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../../public/amog-space-program/js/physics.js');
const D = require('../../public/amog-space-program/js/data.js');

function stage(engineId, engineCount, tanks, opts = {}) {
  const e = D.ENGINES[engineId];
  const dryFrac = opts.dryFrac ?? D.TANK.dryFrac;
  return {
    engine: e, engineCount, tanks,
    tankFuel: D.TANK.fuel, tankDry: D.TANK.fuel * dryFrac
  };
}

function fly(name, stages, opts = {}) {
  const cfg = {
    stages,
    payload: D.PAYLOAD_MASS,
    cdA: (opts.cdA ?? D.BASE_CDA),
    turnStart: opts.turnStart ?? 0,
    turnEnd: opts.turnEnd ?? 0
  };
  const stats = P.vehicleStats(stages, cfg.payload);
  const f = new P.Flight(cfg);
  const MAX_T = 3600 * 3;
  while (f.status === 'flying' && f.t < MAX_T) f.advance(60);
  const payout = D.launchPayout(f.maxAlt, f.maxSpeed, f.status === 'orbit', opts.telem ?? 1);
  const orbitDv = f.status === 'orbit' ? f.remainingDv() : 0;
  console.log(
    name.padEnd(34),
    ('dv=' + (stats.totalDv / 1000).toFixed(2) + 'km/s').padEnd(12),
    ('twr=' + stats.liftoffTwr.toFixed(2)).padEnd(9),
    ('apo=' + D.fmtDist(f.maxAlt)).padEnd(14),
    ('vmax=' + D.fmtSpeed(f.maxSpeed)).padEnd(15),
    f.status.padEnd(8),
    ('$' + D.fmt(payout)).padEnd(9),
    orbitDv ? ('budget=' + (orbitDv / 1000).toFixed(2) + 'km/s') : ''
  );
  return f;
}

console.log('=== Phase 1: straight up (no guidance) ===');
fly('starter: 1 Fizz, 1 tank', [stage('fizz', 1, 1)]);
fly('1 Fizz, 2 tanks', [stage('fizz', 1, 2)]);
fly('2 Fizz, 3 tanks', [stage('fizz', 2, 3)]);
fly('2 Fizz, 4 tanks + aero1', [stage('fizz', 2, 4)], { cdA: D.BASE_CDA * 0.72 });
fly('1 Sundancer, 2 tanks', [stage('sundancer', 1, 2)]);
fly('1 Sundancer, 4 tanks +aero1', [stage('sundancer', 1, 4)], { cdA: D.BASE_CDA * 0.72 });
fly('2 Sundancer, 6 tanks +aero1', [stage('sundancer', 2, 6)], { cdA: D.BASE_CDA * 0.72 });
fly('1 Kestrel, 4 tanks +aero1', [stage('kestrel', 1, 4)], { cdA: D.BASE_CDA * 0.72 });
fly('1 Kestrel, 7 tanks +aero2', [stage('kestrel', 1, 7)], { cdA: D.BASE_CDA * 0.55 });
fly('2stage Kestrel 6 + Sun 2, a2', [stage('kestrel', 1, 6), stage('sundancer', 1, 2)], { cdA: D.BASE_CDA * 0.55 });
fly('2stage Kestrel 8+4, aero2', [stage('kestrel', 1, 8), stage('kestrel', 1, 4)], { cdA: D.BASE_CDA * 0.55 });
fly('1 Merlin, 14 tanks, aero2', [stage('merlin', 1, 14)], { cdA: D.BASE_CDA * 0.55 });

console.log('\n=== Phase 2: gravity turn (guidance) ===');
fly('Merlin 14 + Kestrel 5, turn', [stage('merlin', 1, 14), stage('kestrel', 1, 5)],
  { cdA: D.BASE_CDA * 0.55, turnStart: 2e3, turnEnd: 60e3 });
fly('Merlin 18 + Kestrel 6, turn m1', [stage('merlin', 1, 18, { dryFrac: 0.08 }), stage('kestrel', 1, 6, { dryFrac: 0.08 })],
  { cdA: D.BASE_CDA * 0.55, turnStart: 2e3, turnEnd: 60e3 });
fly('Merlin 20 + Kestrel 8, a3 m2', [stage('merlin', 1, 20, { dryFrac: 0.065 }), stage('kestrel', 1, 8, { dryFrac: 0.065 })],
  { cdA: D.BASE_CDA * 0.4, turnStart: 2e3, turnEnd: 55e3 });
fly('Raptor 20 + Merlin 6, turn', [stage('raptor', 1, 20), stage('merlin', 1, 6)],
  { cdA: D.BASE_CDA * 0.4, turnStart: 2e3, turnEnd: 55e3 });
fly('Raptor 22 + Kestrel 8, turn', [stage('raptor', 1, 22), stage('kestrel', 1, 8)],
  { cdA: D.BASE_CDA * 0.4, turnStart: 2e3, turnEnd: 55e3 });
fly('Raptor24+Merlin8+Kestrel3', [stage('raptor', 1, 24), stage('merlin', 1, 8), stage('kestrel', 1, 3)],
  { cdA: D.BASE_CDA * 0.4, turnStart: 2e3, turnEnd: 55e3 });
for (const te of [18e3, 25e3, 35e3]) {
  fly(`M20+K8 a3 m2 turn 0.5-${te / 1000}k`, [stage('merlin', 1, 20, { dryFrac: 0.065 }), stage('kestrel', 1, 8, { dryFrac: 0.065 })],
    { cdA: D.BASE_CDA * 0.4, turnStart: 500, turnEnd: te });
  fly(`R24+M12 a3 m2 turn 0.5-${te / 1000}k`, [stage('raptor', 1, 24, { dryFrac: 0.065 }), stage('merlin', 1, 12, { dryFrac: 0.065 })],
    { cdA: D.BASE_CDA * 0.4, turnStart: 500, turnEnd: te });
}
fly('Merlin2x24+Merlin12 a3 m2', [stage('merlin', 2, 24, { dryFrac: 0.065 }), stage('merlin', 1, 12, { dryFrac: 0.065 })],
  { cdA: D.BASE_CDA * 0.4, turnStart: 1.5e3, turnEnd: 42e3 });
fly('Raptor24 + Merlin12, a3 m2', [stage('raptor', 1, 24, { dryFrac: 0.065 }), stage('merlin', 1, 12, { dryFrac: 0.065 })],
  { cdA: D.BASE_CDA * 0.4, turnStart: 1.5e3, turnEnd: 42e3 });
fly('Raptor24+Merlin12+Kestrel4 m3', [stage('raptor', 1, 24, { dryFrac: 0.05 }), stage('merlin', 1, 12, { dryFrac: 0.05 }), stage('kestrel', 1, 4, { dryFrac: 0.05 })],
  { cdA: D.BASE_CDA * 0.4, turnStart: 1.5e3, turnEnd: 42e3 });
fly('Raptor24+Nerva12+Ion6 (planner)', [stage('raptor', 2, 24, { dryFrac: 0.05 }), stage('nerva', 1, 12, { dryFrac: 0.05 }), stage('ion', 6, 8, { dryFrac: 0.05 })],
  { cdA: D.BASE_CDA * 0.4, turnStart: 1.5e3, turnEnd: 42e3 });

console.log('\n=== Rocket equation sanity ===');
console.log('dv(ve=3600, R=4) =', (P.tsiolkovsky(3600, 4, 1) / 1000).toFixed(2), 'km/s (expect ~4.99)');
console.log('rel dv(ve=1e8, R=20) =', (P.tsiolkovskyRel(1e8, 20, 1) / P.C.C_LIGHT).toFixed(3), 'c');
console.log('sail cruise 0.02c to Alpha Cen:', (4.37 / 0.02).toFixed(0), 'years');
