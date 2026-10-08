// Amog Space Program — headless progression bot.
// Plays the real game.js (same physics, economy, research, missions, stars)
// from a fresh save with a greedy-but-sensible strategy, and records a
// timeline. Used by balance-sim.mjs (prints the progression curve) and by a
// quick early-game check in asp.test.mjs.
//
// Time model: a manual flight costs `overhead` seconds of player time plus
// flight time / sim speed (the bot always uses the fastest unlocked warp).
// Everything else (auto-launch, satellites, missions in transit, contracts,
// starships) runs on the game clock exactly as in the browser.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../../public/amog-space-program/js/physics.js');
const D = require('../../public/amog-space-program/js/data.js');
const G = require('../../public/amog-space-program/js/game.js');

export { P, D, G };

export function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- Design search ----------------------------------------------------------

function techSig() {
  const r = G.state.research;
  // everything that changes how a given design flies
  return [G.dryFrac(), G.cdA(), !!r.vacNozzles, !!r.guidance,
    Object.keys(D.ENGINES).map(G.engineVe).join('/')].join(',');
}

const simCache = new Map();
function sim(design, payload) {
  const key = techSig() + '|' + payload + '|' + JSON.stringify(design);
  let r = simCache.get(key);
  if (r) return r;
  const out = G.simulate(design, payload);
  if (!out) r = { ok: false };
  else {
    const f = out.flight;
    r = {
      ok: true, status: f.status, maxAlt: f.maxAlt, maxSpeed: f.maxSpeed, t: f.t,
      budget: f.status === 'orbit' ? f.remainingDv() : f.status === 'escape' ? f.remainingDv() + 3200 : 0,
      spaceDv: out.resolved.spaceDv
    };
  }
  if (simCache.size > 200000) simCache.clear();
  simCache.set(key, r);
  return r;
}

function engineIds(stageIndex) {
  return Object.keys(D.ENGINES).filter((id) => G.engineAllowed(id, stageIndex));
}

function neighbors(d) {
  const out = [];
  const maxT = G.maxTanks(), maxE = G.maxEngines();
  d.stages.forEach((s, i) => {
    for (const dt of [-8, -3, -1, 1, 3, 8]) {
      const v = Math.max(0, Math.min(maxT, s.tanks + dt));
      if (v !== s.tanks) { const n = clone(d); n.stages[i].tanks = v; out.push(n); }
    }
    if (s.tanks !== maxT) { const n = clone(d); n.stages[i].tanks = maxT; out.push(n); }
    for (const dc of [-1, 1]) {
      const v = Math.max(1, Math.min(maxE, s.count + dc));
      if (v !== s.count) { const n = clone(d); n.stages[i].count = v; out.push(n); }
    }
    for (const e of engineIds(i)) {
      if (e !== s.engine) { const n = clone(d); n.stages[i].engine = e; out.push(n); }
    }
  });
  if (d.stages.length < G.maxStages()) {
    for (const e of engineIds(1)) {
      const n = clone(d); n.stages.push({ engine: e, count: 1, tanks: Math.min(4, maxT) }); out.push(n);
    }
    // insert a new middle stage
    if (d.stages.length >= 2) {
      const n = clone(d); n.stages.splice(1, 0, clone(d.stages[1])); out.push(n);
    }
  }
  if (d.stages.length > 1) {
    for (let i = 0; i < d.stages.length; i++) {
      const n = clone(d); n.stages.splice(i, 1);
      if (G.engineAllowed(n.stages[0].engine, 0)) out.push(n);
    }
  }
  if (G.state.research.guidance) {
    for (const [ts, te] of [[500, 12000], [500, 20000], [1000, 30000], [1500, 42000], [2000, 55000]]) {
      if (d.guidanceOn && d.turnStart === ts && d.turnEnd === te) continue;
      const n = clone(d); n.guidanceOn = true; n.turnStart = ts; n.turnEnd = te; out.push(n);
    }
    if (d.guidanceOn) { const n = clone(d); n.guidanceOn = false; out.push(n); }
  }
  return out;
}

function valid(d) {
  if (d.stages.length > G.maxStages()) return false;
  return d.stages.every((s, i) => G.engineAllowed(s.engine, i) &&
    s.count <= G.maxEngines() && s.tanks <= G.maxTanks() && s.count >= 1 && s.tanks >= 0);
}

const bestMemo = new Map(); // objective name -> last best design (warm start)

function optimize(name, payload, score, extraSeeds = []) {
  const seeds = [];
  if (bestMemo.has(name)) seeds.push(bestMemo.get(name));
  seeds.push(...extraSeeds);
  seeds.push(clone(G.state.design));
  seeds.push({ stages: [{ engine: 'fizz', count: 1, tanks: 1 }], turnStart: 1000, turnEnd: 30000, guidanceOn: false });
  let best = null;
  const seen = new Set();
  for (let seed of seeds) {
    seed = G.clampDesign(clone(seed));
    const sk = JSON.stringify(seed);
    if (seen.has(sk)) continue;
    seen.add(sk);
    let cur = seed, cs = score(sim(cur, payload), cur);
    for (let it = 0; it < 80; it++) {
      let bn = null, bs = cs;
      for (const n of neighbors(cur)) {
        if (!valid(n)) continue;
        const s = score(sim(n, payload), n);
        if (s > bs + 1e-9) { bs = s; bn = n; }
      }
      if (!bn) break;
      cur = bn; cs = bs;
    }
    if (!best || cs > best.score) best = { design: cur, score: cs };
  }
  if (best) bestMemo.set(name, best.design);
  if (best) best.res = sim(best.design, payload);
  return best;
}

// Best orbital dv budget for a payload. ion: also count ion-tug dv.
function budgetScoreFn(ion) {
  return (res, design) => {
    if (!res.ok) return -Infinity;
    const cost = G.designCost(design);
    if (res.status === 'orbit') return 1e6 + res.budget + (ion ? res.spaceDv : 0) - cost * 1e-4;
    return res.maxSpeed + res.maxAlt * 1e-4;
  };
}

function capSeeds() {
  const T = G.maxTanks(), E = G.maxEngines(), S = G.maxStages();
  const has = (e) => G.engineUnlocked(e);
  const g = { guidanceOn: true, turnStart: 1000, turnEnd: 30000 };
  const big = has('raptor') ? 'raptor' : has('merlin') ? 'merlin' : 'kestrel';
  const up = has('nerva') ? 'nerva' : has('hydra') ? 'hydra' : big;
  const seeds = [];
  for (const n of [1, 2, 3, Math.min(E, 5)]) {
    const st = [{ engine: big, count: n, tanks: T }];
    if (S >= 2) st.push({ engine: big, count: 1, tanks: T });
    if (S >= 3) st.push({ engine: has('hydra') ? 'hydra' : 'kestrel', count: 1, tanks: Math.ceil(T / 2) });
    if (S >= 4) st.push({ engine: up, count: 1, tanks: Math.ceil(T / 2) });
    seeds.push({ stages: st, ...g });
    if (S >= 3 && has('hydra')) {
      seeds.push({ stages: [{ engine: big, count: n + 1, tanks: T }, { engine: 'hydra', count: 2, tanks: T },
        { engine: up, count: 1, tanks: Math.ceil(T / 2) }].slice(0, S), ...g });
    }
  }
  if (has('ion') && S >= 3) {
    seeds.push({ stages: [{ engine: big, count: 3, tanks: T }, { engine: big, count: 1, tanks: T },
      { engine: 'ion', count: 2, tanks: 4 }, { engine: up, count: 1, tanks: Math.ceil(T / 3) }].slice(0, S), ...g });
  }
  return seeds;
}

export function bestBudget(payload, ion = false) {
  const best = optimize((ion ? 'capi:' : 'cap:') + payload, payload, budgetScoreFn(ion), capSeeds());
  if (!best || best.res.status !== 'orbit') return { budget: 0, spaceDv: 0, design: best && best.design };
  return { budget: best.res.budget, spaceDv: best.res.spaceDv, design: best.design, cost: G.designCost(best.design) };
}

// Cumulative tech tiers through phase 2, for the capability table.
const P1_RESEARCH = D.RESEARCH.filter((r) => !r.requiresOrbit && !r.requiresMission && !r.requiresStar).map((r) => r.id);
export const TIERS = [
  { name: 'first orbit (T25, 3 stages)', research: [], tanks: 25 },
  { name: '+ T30', research: ['crew3', 'reuse'], tanks: 30 },
  { name: '+ hydrolox', research: ['engHydra'], tanks: 30 },
  { name: '+ 4th stage', research: ['stage4'], tanks: 30 },
  { name: '+ heavy-lift I (T45)', research: ['heavy1'], tanks: 45 },
  { name: '+ aerobraking', research: ['aerobrake'], tanks: 45 },
  { name: '+ ion', research: ['engIon'], tanks: 45 },
  { name: '+ heavy-lift II (T60)', research: ['heavy2'], tanks: 60 },
  { name: '+ materials IV', research: ['mat4'], tanks: 60 },
  { name: '+ NERVA', research: ['engNerva'], tanks: 60 },
  { name: '+ gravity assists', research: ['slingshot'], tanks: 60 },
  { name: '+ heavy-lift III (T80)', research: ['heavy3'], tanks: 80 },
  { name: '+ bimodal NERVA', research: ['nerva2'], tanks: 80 }
];

export function capabilityTable(opts = {}) {
  const payloads = opts.payloads || [...new Set(D.MISSIONS.map((m) => m.payload))].sort((a, b) => a - b);
  const say = opts.log || (() => {});
  simCache.clear(); bestMemo.clear();
  G.state = G.freshState();
  const s = G.state;
  P1_RESEARCH.forEach((id) => { s.research[id] = true; });
  s.gotOrbit = true; s.bestAlt = 1e6;
  s.structure.engines = D.STRUCTURE.engines.max - D.STRUCTURE.engines.start;
  const rows = [];
  let feasiblePrev = new Set();
  for (const tier of TIERS) {
    tier.research.forEach((id) => { s.research[id] = true; });
    s.structure.tanks = tier.tanks - D.STRUCTURE.tanks.start;
    const cap = {}, capIon = {};
    for (const p of payloads) {
      cap[p] = bestBudget(p, false);
      capIon[p] = s.research.engIon ? bestBudget(p, true) : cap[p];
    }
    const feasible = new Set();
    for (const m of D.MISSIONS) {
      const traj = G.canAssist(m) ? 'assist' : 'direct';
      // compare with the in-window requirement
      const need = Math.round(G.missionNeed(m, traj, windowOpenTime(m)));
      const c = m.ionOk ? capIon[m.payload] : cap[m.payload];
      const avail = c.budget + (m.ionOk ? c.spaceDv : 0);
      if (avail >= need) feasible.add(m.id);
    }
    const added = [...feasible].filter((id) => !feasiblePrev.has(id));
    rows.push({ tier: tier.name, cap, capIon, feasible: [...feasible], added });
    say(tier.name.padEnd(30) + payloads.map((p) => (p + 'kg ' + (cap[p].budget / 1000).toFixed(2)).padStart(12)).join('') +
      '  | +' + added.length + ': ' + added.join(', '));
    feasiblePrev = feasible;
  }
  return rows;
}

function windowOpenTime(m) {
  if (!m.window) return 0;
  for (let t = 0; t < m.window; t += 1) if (G.missionWindow(m, t).open) return t;
  return 0;
}

// ---- The bot ----------------------------------------------------------------

export function runBot(opts = {}) {
  const until = opts.until || 'win';
  const maxTime = opts.maxTime || 40 * 3600;
  const overhead = opts.overhead ?? 4;
  const grind = opts.grind || 'smart'; // 'smart': grind by hand only until the ground crew exists
  const say = opts.log || (() => {});
  simCache.clear(); bestMemo.clear();
  G.state = G.freshState();
  G.rng = seeded(opts.seed || 1);
  G.log = []; G.flight = null; G.flightMeta = null; G._autoT = 0; G.missionHold = false;
  G.listeners = {}; G.ledger = {};
  const statusEvery = opts.statusEvery || 0;
  let nextStatus = statusEvery;
  const status = () => {
    const s = st(), r = G.incomeRates();
    const led = Object.entries(G.ledger).map(([k, v]) => k + ' $' + D.fmt(v.funds) + '/' + D.fmt(v.sci) + '⚗').join(', ');
    say(fmtClock(s.clock) + '  [status] $' + D.fmt(s.funds) + ' ' + D.fmt(s.sci) + '⚗  rate $' + D.fmt(r.funds) + '/s ' +
      D.fmt(r.sci) + '⚗/s  alt ' + D.fmtDist(s.bestAlt) + '  T' + G.maxTanks() + ' E' + G.maxEngines() + ' S' + G.maxStages() +
      ' W' + G.maxWarp() + '  sats ' + s.sats + '/' + G.satCap() + '  | ' + led);
  };
  const st = () => G.state;
  const timeline = [];
  const marks = {};
  const mark = (key, text) => {
    if (marks[key] !== undefined) return;
    marks[key] = st().clock;
    timeline.push({ t: st().clock, key, text });
    say(fmtClock(st().clock) + '  ' + text);
  };
  G.on('missionDone', (e) => { if (e.first) mark('m:' + e.mission.id, 'MISSION ' + e.mission.name); });
  G.on('shipArrived', (e) => mark('s:' + e.star.id + (e.reward.colony ? ':col' : ''),
    (e.reward.colony ? 'COLONY ' : 'flyby ') + e.star.name));
  let flights = 0, dispatches = 0;

  function advance(sec) {
    let left = sec;
    while (left > 1e-9) { const dt = Math.min(1, left); G.tick(dt); left -= dt; }
  }

  function fly(design, objective) {
    const s = st();
    s.design = clone(design);
    G.clampDesign();
    s.objective = objective || null;
    if (!G.launch(true)) return null;
    const f = G.flight;
    while (f.status === 'flying' && f.t < 7200) f.advance(120);
    if (f.status === 'flying') f.status = 'aborted';
    advance(overhead + f.t / G.maxWarp());
    flights++;
    return G.endFlight();
  }

  function buyStuff() {
    const s = st();
    let bought = true;
    while (bought) {
      bought = false;
      for (const r of D.RESEARCH) {
        if (G.canResearch(r.id)) {
          G.buyResearch(r.id); bought = true;
          mark('r:' + r.id, 'research ' + r.name);
        }
      }
      // structure: keep enough cash for a launch
      const reserve = Math.max(G.launchCost() * 2, 0);
      for (const key of ['tanks', 'engines']) {
        if (G.structureMaxed(key)) continue;
        const c = D.structureCost(D.STRUCTURE[key], s.structure[key]);
        if (c <= (s.funds - reserve) * 0.6) { G.buyStructure(key); bought = true; }
      }
      if (s.gotOrbit && !G.structureMaxed('constellation') && s.sats >= G.satCap()) {
        const c = D.structureCost(D.STRUCTURE.constellation, s.structure.constellation);
        if (c <= (s.funds - reserve) * 0.3) { G.buyStructure('constellation'); bought = true; }
      }
      if (G.phase() >= 3 && s.warpLevel < 14 && G.warpUpCost() <= s.sci * 0.5) {
        G.buyWarp(); bought = true;
      }
      // science-bound with money to spare: outsource a study
      const sciShort = D.RESEARCH.some((r) => !s.research[r.id] && G.researchVisible(r) &&
        s.funds >= G.researchCost(r).funds && s.sci < G.researchCost(r).sci);
      if (sciShort && D.outsourceCost(s.outsourced) <= (s.funds - reserve) * 0.25) {
        G.buyOutsource(); bought = true;
      }
    }
  }

  // income per second of player time for a flight result
  function rate(res, design) {
    if (!res.ok || res.status === 'aborted') return -Infinity;
    const cost = G.designCost(design);
    if (cost > st().funds) return -Infinity;
    const pay = D.launchPayout(res.maxAlt, res.maxSpeed, res.status === 'orbit', G.telemetryMult()) * G.globalMult();
    const sci = D.launchScience(res.maxAlt) * G.globalMult();
    // science valued like money at the current outsourcing exchange rate
    const sciVal = sci * D.outsourceCost(st().outsourced) / D.outsourceSci(st().outsourced) * 0.5;
    return (pay + sciVal - cost) / (overhead + res.t / G.maxWarp());
  }

  function altScore(res, design) {
    if (!res.ok || G.designCost(design) > st().funds) return -Infinity;
    return res.maxAlt - G.designCost(design) * 1e-3;
  }

  function budgetScore() { return budgetScoreFn(false); }

  function fmtClock(t) {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return (h ? h + 'h' : '') + String(m).padStart(h ? 2 : 1, '0') + 'm' + String(s).padStart(2, '0') + 's';
  }

  const ALT_MARKS = [1e3, 5e3, 10e3, 20e3, 50e3, 100e3, 200e3];
  function checkMarks() {
    const s = st();
    for (const a of ALT_MARKS) if (s.bestAlt >= a) mark('alt' + a, 'reached ' + D.fmtDist(a));
    if (s.gotOrbit) mark('orbit', 'FIRST ORBIT');
    const ph = G.phase();
    if (ph >= 2) mark('phase2', '— phase 2 —');
    if (ph >= 3) mark('phase3', '— phase 3 —');
    if (s.won) mark('won', 'WON: Andromeda colony');
  }

  function done() {
    const s = st();
    if (until === 'orbit') return s.gotOrbit;
    if (until === 'voyager') return !!s.missionsDone.voyager;
    if (typeof until === 'function') return until(s);
    return s.won;
  }

  // Missions: first completions in data order, then profitable repeats.
  function missionStep() {
    const s = st();
    if (!s.gotOrbit) return false;
    let acted = false;
    // turn on auto-dispatch for profitable repeats (once there's a spare slot)
    if (s.research.dispatch && G.missionSlots() >= 2) {
      for (const m of D.MISSIONS) {
        if (!s.missionsDone[m.id]) continue;
        const traj = G.canAssist(m) ? 'assist' : 'direct';
        const plan = G.dispatchPlan(m, traj);
        const rw = G.missionReward(m, s.missionsDone[m.id]);
        const net = rw.funds * G.globalMult() - (plan.vehicle ? plan.cost : Infinity);
        if (net > 0 && !s.autoMissions[m.id]) G.setAutoMission(m.id, true, traj);
        if (!(net > 0) && s.autoMissions[m.id]) G.setAutoMission(m.id, false);
      }
    }
    if (s.missions.length >= G.missionSlots()) return false;
    for (const m of D.MISSIONS) {
      if (s.missionsDone[m.id] || !G.missionVisible(m)) continue;
      if (s.missions.some((a) => a.id === m.id)) continue;
      const traj = G.canAssist(m) ? 'assist' : 'direct';
      const win = G.missionWindow(m);
      // keep the objective on the frontier so automation leaves a slot free
      if (!s.objective || s.objective.kind !== 'mission' || s.missionsDone[s.objective.id]) {
        s.objective = { kind: 'mission', id: m.id, traj };
      }
      // a proven vehicle that can do it?
      const plan = G.dispatchPlan(m, traj);
      if (plan.vehicle && !plan.why) {
        if (win.open || G.capableVehicles(m, traj).length) {
          const am = G.dispatch(m.id, traj, true); if (am) { dispatches++; return true; }
        }
      }
      // design one
      const useIon = !!(m.ionOk && s.research.engIon);
      const bb = bestBudget(m.payload, useIon);
      if (!bb.design || !bb.budget) continue;
      const best = { design: bb.design, res: { status: 'orbit', budget: bb.budget, spaceDv: bb.spaceDv } };
      const avail = best.res.budget + (m.ionOk ? best.res.spaceDv : 0);
      const needNow = G.missionNeed(m, traj);
      const needWin = Math.round(needNow / (win.open ? 1 : D.WINDOW.offPenalty));
      if (avail >= needNow && G.designCost(best.design) + G.missionOps(m) <= s.funds) {
        const r = fly(best.design, { kind: 'mission', id: m.id, traj });
        if (r && r.mission) return true;
        acted = true;
      } else if (avail >= needWin && !win.open) {
        // wait for the window (other work can happen meanwhile)
        continue;
      }
    }
    // manual repeat dispatch while there's no automation
    if (!s.research.dispatch && s.missions.length < G.missionSlots()) {
      let bestM = null, bestNet = 0;
      for (const m of D.MISSIONS) {
        if (!s.missionsDone[m.id]) continue;
        const traj = G.canAssist(m) ? 'assist' : 'direct';
        const plan = G.dispatchPlan(m, traj);
        if (!plan.vehicle || plan.why) continue;
        const rw = G.missionReward(m, s.missionsDone[m.id]);
        const net = (rw.funds * G.globalMult() - plan.cost) / G.missionDuration(m, plan.vehicle.budget, traj, false);
        if (net > bestNet) { bestNet = net; bestM = [m, traj]; }
      }
      if (bestM) { G.dispatch(bestM[0].id, bestM[1], true); dispatches++; return true; }
    }
    return acted;
  }

  function contractStep() {
    const s = st();
    for (const c of s.contracts.slice()) {
      if (c.kind === 'orbit') {
        if (!s.research.guidance) continue;
        // cheapest design that gets this payload to orbit, and only if it pays
        const cheap = optimize('co:' + c.payload, c.payload, (res, d) => {
          if (!res.ok) return -Infinity;
          if (res.status === 'orbit') return 1e9 - G.designCost(d);
          return res.maxSpeed + res.maxAlt * 1e-4;
        }, capSeeds());
        const best = cheap && cheap.res.status === 'orbit' ? { design: cheap.design } : null;
        if (best && G.designCost(best.design) <= s.funds && G.designCost(best.design) < c.funds * G.globalMult()) {
          const r = fly(best.design, { kind: 'contract', id: c.id });
          if (r && r.contract) return true;
        }
        continue;
      }
      const field = c.kind === 'alt' ? 'maxAlt' : 'maxSpeed';
      const best = optimize('c:' + c.kind + c.payload, c.payload, (res, d) => {
        if (!res.ok) return -Infinity;
        const cost = G.designCost(d);
        if (cost > s.funds) return -Infinity;
        if (res[field] >= c.target) return 1e9 - cost;
        return res[field];
      });
      if (best && best.res[field] >= c.target && G.designCost(best.design) <= s.funds &&
          G.designCost(best.design) < c.funds * G.globalMult()) {
        const r = fly(best.design, { kind: 'contract', id: c.id });
        if (r && r.contract) return true;
      }
    }
    return false;
  }

  function shipStep() {
    const s = st();
    if (G.phase() < 3) return false;
    if (s.ships.length >= G.shipSlots()) return false;
    let best = null;
    const engines = Object.keys(D.STAR_ENGINES).filter(G.shipEngineUnlocked);
    for (const star of D.STARS) {
      const modes = star.precursor ? ['flyby'] : ['colonize', 'flyby'];
      for (const mode of modes) {
        if (s.ships.some((sh) => sh.star === star.id)) continue;
        const rw = G.starReward(star, mode);
        if (!rw.colony && rw.funds <= 0) continue;
        for (const e of engines) {
          for (const ratio of (e === 'sail' ? [1] : [3, 5, 10, 20, 50, 100, 200, 500, 1000])) {
            if (G.shipBlocker(e, ratio, mode, star.id)) continue;
            const cost = G.shipCost(e, ratio, mode);
            const time = star.ly / G.shipCruise(e, ratio, mode) / G.warpRate();
            if (time > 4 * 3600) continue;
            const value = rw.colony ? Math.max(rw.funds, cost * 3) + (G.colonyFundsRate() + G.satRate() + 1e6) * 600 : rw.funds;
            const score = (value - cost) / (time + 120);
            if (value > cost && (!best || score > best.score)) best = { score, e, ratio, mode, star: star.id };
          }
        }
      }
    }
    if (best) { G.launchShip(best.e, best.ratio, best.mode, best.star); mark('ship:' + best.star + best.mode, 'starship → ' + best.star + ' (' + best.mode + ', ' + best.e + ')'); return true; }
    return false;
  }

  let lastIncomeSig = '', incomeBest = null;
  while (!done() && st().clock < maxTime) {
    if (statusEvery && st().clock >= nextStatus) { status(); nextStatus += statusEvery; }
    buyStuff();
    checkMarks();
    const s = st();
    if (shipStep()) continue;
    if (missionStep()) { checkMarks(); continue; }
    if (contractStep()) { checkMarks(); continue; }

    // progress flight: can we go higher than ever?
    if (!s.gotOrbit) {
      const alt = optimize('alt', D.PAYLOAD_MASS, altScore);
      if (s.research.guidance) {
        const orb = bestBudget(D.PAYLOAD_MASS, false);
        if (orb.budget && G.designCost(orb.design) <= s.funds) { fly(orb.design); continue; }
      }
      if (alt && alt.res.maxAlt > s.bestAlt * 1.03 + 50 && G.designCost(alt.design) <= s.funds) {
        fly(alt.design); continue;
      }
    }
    // income flight (also feeds auto-launch)
    const sig = techSig() + G.maxTanks() + ',' + G.maxEngines() + ',' + G.maxStages() + ',' + G.maxWarp() + ',' + G.colonyCount();
    if (sig !== lastIncomeSig || !incomeBest) {
      incomeBest = optimize('income', D.PAYLOAD_MASS, rate);
      lastIncomeSig = sig;
    }
    const inc = incomeBest && rate(incomeBest.res, incomeBest.design);
    if (inc > 0) {
      const crew = G.autoTurnaround() > 0;
      const job = s.lastYield;
      const jobName = incomeBest && G.state && JSON.stringify(incomeBest.design.stages);
      if (!crew && grind !== 'never') { fly(incomeBest.design); continue; }
      if (crew && grind === 'always') { fly(incomeBest.design); continue; }
      // hand the best income design to the ground crew, then let them work
      if (crew && (!job || job.key !== jobName) && G.designCost(incomeBest.design) <= s.funds) {
        s.crewLock = false;
        fly(incomeBest.design);
        if (s.lastYield) { s.lastYield.key = jobName; s.crewLock = true; }
        continue;
      }
    }
    advance(5);
  }
  checkMarks();
  if (statusEvery) status();
  return { timeline, marks, flights, dispatches, state: st(), clock: st().clock };
}

export function fmtClock(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return (h ? h + 'h' : '') + String(m).padStart(h ? 2 : 1, '0') + 'm' + String(s).padStart(2, '0') + 's';
}
