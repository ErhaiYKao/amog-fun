// Amog Space Program — physics & progression regression tests.
// Run: node --test tools/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../../public/amog-space-program/js/physics.js');
const D = require('../../public/amog-space-program/js/data.js');

function stage(id, n, tanks, dryFrac = D.TANK.dryFrac, vac = false) {
  const e0 = D.ENGINES[id];
  const e = vac ? { ...e0, ve: e0.ve * 1.15 } : e0;
  return { engine: e, engineCount: n, tanks, tankFuel: D.TANK.fuel, tankDry: D.TANK.fuel * dryFrac };
}
function fly(stages, opts = {}) {
  const f = new P.Flight({
    stages, payload: opts.payload ?? D.PAYLOAD_MASS,
    cdA: opts.cdA ?? D.BASE_CDA,
    turnStart: opts.turnStart ?? 0, turnEnd: opts.turnEnd ?? 0
  });
  while (f.status === 'flying' && f.t < 7200) f.advance(120);
  return f;
}

test('rocket equation is exact', () => {
  assert.ok(Math.abs(P.tsiolkovsky(3600, 4, 1) - 3600 * Math.log(4)) < 1e-9);
  // relativistic form: dv = c*tanh(ve/c * ln R)
  const c = P.C.C_LIGHT;
  const dv = P.tsiolkovskyRel(1e8, 20, 1);
  assert.ok(Math.abs(dv - c * Math.tanh((1e8 / c) * Math.log(20))) < 1e-6);
  assert.ok(dv < c);
});

test('air density is exponential and cuts off', () => {
  assert.ok(Math.abs(P.airDensity(0) - 1.225) < 1e-9);
  assert.ok(Math.abs(P.airDensity(8500) - 1.225 / Math.E) < 1e-3);
  assert.equal(P.airDensity(200e3), 0);
});

test('starter rocket flies a few hundred meters and crashes', () => {
  const f = fly([stage('fizz', 1, 1)]);
  assert.equal(f.status, 'crashed');
  assert.ok(f.maxAlt > 300 && f.maxAlt < 3000, `apogee ${f.maxAlt}`);
});

test('TWR<1 stack holds on the pad, then staggers off once light enough', () => {
  const f = fly([stage('fizz', 1, 3)]);
  // burns in place until TWR passes 1, then flies (weakly) — never stuck
  assert.notEqual(f.status, 'flying');
  assert.ok(f.maxAlt > 0, 'should eventually lift off');
  assert.ok(f.maxAlt < 20e3, `weak late liftoff only, got ${f.maxAlt}`);
});

test('flagship config achieves orbit (progression gate)', () => {
  const m3 = 0.05, a3 = D.BASE_CDA * 0.4;
  const f = fly(
    [stage('raptor', 1, 24, m3), stage('merlin', 1, 12, m3, true), stage('kestrel', 1, 4, m3, true)],
    { cdA: a3, turnStart: 500, turnEnd: 20000 });
  assert.equal(f.status, 'orbit');
  assert.ok(f.periapsis > P.C.ORBIT_MIN);
});

test('NERVA upper stage yields a mission-capable budget', () => {
  const m3 = 0.05, a3 = D.BASE_CDA * 0.4;
  const f = fly(
    [stage('raptor', 2, 30, m3), stage('nerva', 1, 14, m3, true)],
    { cdA: a3, turnStart: 500, turnEnd: 20000 });
  assert.equal(f.status, 'orbit');
  assert.ok(f.remainingDv() > 3000, `budget ${f.remainingDv()}`);
});

test('under-powered guided build does NOT reach orbit', () => {
  const m2 = 0.065, a3 = D.BASE_CDA * 0.4;
  const f = fly(
    [stage('merlin', 1, 20, m2), stage('kestrel', 1, 8, m2)],
    { cdA: a3, turnStart: 500, turnEnd: 25000 });
  assert.notEqual(f.status, 'orbit');
});

test('every guided flight terminates (no hangs)', () => {
  const combos = [
    [[stage('kestrel', 1, 7)], { cdA: D.BASE_CDA * 0.55 }],
    [[stage('merlin', 1, 14)], { cdA: D.BASE_CDA * 0.55, turnStart: 500, turnEnd: 20000 }],
    [[stage('raptor', 1, 24, 0.05), stage('merlin', 1, 12, 0.05, true)],
      { cdA: D.BASE_CDA * 0.4, turnStart: 500, turnEnd: 60000 }],
  ];
  for (const [stages, opts] of combos) {
    const f = fly(stages, opts);
    assert.notEqual(f.status, 'flying', `hung: ${JSON.stringify(opts)}`);
  }
});

test('mission data is consistent', () => {
  const ids = new Set(D.MISSIONS.map(m => m.id));
  for (const m of D.MISSIONS) {
    if (m.requires) assert.ok(ids.has(m.requires), `${m.id} requires unknown ${m.requires}`);
    if (m.assistDv) assert.ok(m.assistDv < m.dv, `${m.id} assist should discount`);
    assert.ok(m.dv > 0 && m.funds > 0 && m.sci > 0 && m.time > 0);
    assert.ok(m.cost > 0 && m.cost < m.funds, `${m.id} must be net-positive`);
  }
});

test('research prerequisites all exist', () => {
  const ids = new Set(D.RESEARCH.map(r => r.id));
  for (const r of D.RESEARCH) {
    for (const req of r.requires || []) assert.ok(ids.has(req), `${r.id} requires unknown ${req}`);
  }
});

test('economy sanity', () => {
  assert.equal(D.launchScience(4000), 0);
  assert.ok(D.launchScience(100e3) > 0);
  // science saturates with altitude like funds do — no straight-up NERVA farms:
  // 150x the altitude of 200km must pay less than 3x the science
  assert.ok(D.launchScience(30000e3) < 3 * D.launchScience(200e3),
    `sci ${D.launchScience(30000e3)} vs ${D.launchScience(200e3)}`);
  // orbit pays far better than a straight-up flight to silly altitude
  const lofted = D.launchPayout(2000e3, 6000, false, 1);
  const orbital = D.launchPayout(180e3, 7800, true, 1);
  assert.ok(orbital > lofted, `orbital ${orbital} vs lofted ${lofted}`);
  assert.ok(isFinite(D.fmt(0)) || typeof D.fmt(0) === 'string');
  assert.equal(D.fmt(1234567).endsWith('M'), true);
});
