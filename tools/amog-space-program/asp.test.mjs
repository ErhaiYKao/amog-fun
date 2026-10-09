// Amog Space Program — physics, progression and economy regression tests.
// Run: node --test tools/amog-space-program/asp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
// Node 22+ has an experimental localStorage that warns when touched; the
// game only needs a plain key/value store.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k) } });
const { runBot, seeded } = await import('./bot.mjs');
const require = createRequire(import.meta.url);
const P = require('../../public/amog-space-program/js/physics.js');
const D = require('../../public/amog-space-program/js/data.js');
const G = require('../../public/amog-space-program/js/game.js');

function stage(id, n, tanks, dryFrac = D.TANK.dryFrac, vac = false) {
  const e0 = D.ENGINES[id];
  const e = vac && e0.vac ? { ...e0, ve: e0.ve * e0.vac } : e0;
  return { engine: e, engineCount: n, tanks, tankFuel: D.TANK.fuel, tankDry: D.TANK.fuel * dryFrac * (e0.dryMult || 1) };
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
// a clean game for each test
function fresh() {
  G.state = G.freshState();
  G.flight = null; G.flightMeta = null; G.log = []; G.ledger = {}; G._autoT = 0;
  G.missionHold = false; G.listeners = {}; G.warp = 1;
  G.rng = seeded(7);
  return G.state;
}
function researchAll(pred) {
  for (const r of D.RESEARCH) if (pred(r)) G.state.research[r.id] = true;
}
const phase1 = (r) => !r.requiresOrbit && !r.requiresMission && !r.requiresStar;

// ---- Physics ----------------------------------------------------------------

test('rocket equation is exact', () => {
  assert.ok(Math.abs(P.tsiolkovsky(3600, 4, 1) - 3600 * Math.log(4)) < 1e-9);
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

test('starter rocket flies about a kilometer and crashes', () => {
  const f = fly([stage('fizz', 1, 1)]);
  assert.equal(f.status, 'crashed');
  assert.ok(f.maxAlt > 300 && f.maxAlt < 3000, `apogee ${f.maxAlt}`);
});

test('TWR<1 stack holds on the pad, then staggers off once light enough', () => {
  const f = fly([stage('fizz', 1, 3)]);
  assert.notEqual(f.status, 'flying');
  assert.ok(f.maxAlt > 0, 'should eventually lift off');
  assert.ok(f.maxAlt < 20e3, `weak late liftoff only, got ${f.maxAlt}`);
});

test('flagship chemical config achieves orbit (progression gate)', () => {
  const m3 = 0.055, a3 = D.BASE_CDA * 0.4;
  const f = fly(
    [stage('raptor', 1, 28, m3), stage('merlin', 1, 14, m3, true), stage('kestrel', 1, 5, m3, true)],
    { cdA: a3, turnStart: 1000, turnEnd: 30000 });
  assert.equal(f.status, 'orbit');
  assert.ok(f.periapsis > P.C.ORBIT_MIN);
  assert.ok(f.remainingDv() > 300, 'with a little to spare');
});

test('under-powered guided build does NOT reach orbit', () => {
  const m2 = 0.07, a3 = D.BASE_CDA * 0.4;
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

test('NERVA is an upgrade over hydrolox, not a cliff', () => {
  // same stack, swap only the top stage engine: a real gain, but bounded
  const lower = (dry) => [stage('raptor', 3, 60, dry), stage('raptor', 1, 60, dry, true), stage('raptor', 1, 40, dry, true)];
  const opts = { cdA: D.BASE_CDA * 0.4, turnStart: 1000, turnEnd: 30000, payload: 300 };
  const h = fly([...lower(0.045), stage('hydra', 1, 30, 0.045)], opts);
  const n = fly([...lower(0.045), stage('nerva', 1, 30, 0.045)], opts);
  assert.equal(h.status, 'orbit'); assert.equal(n.status, 'orbit');
  const gain = n.remainingDv() / h.remainingDv();
  assert.ok(gain > 1.1 && gain < 1.6, `NERVA/hydra budget ratio ${gain.toFixed(2)}`);
});

// ---- Data consistency -------------------------------------------------------

test('mission data is consistent', () => {
  const ids = new Set(D.MISSIONS.map(m => m.id));
  assert.equal(ids.size, D.MISSIONS.length, 'duplicate mission ids');
  for (const m of D.MISSIONS) {
    if (m.requires) assert.ok(ids.has(m.requires), `${m.id} requires unknown ${m.requires}`);
    if (m.assistDv) assert.ok(m.assistDv < m.dv, `${m.id} assist should discount`);
    if (m.aeroDv) assert.ok(m.aeroDv < m.dv, `${m.id} aerobraking should discount`);
    assert.ok(m.dv > 0 && m.funds > 0 && m.sci > 0 && m.time > 0 && m.payload > 0);
    assert.ok(m.cost > 0 && m.cost < m.funds, `${m.id} must be net-positive`);
    if (m.window) assert.ok(m.window > 30);
  }
});

test('research prerequisites and gates all exist; every engine has its research', () => {
  const ids = new Set(D.RESEARCH.map(r => r.id));
  const missions = new Set(D.MISSIONS.map(m => m.id));
  const stars = new Set(D.STARS.map(s => s.id));
  assert.equal(ids.size, D.RESEARCH.length, 'duplicate research ids');
  for (const r of D.RESEARCH) {
    for (const req of r.requires || []) assert.ok(ids.has(req), `${r.id} requires unknown ${req}`);
    if (r.requiresMission) assert.ok(missions.has(r.requiresMission), `${r.id}: unknown mission`);
    if (r.requiresStar) assert.ok(stars.has(r.requiresStar), `${r.id}: unknown star`);
    assert.ok(r.cost && (r.cost.funds > 0 || r.cost.sci > 0), `${r.id} must cost something`);
  }
  for (const e of Object.values(D.ENGINES)) {
    if (e.research) assert.ok(ids.has(e.research), `${e.id}: research ${e.research} missing`);
  }
  for (const w of D.WARPS) if (w.research) assert.ok(ids.has(w.research));
});

test('economy sanity', () => {
  assert.equal(D.launchScience(4000), 0);
  assert.ok(D.launchScience(100e3) > 0);
  assert.ok(D.launchScience(30000e3) < 3 * D.launchScience(200e3));
  const lofted = D.launchPayout(2000e3, 6000, false, 1);
  const orbital = D.launchPayout(180e3, 7800, true, 1);
  assert.ok(orbital > lofted, `orbital ${orbital} vs lofted ${lofted}`);
  assert.equal(D.fmt(1234567).endsWith('M'), true);
  // tank factory stays affordable past the heavy-lift caps (no 1.5^60 blowup)
  const t = D.STRUCTURE.tanks;
  assert.ok(D.structureCost(t, 77) < 1e8, `tank #80 costs ${D.structureCost(t, 77)}`);
  assert.ok(D.structureCost(t, 5) < D.structureCost(t, 6));
});

// ---- Research → engine (no second purchase) -----------------------------------

test('researching an engine is all it takes to fly it', () => {
  const st = fresh();
  st.bestAlt = 6e3; st.funds = 1e6; st.sci = 1e4;
  assert.equal(G.engineAllowed('kestrel', 0), false);
  const r = G.researchById('engKestrel');
  const f0 = st.funds, s0 = st.sci;
  assert.ok(G.buyResearch('engKestrel'));
  assert.equal(st.funds, f0 - r.cost.funds);
  assert.equal(st.sci, s0 - r.cost.sci);
  assert.equal(G.engineAllowed('kestrel', 0), true);
  assert.ok(G.setStageEngine(0, 'kestrel'));
  assert.equal(G.launchBlocker(), '');
  // there is no separate engine shop any more
  assert.equal(G.buyEngine, undefined);
});

test('research gates: altitude, prerequisites, missions', () => {
  const st = fresh();
  st.funds = 1e9; st.sci = 1e9;
  assert.equal(G.buyResearch('engKestrel'), false, 'needs 5 km first');
  st.bestAlt = 5e3;
  assert.equal(G.buyResearch('engMerlin'), false, 'needs Kestrel first');
  assert.ok(G.buyResearch('engKestrel'));
  assert.equal(G.buyResearch('engHydra'), false, 'needs the MEO mission');
  st.gotOrbit = true; st.missionsDone.meo = 1;
  assert.ok(G.buyResearch('engHydra'));
});

test('vacuum engines and ion drives cannot be stage 1', () => {
  const st = fresh();
  st.research.engHydra = st.research.engIon = st.research.stage2 = true;
  assert.equal(G.engineAllowed('hydra', 0), false);
  assert.equal(G.engineAllowed('ion', 0), false);
  assert.equal(G.engineAllowed('hydra', 1), true);
  assert.equal(G.setStageEngine(0, 'hydra'), false);
  st.design.stages = [{ engine: 'hydra', count: 1, tanks: 2 }];
  assert.ok(G.resolveDesign().invalid);
  assert.ok(G.launchBlocker());
});

// ---- Max buttons -------------------------------------------------------------

test('max / min / clamping for stage engines and tanks', () => {
  const st = fresh();
  st.structure.tanks = 5; st.structure.engines = 2;
  assert.equal(G.setStageField(0, 'tanks', 'max'), G.maxTanks());
  assert.equal(st.design.stages[0].tanks, 7);
  assert.equal(G.setStageField(0, 'count', 'max'), 3);
  assert.equal(G.setStageField(0, 'tanks', 'min'), 0);
  assert.equal(G.setStageField(0, 'count', 'min'), 1);
  assert.equal(G.setStageField(0, 'tanks', 999), 7, 'clamped to cap');
  assert.equal(G.setStageField(0, 'count', -4), 1, 'at least one engine');
  assert.equal(G.setStageField(0, 'tanks', 'banana'), null);
  assert.equal(G.setStageField(5, 'tanks', 1), null, 'no such stage');
});

test('buy-max buys exactly what you can afford', () => {
  const st = fresh();
  const spec = D.STRUCTURE.tanks;
  let total = 0, n = 0;
  while (n < 6) total += D.structureCost(spec, n++);
  st.funds = total + D.structureCost(spec, 6) - 1;   // one short of the 7th
  assert.equal(G.buyStructureMax('tanks'), 6);
  assert.equal(st.structure.tanks, 6);
  assert.ok(st.funds < D.structureCost(spec, 6));
  // respects the tank cap (30 before heavy-lift)
  st.funds = 1e12;
  G.buyStructureMax('tanks');
  assert.equal(G.maxTanks(), 30);
  st.research.heavy1 = true;
  G.buyStructureMax('tanks');
  assert.equal(G.maxTanks(), 45);
});

// ---- Sim speed ----------------------------------------------------------------

test('sim speed: 16x from the start, faster speeds are research', () => {
  const st = fresh();
  assert.deepEqual(G.warpOptions(), [1, 2, 4, 8, 16]);
  assert.equal(G.maxWarp(), 16);
  assert.equal(G.setWarp(64), false);
  assert.ok(G.setWarp(16));
  st.research.warp1 = true;
  assert.equal(G.maxWarp(), 64);
  assert.ok(G.setWarp(32));
  st.research.warp2 = true; st.research.warp3 = true;
  assert.equal(G.maxWarp(), 1024);
});

// ---- Launch costs, crew ------------------------------------------------------

test('hardware comes out of the earnings: you can launch while broke and a flop never costs money', () => {
  const st = fresh();
  assert.equal(G.launchCost(), 0);
  st.research.engSundancer = true; st.research.engKestrel = true;
  // broke, with an expensive rocket: you can still launch
  G.setStageEngine(0, 'kestrel');
  st.funds = 0;
  assert.ok(G.launchCost() > 0);
  assert.equal(G.launchBlocker(), '');
  // a flop (aborted on the pad) earns less than its hardware and nets exactly $0
  assert.ok(G.launch(true));
  G.flight.status = 'aborted';
  const flop = G.endFlight();
  assert.ok(flop.funds < flop.cost);
  assert.equal(flop.net, 0);
  assert.equal(st.funds, 0);
  // a good flight nets earnings minus hardware
  G.setStageEngine(0, 'sundancer');
  st.design.stages[0].tanks = Math.min(2, G.maxTanks());
  const fly = () => { assert.ok(G.launch(true)); while (G.flight.status === 'flying') G.flight.advance(60); return G.endFlight(); };
  fly(); // the first one also claims one-time altitude milestones
  const before = st.funds, r = fly();
  assert.ok(r.funds > r.cost);
  assert.ok(Math.abs(r.net - (r.funds - r.cost)) < 1e-9);
  assert.ok(Math.abs(st.funds - before - r.net) < 1e-6, `gained ${st.funds - before}, net ${r.net}`);
});

test('every newly researched first-stage engine has a profitable single-stage design', () => {
  // the "research an engine, slap it on, go broke" trap from airetho's playtest
  const P = createRequire(import.meta.url)('../../public/amog-space-program/js/physics.js');
  for (const [id, cd] of [['sundancer', 1], ['kestrel', 1], ['merlin', 0.55], ['raptor', 0.55]]) {
    const e = D.ENGINES[id];
    let best = -Infinity;
    for (let t = 2; t <= 20; t += 2) {
      const f = new P.Flight({ stages: [{ engine: e, engineCount: 1, tanks: t, tankFuel: D.TANK.fuel, tankDry: D.TANK.fuel * D.TANK.dryFrac * (e.dryMult || 1) }],
        payload: D.PAYLOAD_MASS, cdA: D.BASE_CDA * cd, turnStart: 0, turnEnd: 0 });
      while (f.status === 'flying' && f.t < 3600) f.advance(60);
      best = Math.max(best, D.launchPayout(f.maxAlt, f.maxSpeed, f.status === 'orbit', 1) - (e.unit + e.tank * t));
    }
    assert.ok(best > 0, `${id}: best single-stage profit ${best}`);
  }
});

test('ground crew re-flies the last free flight on credit, never stalls', () => {
  const st = fresh();
  st.research.crew1 = true; st.autolaunch = true;
  st.lastYield = { funds: 500, sci: 1, orbit: false, cost: 100, t: 60, name: 'x' };
  st.funds = 0;
  G.tick(G.autoInterval() * 10 + 0.01);
  assert.ok(Math.abs(st.funds - 4000) < 1e-6, `funds ${st.funds}`);
  // a money-losing job nets $0 (never negative)
  st.lastYield.funds = 50; st.funds = 0;
  G.tick(G.autoInterval() * 3 + 0.01);
  assert.equal(st.funds, 0);
});

// ---- Contracts ----------------------------------------------------------------

test('contracts: board is bounded, they expire, and pay exactly once', () => {
  const st = fresh();
  st.bestAlt = 20e3; st.bestSpeed = 600;
  for (let i = 0; i < 200; i++) G.tick(10);       // 2000 s
  assert.ok(st.contracts.length <= D.CONTRACTS.board);
  assert.ok(st.contractSeq <= Math.ceil(2000 / D.CONTRACTS.every) + 1, 'rate-limited offers');
  // complete one by flying something that meets it
  const c = st.contracts.find((x) => x.kind === 'alt');
  if (c) {
    st.objective = { kind: 'contract', id: c.id };
    st.research.engSundancer = st.research.engKestrel = true;
    st.structure.tanks = 10; st.structure.engines = 3;
    st.design.stages = [{ engine: 'kestrel', count: 2, tanks: 8 }];
    st.funds = 1e6;
    const f0 = st.funds;
    assert.ok(G.launch(true));
    while (G.flight.status === 'flying') G.flight.advance(200);
    const res = G.endFlight();
    if (res.maxAlt >= c.target) {
      assert.equal(res.contract.id, c.id);
      assert.ok(!st.contracts.includes(c));
      assert.ok(st.funds > f0);
    }
  }
  // expiry
  st.contracts.forEach((x) => { x.expires = st.clock - 1; });
  G.tick(0.1);
  assert.equal(st.contracts.filter((x) => x.expires < st.clock).length, 0);
});

// ---- Missions -----------------------------------------------------------------

function orbitalState() {
  const st = fresh();
  researchAll(phase1);
  st.gotOrbit = true; st.bestAlt = 1e6; st.funds = 1e9; st.sci = 1e9;
  return st;
}

test('missions need a proven vehicle with enough payload and Δv; slots limit concurrency', () => {
  const st = orbitalState();
  const m = G.missionById('weather');
  assert.equal(G.dispatch('weather'), null, 'no vehicle yet');
  st.vehicles.push({ key: 'a', name: 'A', payload: 100, budget: 5000, ionDv: 0, stages: [{ engine: 'merlin', count: 1, tanks: 10 }] });
  assert.equal(G.dispatch('weather'), null, 'payload too light');
  st.vehicles.push({ key: 'b', name: 'B', payload: 300, budget: 400, ionDv: 0, stages: [{ engine: 'merlin', count: 1, tanks: 10 }] });
  const am = G.dispatch('weather', 'direct', true);
  assert.ok(am);
  assert.equal(G.missionSlots(), 1);
  assert.equal(G.dispatch('weather'), null, 'slot busy');
  st.research.dsn1 = true;
  assert.ok(G.dispatch('weather'));
  // completion pays, repeats pay less
  G.tick(m.time + 1);
  assert.equal(st.missions.length, 0);
  assert.equal(st.missionsDone.weather, 2);
  const r1 = G.missionReward(m, 1), r5 = G.missionReward(m, 5), r50 = G.missionReward(m, 50);
  assert.ok(r1.funds < m.funds && r5.funds < r1.funds);
  assert.ok(r50.funds >= m.funds * D.REPEAT.fundsFloor - 1e-9);
  assert.ok(r50.sci < 1e-6 * m.sci + 1, 'repeat science dries up');
});

test('launch windows: off-window needs more Δv; auto-dispatch waits for the window', () => {
  const st = orbitalState();
  st.missionsDone = { weather: 1, meo: 1, moonFlyby: 1 };
  const m = G.missionById('venusFlyby');
  let tOpen = -1, tShut = -1;
  for (let t = 0; t < m.window * 2; t++) {
    if (G.missionWindow(m, t).open && tOpen < 0) tOpen = t;
    if (!G.missionWindow(m, t).open && tShut < 0) tShut = t;
  }
  assert.ok(tOpen >= 0 && tShut >= 0);
  assert.equal(G.missionNeed(m, 'direct', tShut), Math.round(m.dv * D.WINDOW.offPenalty));
  assert.equal(G.missionNeed(m, 'direct', tOpen), m.dv);
  // auto-dispatch: only inside the window
  st.research.dispatch = true;
  st.vehicles.push({ key: 'v', name: 'V', payload: 500, budget: m.dv * 2, ionDv: 0, stages: [{ engine: 'merlin', count: 1, tanks: 10 }] });
  st.clock = tShut;
  G.setAutoMission('venusFlyby', true);
  G.tick(0.01);
  assert.equal(st.missions.length, 0, 'waits for the window');
  st.clock = tOpen + (tOpen < tShut ? 0 : m.window);
  while (!G.missionWindow(m).open) st.clock += 1;
  G.tick(0.01);
  assert.equal(st.missions.length, 1);
});

test('flying a mission objective to orbit sends the probe and records the vehicle', () => {
  const st = orbitalState();
  st.missionsDone = {};
  st.structure.tanks = 28; st.structure.engines = 8;
  st.design = { stages: [{ engine: 'raptor', count: 3, tanks: 30 }, { engine: 'raptor', count: 1, tanks: 30 },
    { engine: 'kestrel', count: 1, tanks: 8 }], guidanceOn: true, turnStart: 1000, turnEnd: 30000 };
  assert.ok(G.setObjective({ kind: 'mission', id: 'weather' }));
  assert.equal(G.resolveDesign().probe, 300);
  assert.ok(G.launch(true));
  while (G.flight.status === 'flying') G.flight.advance(200);
  const res = G.endFlight();
  assert.equal(res.status, 'orbit');
  assert.ok(res.mission, res.missionWhy);
  assert.equal(st.vehicles.length, 1);
  assert.equal(st.vehicles[0].payload, 300);
  assert.equal(res.satDeployed, false, 'the payload left for its mission');
});

// ---- Phase 3: no unlimited-money probes ---------------------------------------

function phase3State() {
  const st = orbitalState();
  researchAll(() => true);
  D.MISSIONS.forEach((m) => { st.missionsDone[m.id] = 1; });
  st.funds = 1e12;
  return st;
}

test('repeat flybys pay no funds and a vanishing amount of science', () => {
  const st = phase3State();
  const star = G.starById('alphacen');
  const first = G.starReward(star, 'flyby');
  assert.ok(first.funds > 0);
  st.flybys.alphacen = 1;
  let totalSci = 0;
  for (let k = 1; k < 60; k++) {
    st.flybys.alphacen = k;
    const r = G.starReward(star, 'flyby');
    assert.equal(r.funds, 0);
    totalSci += r.sci;
  }
  // geometric series: all repeats together are worth less than the first visit
  assert.ok(totalSci < first.sci, `repeat science ${totalSci} vs first ${first.sci}`);
});

test('spamming cheap probes cannot farm money (shipyard slots + no repeat funds)', () => {
  const st = phase3State();
  st.colonies = {};
  st.research.yard2 = st.research.yard3 = st.research.yard4 = false;
  assert.equal(G.shipSlots(), 1);
  const firstVisit = G.starReward(G.starById('heliopause'), 'flyby').funds;
  assert.ok(G.launchShip('sail', 1, 'flyby', 'heliopause'));
  assert.equal(G.launchShip('sail', 1, 'flyby', 'heliopause'), false, 'one slot');
  // fly the same cheap target over and over for a long time
  const f0 = st.funds;
  let spent = 0;
  for (let i = 0; i < 400; i++) {
    G.tick(5);
    if (!st.ships.length) {
      spent += G.shipCost('sail', 1, 'flyby', 'heliopause');
      G.launchShip('sail', 1, 'flyby', 'heliopause');
    }
  }
  assert.ok(st.flybys.heliopause > 10, 'it really did fly many times');
  // net funds gained is at most the first-visit payout
  assert.ok(st.funds - f0 <= firstVisit + 1, `net ${st.funds - f0} vs first ${firstVisit}`);
});

test('precursor targets cannot be colonized; colonies need a brake; stars unlock in order', () => {
  const st = phase3State();
  assert.match(G.shipBlocker('orion', 20, 'colonize', 'heliopause'), /flyby only/);
  // a cheap sail can't skip ahead to the far, valuable stars
  assert.match(G.shipBlocker('sail', 1, 'flyby', 'kepler'), /nav data/);
  for (const s of D.STARS) if (s.id !== 'kepler' && D.STARS.indexOf(s) < D.STARS.findIndex((x) => x.id === 'kepler')) st.flybys[s.id] = 1;
  assert.equal(G.shipBlocker('sail', 1, 'flyby', 'kepler'), '');
  st.research.magsail = false;
  assert.match(G.shipBlocker('sail', 1, 'colonize', 'alphacen'), /brake/);
  // colony ships carry settlers: they cost a share of the star's value
  const ac = G.starById('alphacen');
  assert.ok(G.shipCost('orion', 20, 'colonize', 'alphacen') >= ac.funds * D.COLONY.settlers);
  const rw = G.starReward(ac, 'colonize');
  assert.ok(rw.colony && rw.funds > 0 && rw.funds < G.shipCost('sail', 1, 'colonize', 'alphacen'),
    'a colony repays part of its settlers; the ×2 income is the real prize');
  // and star rewards ignore income multipliers (that was the old runaway)
  st.colonies = { barnard: true, sirius: true };
  assert.equal(G.starReward(ac, 'colonize').funds, rw.funds);
});

test('long idle with every automation on stays linear (no runaway loop)', () => {
  const st = phase3State();
  st.colonies = {};
  st.sats = G.satCap();
  st.autolaunch = true;
  st.lastYield = { funds: 20000, sci: 30, orbit: true, cost: 5000, t: 600, name: 'x' };
  st.vehicles.push({ key: 'v', name: 'V', payload: 1000, budget: 20000, ionDv: 0, stages: [{ engine: 'raptor', count: 1, tanks: 10 }] });
  D.MISSIONS.forEach((m) => G.setAutoMission(m.id, true));
  const f0 = st.funds;
  G.fastForward(3600);
  const h1 = st.funds - f0;
  G.fastForward(3600);
  const h2 = st.funds - f0 - h1;
  assert.ok(h1 > 0);
  // second hour earns about the same as the first (repeats decay to a floor)
  assert.ok(h2 < h1 * 1.2, `hour 1 ${h1}, hour 2 ${h2}`);
});

// ---- Saves ----------------------------------------------------------------------

function v1Save() {
  return {
    funds: 123456, sci: 789, bestAlt: 250000, bestSpeed: 7900, gotOrbit: true, bestBudget: 2500,
    milestones: { alt300: true, alt1000: true, orbit: true },
    research: { aero1: true, mc1: true, mc2: true, engKestrel: true, dsn: true, guidance: true, stage2: true },
    engines: { fizz: true, sundancer: true, kestrel: true, merlin: true },
    structure: { tanks: 10, engines: 3, constellation: 1 },
    design: { stages: [{ engine: 'merlin', count: 2, tanks: 20 }, { engine: 'kestrel', count: 1, tanks: 8 }],
      turnStart: 500, turnEnd: 30000, guidanceOn: true },
    sats: 6, missionsDone: { moonFlyby: 2 },
    activeMission: { id: 'moonOrbit', t0: Date.now() / 1000 - 10, dur: 30, mult: 1.5 },
    autolaunch: true, lastYield: { funds: 5000, sci: 20, orbit: true },
    ships: [], colonies: {}, flybys: { alphacen: true },
    warpLevel: 2, outsourced: 3, totalLaunches: 200, timePlayed: 5000,
    won: false, wonShown: false, lastSave: Date.now() - 1000
  };
}

test('v1 saves migrate: engines become research, nothing earned is lost, no windfall', () => {
  fresh();
  const s = G.sanitizeState(v1Save());
  assert.equal(s.v, G.SAVE_VERSION);
  assert.equal(s.migratedFrom, 1);
  assert.equal(s.migrationShown, false, 'the player gets a what-changed notice');
  assert.equal(s.funds, 123456); assert.equal(s.sci, 789);
  // owned engines -> researched
  for (const id of ['engSundancer', 'engKestrel', 'engMerlin']) assert.ok(s.research[id], id);
  // renamed research
  assert.ok(s.research.crew1 && s.research.crew2 && s.research.dsn1);
  assert.equal(s.research.mc1, undefined);
  // 256x used to be free: veterans keep it
  assert.ok(s.research.warp1 && s.research.warp2);
  // active mission moved onto the game clock, keeps its landing bonus
  assert.equal(s.missions.length, 1);
  assert.equal(s.missions[0].id, 'moonOrbit');
  assert.ok(s.missions[0].dur > 0 && s.missions[0].dur <= 30);
  assert.equal(s.missions[0].mult, 1.5);
  assert.equal(s.activeMission, undefined);
  // new intro missions credited so nothing already open gets re-locked
  assert.ok(s.missionsDone.weather && s.missionsDone.meo && s.missionsDone.moonFlyby === 2);
  assert.equal(s.flybys.alphacen, 1);
  assert.equal(s.engines, undefined); assert.equal(s.bestBudget, undefined);
  // milestones already flown past are claimed without paying
  assert.ok(s.milestones.alt100000 && s.milestones.alt200000 && s.milestones.spd7800);
  assert.equal(s.milestones.alt1000000, undefined);
  // the crew needs a fresh flight under the new economy
  assert.equal(s.lastYield, null);
  // design survived and is valid
  G.state = s;
  G.clampDesign();
  assert.equal(G.resolveDesign().invalid, '');
  assert.equal(s.design.stages[0].engine, 'merlin');
});

test('migration via import, export/import round-trip, junk and future saves rejected', () => {
  fresh();
  const enc = (o) => Buffer.from(unescape(encodeURIComponent(JSON.stringify(o))), 'binary').toString('base64');
  globalThis.atob = (b) => Buffer.from(b, 'base64').toString('binary');
  globalThis.btoa = (b) => Buffer.from(b, 'binary').toString('base64');
  assert.ok(G.importSave(enc(v1Save())));
  assert.equal(G.state.v, G.SAVE_VERSION);
  G.state.funds = 42;
  const out = G.exportSave();
  fresh();
  assert.ok(G.importSave(out));
  assert.equal(G.state.funds, 42);
  assert.equal(G.importSave('not base64 at all %%%'), false);
  assert.equal(G.importSave(enc({ v: 99, funds: 1 })), false);
  // garbage fields are repaired, not fatal
  const junk = G.sanitizeState({ v: 2, funds: -5, sci: 'lots', design: { stages: [{ engine: 'warpdrive' }] },
    missions: [{ id: 'nope' }], vehicles: [null, { payload: 'x' }], contracts: 7, ships: [{ engine: 'sail' }] });
  assert.equal(junk.funds, 0); assert.equal(junk.sci, 0);
  assert.equal(junk.design.stages[0].engine, 'fizz');
  assert.deepEqual(junk.missions, []); assert.deepEqual(junk.vehicles, []);
  assert.deepEqual(junk.contracts, []); assert.deepEqual(junk.ships, []);
});

test('offline progress advances missions and the crew on the game clock', () => {
  const st = orbitalState();
  st.research.crew1 = true; st.autolaunch = true;
  st.lastYield = { funds: 1000, sci: 0, orbit: false, cost: 0, t: 30, name: 'x' };
  st.missions.push({ uid: 1, id: 'weather', t0: 0, dur: 100, traj: 'direct', mult: 1, ion: false });
  const f0 = st.funds;
  G.fastForward(600);
  assert.equal(st.missions.length, 0);
  assert.equal(st.missionsDone.weather, 1);
  assert.ok(st.funds > f0 + 600 / G.autoInterval() * 1000 * 0.9);
});

// ---- Pacing guard (the headless bot plays the real game) ----------------------

test('early game: rewarding first minutes, but no longer a sprint to space', () => {
  const r = runBot({ until: (s) => s.bestAlt >= 100e3, maxTime: 3 * 3600, seed: 3 });
  const m = r.marks;
  assert.ok(m.alt1000 !== undefined && m.alt1000 < 60, `1 km at ${m.alt1000}s`);
  assert.ok(m['r:engSundancer'] < 4 * 60, `first research at ${m['r:engSundancer']}s`);
  assert.ok(m.alt5000 < 8 * 60, `science by ${m.alt5000}s`);
  assert.ok(m.alt100000 > 6 * 60, `Kármán line already at ${m.alt100000}s`);
});
