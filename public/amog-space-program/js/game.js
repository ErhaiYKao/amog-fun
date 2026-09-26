/* Amog Space Program — game state, economy, progression. */
(function (root) {
  'use strict';
  var P = root.ASP.physics, D = root.ASP.data;

  var SAVE_KEY = 'asp-save-v1';
  var OFFLINE_CAP = 8 * 3600; // seconds

  function freshState() {
    return {
      funds: 0, sci: 0,
      bestAlt: 0, bestSpeed: 0, gotOrbit: false, bestBudget: 0,
      milestones: {},          // key -> true
      research: {},            // id -> true
      engines: { fizz: true }, // owned engine types
      structure: { tanks: 0, engines: 0, constellation: 0 }, // increments bought
      design: {
        stages: [{ engine: 'fizz', count: 1, tanks: 1 }],
        turnStart: 500, turnEnd: 30000, guidanceOn: false
      },
      sats: 0,
      missionsDone: {},        // id -> count
      activeMission: null,     // {id, t0, dur}
      autolaunch: false,
      lastYield: null,         // {funds, sci, orbit} from last completed manual flight
      ships: [],               // {engine, ratio, mode, star, progressLy, cruiseC, arrived}
      colonies: {},            // starId -> true
      flybys: {},              // starId -> true (visited but not colonized)
      warpLevel: 0, outsourced: 0,
      totalLaunches: 0, timePlayed: 0,
      won: false, wonShown: false, lastSave: 0
    };
  }

  // Coerce any loaded/imported save into a shape the game can't choke on.
  // Malformed fields fall back to defaults instead of bricking the session.
  function sanitizeState(s) {
    var base = freshState();
    if (!s || typeof s !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (s[k] === undefined) s[k] = base[k];
    });
    ['funds', 'sci', 'bestAlt', 'bestSpeed', 'bestBudget', 'timePlayed'].forEach(function (k) {
      if (typeof s[k] !== 'number' || !isFinite(s[k]) || s[k] < 0) s[k] = base[k];
    });
    ['sats', 'totalLaunches', 'warpLevel', 'outsourced'].forEach(function (k) {
      if (typeof s[k] !== 'number' || !isFinite(s[k]) || s[k] < 0) s[k] = base[k];
      s[k] = Math.floor(s[k]);
    });
    s.warpLevel = Math.min(s.warpLevel, 14);
    ['milestones', 'research', 'engines', 'missionsDone', 'colonies', 'flybys'].forEach(function (k) {
      if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = base[k];
    });
    s.engines.fizz = true;
    if (!s.structure || typeof s.structure !== 'object') s.structure = base.structure;
    ['tanks', 'engines', 'constellation'].forEach(function (k) {
      var v = s.structure[k];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) s.structure[k] = 0;
      else s.structure[k] = Math.floor(v);
    });
    // design: every stage must reference a real engine with sane counts
    var d = s.design, ok = d && typeof d === 'object' && Array.isArray(d.stages) &&
      d.stages.length >= 1 && d.stages.length <= 3;
    if (ok) {
      for (var i = 0; i < d.stages.length; i++) {
        var st = d.stages[i];
        if (!st || !D.ENGINES[st.engine] ||
            typeof st.count !== 'number' || !isFinite(st.count) ||
            typeof st.tanks !== 'number' || !isFinite(st.tanks)) { ok = false; break; }
        st.count = Math.max(1, Math.min(9, Math.floor(st.count)));
        st.tanks = Math.max(0, Math.min(30, Math.floor(st.tanks)));
      }
    }
    if (!ok) s.design = base.design;
    if (typeof s.design.turnStart !== 'number' || !isFinite(s.design.turnStart)) s.design.turnStart = 500;
    if (typeof s.design.turnEnd !== 'number' || !isFinite(s.design.turnEnd)) s.design.turnEnd = 20000;
    s.design.turnStart = Math.max(200, Math.min(5000, s.design.turnStart));
    s.design.turnEnd = Math.max(8000, Math.min(80000, s.design.turnEnd));
    s.design.guidanceOn = s.design.guidanceOn === true;
    if (!Array.isArray(s.ships)) s.ships = [];
    s.ships = s.ships.filter(function (sh) {
      return sh && D.STAR_ENGINES[sh.engine] &&
        D.STARS.some(function (x) { return x.id === sh.star; }) &&
        typeof sh.progressLy === 'number' && isFinite(sh.progressLy) &&
        typeof sh.cruiseC === 'number' && isFinite(sh.cruiseC) && sh.cruiseC > 0 && sh.cruiseC <= 1;
    });
    var am = s.activeMission;
    if (am && !(typeof am === 'object' && typeof am.t0 === 'number' && isFinite(am.t0) &&
        typeof am.dur === 'number' && isFinite(am.dur) &&
        D.MISSIONS.some(function (m) { return m.id === am.id; }))) {
      s.activeMission = null;
    }
    if (s.lastYield && !(typeof s.lastYield === 'object' &&
        typeof s.lastYield.funds === 'number' && isFinite(s.lastYield.funds) &&
        typeof s.lastYield.sci === 'number' && isFinite(s.lastYield.sci))) {
      s.lastYield = null;
    }
    return s;
  }

  var G = {
    state: freshState(),
    flight: null,      // active P.Flight
    flightMeta: null,  // {spaceDv, manual}
    warp: 1,
    log: [],           // {t, text, kind}
    listeners: {},
    _autoT: 0, _missionNotified: false
  };

  G.on = function (ev, fn) { (G.listeners[ev] = G.listeners[ev] || []).push(fn); };
  G.emit = function (ev, arg) {
    var l = G.listeners[ev] || [];
    for (var i = 0; i < l.length; i++) l[i](arg);
  };

  G.addLog = function (text, kind) {
    G.log.push({ t: Date.now(), text: text, kind: kind || 'info' });
    if (G.log.length > 120) G.log.shift();
    G.emit('log');
  };

  // ---- Derived values -------------------------------------------------------

  G.colonyCount = function () {
    var n = 0, k; for (k in G.state.colonies) if (G.state.colonies[k]) n++;
    return n;
  };
  G.globalMult = function () { return Math.pow(2, G.colonyCount()); };
  G.telemetryMult = function () {
    var s = G.state.research;
    return s.telem2 ? 2.25 : (s.telem1 ? 1.5 : 1);
  };
  G.dryFrac = function () {
    var s = G.state.research;
    return s.mat3 ? 0.05 : s.mat2 ? 0.065 : s.mat1 ? 0.08 : D.TANK.dryFrac;
  };
  G.cdA = function () {
    var s = G.state.research;
    return D.BASE_CDA * (s.aero3 ? 0.4 : s.aero2 ? 0.55 : s.aero1 ? 0.72 : 1);
  };
  G.maxTanks = function () { return D.STRUCTURE.tanks.start + G.state.structure.tanks; };
  G.maxEngines = function () { return D.STRUCTURE.engines.start + G.state.structure.engines; };
  G.maxStages = function () {
    var s = G.state.research;
    return s.stage3 ? 3 : s.stage2 ? 2 : 1;
  };
  G.satCap = function () {
    return D.STRUCTURE.constellation.start + G.state.structure.constellation * D.STRUCTURE.constellation.step;
  };
  G.autoInterval = function () {
    var s = G.state.research;
    return s.mc4 ? 2 : s.mc3 ? 5 : s.mc2 ? 12 : s.mc1 ? 30 : 0;
  };
  G.satRate = function () { return G.state.sats * 150 * G.globalMult(); };
  G.sciRate = function () {
    var r = 0;
    if (G.state.research.station) r += 2;
    return r * G.globalMult() + G.colonyCount() * 2e4 * G.globalMult();
  };
  G.colonyFundsRate = function () { return G.colonyCount() * 2e6 * G.globalMult(); };

  // Resolve the builder design into physics stage specs.
  // Planner engines (ion) don't burn during ascent: they ride as payload and
  // contribute dv to the orbital mission budget instead.
  G.resolveDesign = function (design) {
    design = design || G.state.design;
    var dryFrac = G.dryFrac();
    var vac = !!G.state.research.vacNozzles;
    var ascent = [], spaceMass = 0, spaceDv = 0, spaceStages = [];
    var i, st;
    for (i = 0; i < design.stages.length; i++) {
      st = design.stages[i];
      var e = D.ENGINES[st.engine];
      if (!e || st.count < 1) continue;
      var spec = {
        engine: e, engineCount: st.count, tanks: st.tanks,
        tankFuel: D.TANK.fuel, tankDry: D.TANK.fuel * dryFrac
      };
      if (e.planner) { spaceStages.push(spec); }
      else {
        if (vac && ascent.length > 0) {
          spec = Object.assign({}, spec, { engine: Object.assign({}, e, { ve: e.ve * 1.15 }) });
        }
        ascent.push(spec);
      }
    }
    // space stages: dv computed with only the probe above them
    var above = D.PAYLOAD_MASS;
    for (i = spaceStages.length - 1; i >= 0; i--) {
      var sm = P.stageMasses(spaceStages[i]);
      above += sm.wet;
    }
    spaceMass = above - D.PAYLOAD_MASS;
    var stats = spaceStages.length ? P.vehicleStats(spaceStages, D.PAYLOAD_MASS) : null;
    spaceDv = stats ? stats.totalDv : 0;
    var guided = !!G.state.research.guidance && design.guidanceOn === true;
    return {
      ascent: ascent,
      payload: D.PAYLOAD_MASS + spaceMass,
      spaceDv: spaceDv,
      cdA: G.cdA(),
      turnStart: guided ? design.turnStart : 0,
      turnEnd: guided ? design.turnEnd : 0,
      stats: P.vehicleStats(ascent, D.PAYLOAD_MASS + spaceMass)
    };
  };

  // ---- Milestones -----------------------------------------------------------

  function checkMilestones(f) {
    var st = G.state, out = [];
    D.ALT_MILESTONES.forEach(function (m) {
      var key = 'alt' + m.alt;
      if (!st.milestones[key] && f.maxAlt >= m.alt) {
        st.milestones[key] = true;
        st.funds += m.funds * G.globalMult();
        st.sci += m.sci * G.globalMult();
        out.push(m);
      }
    });
    D.SPEED_MILESTONES.forEach(function (m) {
      var key = 'spd' + m.speed;
      if (!st.milestones[key] && f.maxSpeed >= m.speed) {
        st.milestones[key] = true;
        st.funds += m.funds * G.globalMult();
        st.sci += m.sci * G.globalMult();
        out.push(m);
      }
    });
    if (f.status === 'orbit' && !st.milestones.orbit) {
      st.milestones.orbit = true;
      st.gotOrbit = true;
      var m = { name: 'STABLE ORBIT', funds: 600000, sci: 500,
        note: 'Periapsis above the atmosphere. You are missing the ground forever. Welcome to Phase 2.' };
      st.funds += m.funds; st.sci += m.sci;
      out.push(m);
    }
    if (f.status === 'escape' && !st.milestones.escape) {
      st.milestones.escape = true;
      var e = { name: 'EARTH ESCAPE', funds: 300000, sci: 300,
        note: 'Past escape velocity — this rocket now orbits the Sun.' };
      st.funds += e.funds; st.sci += e.sci;
      out.push(e);
    }
    return out;
  }

  // ---- Flight lifecycle -----------------------------------------------------

  // Effective income per second, for the UI (passive + auto-launch replay).
  G.incomeRates = function () {
    var st = G.state, iv = G.autoInterval(), mult = G.globalMult();
    var f = G.satRate() + G.colonyFundsRate();
    var s = G.sciRate();
    if (st.autolaunch && iv > 0 && st.lastYield) {
      f += st.lastYield.funds * mult / iv;
      s += st.lastYield.sci * mult / iv;
    }
    return { funds: f, sci: s };
  };

  G.launch = function (manual) {
    if (G.flight && G.flight.status === 'flying') return false;
    G.warpTouched = false;
    var r = G.resolveDesign();
    if (!r.ascent.length) { G.addLog('This rocket has no engines that work in an atmosphere.', 'warn'); return false; }
    G.flight = new P.Flight({
      stages: r.ascent, payload: r.payload, cdA: r.cdA,
      turnStart: r.turnStart, turnEnd: r.turnEnd
    });
    G.flightMeta = { spaceDv: r.spaceDv, manual: !!manual };
    G.warp = 1;
    G.state.totalLaunches++;
    G.emit('launch');
    return true;
  };

  G.endFlight = function () {
    var f = G.flight, meta = G.flightMeta;
    if (!f) return;
    var st = G.state;
    var gotOrbit = f.status === 'orbit';
    var mult = G.globalMult();
    var funds = D.launchPayout(f.maxAlt, f.maxSpeed, gotOrbit, G.telemetryMult()) * mult;
    var sci = D.launchScience(f.maxAlt) * mult;
    st.funds += funds; st.sci += sci;
    if (f.maxAlt > st.bestAlt) st.bestAlt = f.maxAlt;
    if (f.maxSpeed > st.bestSpeed) st.bestSpeed = f.maxSpeed;

    var satDeployed = false;
    if (gotOrbit) {
      var budget = f.remainingDv() + meta.spaceDv;
      if (budget > st.bestBudget) st.bestBudget = budget;
      if (st.sats < G.satCap()) { st.sats++; satDeployed = true; }
    }
    var milestones = checkMilestones(f);
    var result = {
      status: f.status, maxAlt: f.maxAlt, maxSpeed: f.maxSpeed,
      funds: funds, sci: sci, milestones: milestones,
      satDeployed: satDeployed,
      budget: gotOrbit ? f.remainingDv() + meta.spaceDv : 0,
      manual: meta.manual, t: f.t
    };
    st.lastYield = { funds: funds / mult, sci: sci / mult, orbit: gotOrbit };
    G.lastResult = result;
    G.flight = null; G.flightMeta = null;
    G.emit('flightEnd', result);
    return result;
  };

  // ---- Purchases ------------------------------------------------------------

  G.buyStructure = function (key) {
    var spec = D.STRUCTURE[key], st = G.state;
    var owned = st.structure[key];
    var maxed = key === 'constellation'
      ? G.satCap() >= spec.max
      : (spec.start + owned) >= spec.max;
    if (maxed) return false;
    var cost = D.structureCost(spec, owned);
    if (st.funds < cost) return false;
    st.funds -= cost; st.structure[key]++;
    G.emit('change');
    return true;
  };

  G.buyEngine = function (id) {
    var e = D.ENGINES[id], st = G.state;
    if (!e || st.engines[id] || st.funds < e.cost) return false;
    // engine availability gated by research where applicable
    if (!G.engineUnlocked(id)) return false;
    st.funds -= e.cost; st.engines[id] = true;
    // a shiny new engine goes straight onto a simple rocket (ion tugs never
    // lift off, so they only ever join via the dropdown)
    var equipped = false;
    if (!e.planner && st.design.stages.length === 1) {
      st.design.stages[0].engine = id;
      equipped = true;
    }
    G.emit('change');
    return { ok: true, equipped: equipped };
  };

  G.engineUnlocked = function (id) {
    var r = G.state.research;
    switch (id) {
      case 'fizz': return true;
      case 'sundancer': return G.state.bestAlt >= 1000;
      case 'kestrel': return !!r.engKestrel;
      case 'merlin': return !!r.engMerlin;
      case 'raptor': return !!r.engRaptor;
      case 'nerva': return !!r.engNerva;
      case 'ion': return !!r.engIon;
    }
    return false;
  };

  G.researchVisible = function (r) {
    var st = G.state;
    if (r.requiresAlt && st.bestAlt < r.requiresAlt) return false;
    if (r.requiresOrbit && !st.gotOrbit) return false;
    if (r.requiresMission && !st.missionsDone[r.requiresMission]) return false;
    if (r.requires) {
      for (var i = 0; i < r.requires.length; i++)
        if (!st.research[r.requires[i]]) return false;
    }
    return true;
  };

  G.buyResearch = function (id) {
    var st = G.state, r = null, i;
    for (i = 0; i < D.RESEARCH.length; i++) if (D.RESEARCH[i].id === id) r = D.RESEARCH[i];
    if (!r || st.research[id] || !G.researchVisible(r) || st.sci < r.sci) return false;
    st.sci -= r.sci; st.research[id] = true;
    if (id === 'mc1') st.autolaunch = true; // you bought auto-launch; it launches
    G.addLog('Research complete: ' + r.name, 'good');
    G.emit('change');
    return true;
  };

  // Outsourced studies: funds -> science, escalating cost.
  G.buyOutsource = function () {
    var st = G.state;
    var cost = D.outsourceCost(st.outsourced);
    if (st.funds < cost) return false;
    st.funds -= cost;
    st.sci += D.outsourceSci(st.outsourced) * G.globalMult();
    st.outsourced++;
    G.emit('change');
    return true;
  };

  // ---- Missions -------------------------------------------------------------

  G.missionDv = function (m) {
    return (G.state.research.slingshot && m.assistDv) ? m.assistDv : m.dv;
  };
  G.missionVisible = function (m) {
    return !m.requires || !!G.state.missionsDone[m.requires];
  };
  G.missionCost = function (m) {
    // repeats are cheap the way repeat rewards are small
    return (m.cost || 0) * (G.state.missionsDone[m.id] ? 0.2 : 1);
  };
  // Excess Δv buys faster trajectories — barely-enough budget flies the slow
  // Hohmann transfer, double the budget roughly halves the trip.
  G.missionDuration = function (m) {
    var need = G.missionDv(m);
    var ratio = need > 0 ? G.state.bestBudget / need : 1;
    var timeMult = Math.max(0.5, Math.min(1, 2 / (1 + ratio)));
    return m.time * timeMult / (G.state.research.dsn ? 2 : 1);
  };
  G.startMission = function (id) {
    var st = G.state, m = null, i;
    for (i = 0; i < D.MISSIONS.length; i++) if (D.MISSIONS[i].id === id) m = D.MISSIONS[i];
    if (!m || st.activeMission || !st.gotOrbit) return false;
    if (!G.missionVisible(m) || st.bestBudget < G.missionDv(m)) return false;
    var cost = G.missionCost(m);
    if (st.funds < cost) return false;
    st.funds -= cost;
    st.activeMission = { id: id, t0: Date.now() / 1000, dur: G.missionDuration(m) };
    G.addLog('Mission underway: ' + m.name + ' (−$' + D.fmt(cost) + ')', 'info');
    G.emit('change');
    return true;
  };
  function finishMission() {
    var st = G.state, am = st.activeMission;
    if (!am) return;
    var m = null, i;
    for (i = 0; i < D.MISSIONS.length; i++) if (D.MISSIONS[i].id === am.id) m = D.MISSIONS[i];
    st.activeMission = null;
    if (!m) return;
    var first = !st.missionsDone[m.id];
    var frac = first ? 1 : 0.2;
    // manual descent outcome (landing missions): soft touchdown 1.5x, crater 0.5x
    var dMult = (typeof am.mult === 'number' && isFinite(am.mult)) ? am.mult : 1;
    var mult = G.globalMult() * dMult;
    st.funds += m.funds * frac * mult;
    st.sci += m.sci * frac * mult;
    st.missionsDone[m.id] = (st.missionsDone[m.id] || 0) + 1;
    G.addLog((first ? 'MISSION COMPLETE: ' : 'Repeat mission: ') + m.name +
      (dMult > 1 ? ' — flawless landing!' : dMult < 1 ? ' — probe arrived as debris.' : '') +
      '  +$' + D.fmt(m.funds * frac * mult) + ' +' + D.fmt(m.sci * frac * mult) + '⚗', 'good');
    G.emit('missionDone', m);
    G.emit('change');
  }

  // Called by the manual-descent minigame while its mission is in transit.
  G.setDescentResult = function (missionId, mult) {
    var am = G.state.activeMission;
    if (am && am.id === missionId) am.mult = mult;
  };

  // ---- Starships (phase 3) --------------------------------------------------

  G.phase = function () {
    var st = G.state;
    if (st.won) return 4;
    if (st.missionsDone.voyager) return 3;
    if (st.gotOrbit) return 2;
    return 1;
  };

  G.shipCruise = function (engineId, ratio, mode) {
    // returns cruise speed as fraction of c, or -1 if impossible
    var r = G.state.research;
    if (engineId === 'sail') {
      if (mode === 'colonize' && !r.magsail) return -1;
      return r.laser ? 0.12 : 0.02;
    }
    var e = D.STAR_ENGINES[engineId];
    if (!e) return -1;
    var dv = P.tsiolkovskyRel(e.ve, ratio, 1);
    var cruise = (mode === 'colonize' ? dv / 2 : dv) / P.C.C_LIGHT;
    return Math.min(cruise, 0.99);
  };

  G.shipCost = function (engineId, ratio, mode) {
    var base = { orion: 5e7, fusion: 5e9, antimatter: 5e12, sail: 1e7 }[engineId] || 0;
    var c = engineId === 'sail' ? base : base * Math.pow(ratio, 0.8);
    if (mode === 'colonize') c *= 2;
    return c;
  };

  G.shipEngineUnlocked = function (engineId) {
    var r = G.state.research;
    return { orion: !!r.orion, fusion: !!r.fusionEng, antimatter: !!r.antimatterEng, sail: !!r.sailTech }[engineId] || false;
  };

  G.launchShip = function (engineId, ratio, mode, starId) {
    var st = G.state, star = null, i;
    for (i = 0; i < D.STARS.length; i++) if (D.STARS[i].id === starId) star = D.STARS[i];
    if (!star || !G.shipEngineUnlocked(engineId)) return false;
    var cruise = G.shipCruise(engineId, ratio, mode);
    if (cruise <= 0) return false;
    var cost = G.shipCost(engineId, ratio, mode);
    if (st.funds < cost) return false;
    st.funds -= cost;
    st.ships.push({
      engine: engineId, ratio: ratio, mode: mode, star: starId,
      progressLy: 0, cruiseC: cruise, name: D.STAR_ENGINES[engineId].name
    });
    G.addLog('Starship departed for ' + star.name + ' at ' + (cruise).toFixed(3) + 'c (' +
      D.fmtYears(star.ly / cruise) + ' of travel)', 'info');
    G.emit('change');
    return true;
  };

  G.warpRate = function () { return 2 * Math.pow(4, G.state.warpLevel); }; // sim-years per real second
  G.warpUpCost = function () { return 5e4 * Math.pow(8, G.state.warpLevel); };
  G.buyWarp = function () {
    var st = G.state;
    if (st.warpLevel >= 14) return false;
    var c = G.warpUpCost();
    if (st.sci < c) return false;
    st.sci -= c; st.warpLevel++;
    G.emit('change');
    return true;
  };

  function tickShips(dtReal) {
    var st = G.state, years = dtReal * G.warpRate();
    if (!st.ships.length) return;
    var arrived = [];
    st.ships.forEach(function (s) {
      s.progressLy += s.cruiseC * years;
      var star = null, i;
      for (i = 0; i < D.STARS.length; i++) if (D.STARS[i].id === s.star) star = D.STARS[i];
      if (star && s.progressLy >= star.ly) arrived.push({ ship: s, star: star });
    });
    arrived.forEach(function (a) {
      var idx = st.ships.indexOf(a.ship);
      if (idx >= 0) st.ships.splice(idx, 1);
      var mult = G.globalMult();
      if (a.ship.mode === 'colonize' && !st.colonies[a.star.id]) {
        st.colonies[a.star.id] = true;
        st.funds += a.star.funds * mult; st.sci += a.star.sci * mult;
        G.addLog('COLONY ESTABLISHED at ' + a.star.name + '! All income ×2. +$' +
          D.fmt(a.star.funds * mult) + ' +' + D.fmt(a.star.sci * mult) + '⚗', 'good');
        if (a.star.intergalactic && !st.won) {
          st.won = true;
          G.emit('won');
        }
      } else {
        var frac = st.flybys[a.star.id] || st.colonies[a.star.id] ? 0.1 : 0.35;
        st.flybys[a.star.id] = true;
        st.funds += a.star.funds * frac * mult; st.sci += a.star.sci * frac * mult;
        G.addLog('Flyby of ' + a.star.name + ' — photos incredible. +$' +
          D.fmt(a.star.funds * frac * mult) + ' +' + D.fmt(a.star.sci * frac * mult) + '⚗', 'good');
      }
      G.emit('change');
    });
  }

  // ---- Main tick ------------------------------------------------------------

  G.tick = function (dtReal) {
    var st = G.state;
    st.timePlayed += dtReal;

    // passive income
    var f = G.satRate() * dtReal + G.colonyFundsRate() * dtReal;
    if (f > 0) st.funds += f;
    var s = G.sciRate() * dtReal;
    if (s > 0) st.sci += s;

    // auto-launch (replays the recorded result of your last flight)
    var iv = G.autoInterval();
    if (st.autolaunch && iv > 0 && st.lastYield && !(G.flight && G.flightMeta && G.flightMeta.manual)) {
      G._autoT += dtReal;
      while (G._autoT >= iv) {
        G._autoT -= iv;
        var mult = G.globalMult();
        st.funds += st.lastYield.funds * mult;
        st.sci += st.lastYield.sci * mult;
        st.totalLaunches++;
        if (st.lastYield.orbit && st.sats < G.satCap()) st.sats++;
      }
    }

    // active mission (held while the player is flying a manual descent)
    if (!G.missionHold && st.activeMission &&
        (Date.now() / 1000 - st.activeMission.t0) >= st.activeMission.dur) {
      finishMission();
    }

    // starships
    if (G.phase() >= 3) tickShips(dtReal);
  };

  // ---- Save / load ----------------------------------------------------------

  G.save = function () {
    try {
      G.state.lastSave = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(G.state));
      return true;
    } catch (e) { return false; }
  };

  G.load = function () {
    var raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    s = sanitizeState(s);
    G.state = s;
    // offline progress
    var away = Math.min(Math.max((Date.now() - (s.lastSave || Date.now())) / 1000, 0), OFFLINE_CAP);
    if (away > 60) {
      var gained = (G.satRate() + G.colonyFundsRate()) * away;
      var sciG = G.sciRate() * away;
      var iv = G.autoInterval(), auto = 0;
      if (s.autolaunch && iv > 0 && s.lastYield) {
        auto = Math.floor(away / iv);
        var mult = G.globalMult();
        gained += auto * s.lastYield.funds * mult;
        sciG += auto * s.lastYield.sci * mult;
        s.totalLaunches += auto;
        if (s.lastYield.orbit) s.sats = Math.min(G.satCap(), s.sats + auto);
      }
      s.funds += gained; s.sci += sciG;
      if (G.phase() >= 3) tickShips(away);
      if (s.activeMission && (Date.now() / 1000 - s.activeMission.t0) >= s.activeMission.dur) finishMission();
      var summary = 'While you were away (' + D.fmtTime(away) + '): +$' + D.fmt(gained) +
        ', +' + D.fmt(sciG) + '⚗' + (auto ? ', ' + auto + ' auto-launches' : '');
      G.addLog(summary, 'info');
      G.offlineSummary = summary; // UI shows this as a toast once it boots
    }
    return s;
  };

  G.hardReset = function () {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    G.state = freshState();
    G.flight = null; G.flightMeta = null; G.log = []; G.lastResult = null;
    G.emit('change');
  };

  G.exportSave = function () {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(G.state)))); }
    catch (e) { return ''; }
  };
  G.importSave = function (str) {
    try {
      var s = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
      if (!s || typeof s !== 'object' || typeof s.funds !== 'number') return false;
      G.state = sanitizeState(s);
      G.save();
      G.emit('change');
      return true;
    } catch (e) { return false; }
  };

  root.ASP.game = G;
})(typeof window !== 'undefined' ? window : globalThis);
