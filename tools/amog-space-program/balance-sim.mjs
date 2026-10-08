// Headless balance harness for Amog Space Program.
// Run: node tools/amog-space-program/balance-sim.mjs [--quick] [--until=orbit|voyager|win] [--seed=N]
//
//   1. physics sanity: representative rockets through the real flight sim
//   2. capability table (skipped with --quick, takes a few minutes): for each
//      cumulative phase-2 tech tier, the best Δv left in orbit per payload,
//      and which missions that tier newly makes possible. This is the check
//      that no single tech (NERVA, gravity assists, ...) unlocks a pile of
//      missions at once.
//   3. progression bot: plays game.js from a fresh save (bot.mjs) and prints
//      the timeline. Times are game-clock time for an efficient player who
//      stops clicking LAUNCH once the ground crew exists; expect a casual
//      player to take ~1.5-2x as long.
//
// Intended progression (bot time, seed 1; measured — rerun after changing data.js):
//   0:00-0:05  soda bottle -> 1 km (8 s) -> Sundancer (1:30) -> 5 km science
//              (2:12) -> ground crew (4:11): the first minutes pay out often
//   ~0:09      Kestrel; the Kármán line falls (a deliberate, satisfying burst)
//   0:10-0:45  the long climb to orbit: staging, Merlin, telemetry, guidance,
//              vacuum nozzles — one research every ~4-6 min, contracts between
//   0:45       FIRST ORBIT (phase 2); weather sat and MEO right after
//   1:20       hydrolox -> Moon flyby; 1:30-2:05 4th stage, heavy-lift I,
//              aerobraking, ion, heavy-lift II open Moon orbit, Venus, Mars,
//              L2, Mercury, Ceres, Moon landing one or two at a time
//   2:20-3:40  Jupiter, NERVA, Mars landing, gravity assists, Saturn, Uranus
//   ~4:10      heavy-lift III -> Voyager (phase 3)
//   4:10-5:40  precursor flybys -> Alpha Centauri ... galactic core colonies
//              -> Andromeda (~5h40). Expect a human at ~1.5-2x these times.
// No tier of the capability table opens more than 3 missions; NERVA opens 1.

import { runBot, capabilityTable, fmtClock, P, D, G } from './bot.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

function stage(engineId, engineCount, tanks, dryFrac = D.TANK.dryFrac) {
  const e = D.ENGINES[engineId];
  return { engine: e, engineCount, tanks, tankFuel: D.TANK.fuel, tankDry: D.TANK.fuel * dryFrac * (e.dryMult || 1) };
}

function fly(name, stages, opts = {}) {
  const payload = opts.payload ?? D.PAYLOAD_MASS;
  const stats = P.vehicleStats(stages, payload);
  const f = new P.Flight({ stages, payload, cdA: opts.cdA ?? D.BASE_CDA,
    turnStart: opts.turnStart ?? 0, turnEnd: opts.turnEnd ?? 0 });
  while (f.status === 'flying' && f.t < 3 * 3600) f.advance(60);
  const payout = D.launchPayout(f.maxAlt, f.maxSpeed, f.status === 'orbit', 1);
  console.log(
    name.padEnd(36),
    ('dv=' + (stats.totalDv / 1000).toFixed(2) + 'km/s').padEnd(13),
    ('twr=' + stats.liftoffTwr.toFixed(2)).padEnd(10),
    ('apo=' + D.fmtDist(f.maxAlt)).padEnd(15),
    f.status.padEnd(8),
    ('$' + D.fmt(payout)).padEnd(8),
    f.status === 'orbit' ? 'left in orbit ' + D.fmtSpeed(f.remainingDv()) : ''
  );
}

console.log('=== 1. Physics sanity ===');
fly('starter: 1 Fizz, 1 tank', [stage('fizz', 1, 1)]);
fly('1 Fizz, 2 tanks', [stage('fizz', 1, 2)]);
fly('1 Sundancer, 2 tanks', [stage('sundancer', 1, 2)]);
fly('1 Sundancer, 4 tanks, aero I', [stage('sundancer', 1, 4)], { cdA: D.BASE_CDA * 0.72 });
fly('1 Kestrel, 4 tanks, aero I', [stage('kestrel', 1, 4)], { cdA: D.BASE_CDA * 0.72 });
fly('1 Kestrel, 6 tanks, aero I', [stage('kestrel', 1, 6)], { cdA: D.BASE_CDA * 0.72 });
fly('Merlin 4x22 + Merlin 22 + Kestrel 6', [stage('merlin', 4, 22, 0.07), stage('merlin', 1, 22, 0.07), stage('kestrel', 1, 6, 0.07)],
  { cdA: D.BASE_CDA * 0.4, turnStart: 1000, turnEnd: 30000 });
fly('Raptor 3x60/60 + Hydra 30 (300 kg)', [stage('raptor', 3, 60, 0.045), stage('raptor', 1, 60, 0.045), stage('hydra', 1, 30, 0.045)],
  { cdA: D.BASE_CDA * 0.4, turnStart: 1000, turnEnd: 30000, payload: 300 });
fly('Raptor 3x60/60 + NERVA 30 (300 kg)', [stage('raptor', 3, 60, 0.045), stage('raptor', 1, 60, 0.045), stage('nerva', 1, 30, 0.045)],
  { cdA: D.BASE_CDA * 0.4, turnStart: 1000, turnEnd: 30000, payload: 300 });
console.log('sail cruise 0.02c to Alpha Cen:', (4.37 / 0.02).toFixed(0), 'years');

if (!args.quick) {
  console.log('\n=== 2. Capability table: best Δv left in LEO (km/s) by payload, per cumulative tech tier ===');
  const t0 = Date.now();
  const rows = capabilityTable({ log: (s) => console.log(s) });
  const worst = Math.max(...rows.map((r) => r.added.length));
  const never = D.MISSIONS.filter((m) => !rows[rows.length - 1].feasible.includes(m.id)).map((m) => m.id);
  console.log(`most missions opened by one tier: ${worst}` + (never.length ? `  | never feasible: ${never.join(', ')}` : '  | every mission feasible by the last tier') +
    `  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const until = args.until || 'win';
console.log(`\n=== 3. Progression bot (until ${until}) ===`);
const t1 = Date.now();
const r = runBot({ until, seed: +(args.seed || 1), maxTime: 30 * 3600, statusEvery: 1800, log: (s) => console.log(s) });
const m = r.marks;
const KEY = [['alt1000', '1 km'], ['r:engSundancer', 'first engine research'], ['alt5000', '5 km (science)'],
  ['r:crew1', 'ground crew'], ['alt100000', 'Kármán line'], ['orbit', 'FIRST ORBIT'],
  ['m:moonFlyby', 'Moon flyby'], ['m:marsFlyby', 'Mars flyby'], ['r:engNerva', 'NERVA'],
  ['m:jupiterFlyby', 'Jupiter flyby'], ['m:voyager', 'Voyager / phase 3'], ['won', 'Andromeda']];
console.log('\nsummary:');
for (const [k, label] of KEY) if (m[k] !== undefined) console.log('  ' + label.padEnd(24) + fmtClock(m[k]));
console.log(`  flights ${r.flights}, dispatches ${r.dispatches}, game time ${fmtClock(r.clock)}, wall ${((Date.now() - t1) / 1000).toFixed(0)}s`);
