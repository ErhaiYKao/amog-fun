/* Amog Space Program — game state, economy, progression.
 * Pure logic (no DOM): runs in the browser and in Node (tests, balance bot).
 * All timers run on the game clock `state.clock` (seconds), which the main
 * loop advances; offline progress just advances it further.
 */
(function (root) {
  'use strict';
  var P = root.ASP.physics, D = root.ASP.data;

  var SAVE_KEY = 'asp-save-v1';   // legacy key name — never rename (it would wipe saves)
  var SAVE_VERSION = 2;
  var OFFLINE_CAP = 8 * 3600;     // seconds
  var MAX_STAGES = 4;
  var MAX_VEHICLES = 8;
  var CREW_TURNAROUND = { crew4: 1.5, crew3: 3, crew2: 6, crew1: 12 };

  function freshState() {
    return {
      v: SAVE_VERSION,
      funds: 0, sci: 0,
      bestAlt: 0, bestSpeed: 0, gotOrbit: false, bestOrbitPayload: 0,
      milestones: {},          // key -> true
      research: {},            // id -> true
      structure: { tanks: 0, engines: 0, constellation: 0 }, // increments bought
      design: {
        stages: [{ engine: 'fizz', count: 1, tanks: 1 }],
        turnStart: 1000, turnEnd: 30000, guidanceOn: false
      },
      objective: null,         // null = free flight | {kind:'contract', id} | {kind:'mission', id, traj}
      sats: 0,
      missionsDone: {},        // id -> completions
      missions: [],            // in transit: {uid, id, t0, dur, traj, mult, ion}
      vehicles: [],            // proven designs: see recordVehicle
      autoMissions: {},        // id -> traj ('direct' | 'assist')
      contracts: [],           // {id, kind, target, payload, funds, sci, expires, stretch}
      contractSeq: 0, nextContractAt: 20,
      autolaunch: false, crewLock: false,
      lastYield: null,         // crew job: {funds, sci, orbit, cost, t, name} of the last free flight (pre-multiplier)
      ships: [],               // {uid, engine, ratio, mode, star, progressLy, cruiseC, name}
      colonies: {},            // starId -> true
      flybys: {},              // starId -> number of flybys
      warpLevel: 0, outsourced: 0,
      totalLaunches: 0, timePlayed: 0, clock: 0, uid: 0,
      won: false, wonShown: false, lastSave: 0,
      migratedFrom: 0, migrationShown: true
    };
  }

  function findBy(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  // ---- Save migration -------------------------------------------------------
  // v1 (no `v` field): engines were bought separately after research, one
  // mission at a time on wall-clock time, a global "best budget", flybys as
  // booleans. Everything the player earned carries over.
  function migrateV1(s) {
    var r = s.research && typeof s.research === 'object' ? s.research : {};
    var out = {};
    var rename = { mc1: 'crew1', mc2: 'crew2', mc3: 'crew3', mc4: 'crew4', dsn: 'dsn1' };
    Object.keys(r).forEach(function (k) { if (r[k]) out[rename[k] || k] = true; });
    // owning an engine == having researched it now
    var engMap = { sundancer: 'engSundancer', kestrel: 'engKestrel', merlin: 'engMerlin',
                   raptor: 'engRaptor', nerva: 'engNerva', ion: 'engIon' };
    if (s.engines && typeof s.engines === 'object') {
      Object.keys(engMap).forEach(function (e) { if (s.engines[e]) out[engMap[e]] = true; });
    }
    // v1 had 256x warp for free; don't take speed away from veterans
    if (isNum(s.bestAlt) && s.bestAlt >= 20e3) out.warp1 = true;
    if (s.gotOrbit) out.warp2 = true;
    s.research = out;
    // the new intro missions are prerequisites; anyone past them gets credit
    if (s.missionsDone && typeof s.missionsDone === 'object' && Object.keys(s.missionsDone).length) {
      if (!s.missionsDone.weather) s.missionsDone.weather = 1;
      if (!s.missionsDone.meo) s.missionsDone.meo = 1;
    }
    // one active mission on wall-clock -> the transit list on the game clock
    s.missions = [];
    var am = s.activeMission;
    if (am && typeof am === 'object' && isNum(am.t0) && isNum(am.dur) && findBy(D.MISSIONS, am.id)) {
      var left = Math.max(1, am.dur - (Date.now() / 1000 - am.t0));
      s.missions.push({ uid: 1, id: am.id, t0: 0, dur: left, traj: 'direct',
        mult: isNum(am.mult) ? am.mult : 1, ion: false });
    }
    delete s.activeMission;
    if (s.flybys && typeof s.flybys === 'object') {
      Object.keys(s.flybys).forEach(function (k) { s.flybys[k] = s.flybys[k] ? 1 : 0; });
    }
    delete s.engines; delete s.bestBudget;
    s.lastYield = null;   // old payouts were bigger; the crew needs a fresh flight
    s.clock = 0; s.uid = 10;
    s.v = SAVE_VERSION;
    s.migratedFrom = 1; s.migrationShown = false;
    return s;
  }

  // Milestones that the player has already flown past are marked claimed
  // without paying (a migrated veteran shouldn't get a windfall).
  function claimPassedMilestones(s) {
    D.ALT_MILESTONES.forEach(function (m) { if (s.bestAlt >= m.alt) s.milestones['alt' + m.alt] = true; });
    D.SPEED_MILESTONES.forEach(function (m) { if (s.bestSpeed >= m.speed) s.milestones['spd' + m.speed] = true; });
    if (s.gotOrbit) s.milestones.orbit = true;
  }

  function sanitizeStages(stages) {
    if (!Array.isArray(stages) || stages.length < 1 || stages.length > MAX_STAGES) return null;
    var out = [];
    for (var i = 0; i < stages.length; i++) {
      var st = stages[i];
      if (!st || !D.ENGINES[st.engine] || !isNum(st.count) || !isNum(st.tanks)) return null;
      out.push({ engine: st.engine,
        count: Math.max(1, Math.min(9, Math.floor(st.count))),
        tanks: Math.max(0, Math.min(80, Math.floor(st.tanks))) });
    }
    return out;
  }

  // Coerce any loaded/imported save into a shape the game can't choke on.
  // Malformed fields fall back to defaults instead of bricking the session.
  function sanitizeState(s) {
    var base = freshState();
    if (!s || typeof s !== 'object') return base;
    if (s.v === undefined) { s = migrateV1(s); }
    if (!isNum(s.v) || s.v > SAVE_VERSION) return base; // from the future: refuse
    Object.keys(base).forEach(function (k) {
      if (s[k] === undefined) s[k] = base[k];
    });
    ['funds', 'sci', 'bestAlt', 'bestSpeed', 'timePlayed', 'clock', 'bestOrbitPayload'].forEach(function (k) {
      if (!isNum(s[k]) || s[k] < 0) s[k] = base[k];
    });
    ['sats', 'totalLaunches', 'warpLevel', 'outsourced', 'contractSeq', 'uid'].forEach(function (k) {
      if (!isNum(s[k]) || s[k] < 0) s[k] = base[k];
      s[k] = Math.floor(s[k]);
    });
    if (!isNum(s.nextContractAt)) s.nextContractAt = s.clock + 20;
    s.warpLevel = Math.min(s.warpLevel, 14);
    s.gotOrbit = s.gotOrbit === true;
    ['milestones', 'research', 'missionsDone', 'colonies', 'flybys', 'autoMissions'].forEach(function (k) {
      if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = base[k];
    });
    // drop research ids that no longer exist
    Object.keys(s.research).forEach(function (k) {
      if (!findBy(D.RESEARCH, k) || !s.research[k]) delete s.research[k];
    });
    Object.keys(s.missionsDone).forEach(function (k) {
      if (!findBy(D.MISSIONS, k) || !isNum(s.missionsDone[k]) || s.missionsDone[k] < 1) delete s.missionsDone[k];
      else s.missionsDone[k] = Math.floor(s.missionsDone[k]);
    });
    Object.keys(s.flybys).forEach(function (k) {
      if (!isNum(s.flybys[k]) || s.flybys[k] < 1) delete s.flybys[k];
    });
    Object.keys(s.autoMissions).forEach(function (k) {
      if (!findBy(D.MISSIONS, k)) delete s.autoMissions[k];
      else if (s.autoMissions[k] !== 'assist') s.autoMissions[k] = 'direct';
    });
    if (!s.structure || typeof s.structure !== 'object') s.structure = base.structure;
    ['tanks', 'engines', 'constellation'].forEach(function (k) {
      var v = s.structure[k];
      s.structure[k] = (!isNum(v) || v < 0) ? 0 : Math.floor(v);
    });
    // design: every stage must reference a real engine with sane counts
    var d = s.design;
    var stages = d && typeof d === 'object' ? sanitizeStages(d.stages) : null;
    if (!stages) s.design = base.design;
    else s.design.stages = stages;
    if (!isNum(s.design.turnStart)) s.design.turnStart = base.design.turnStart;
    if (!isNum(s.design.turnEnd)) s.design.turnEnd = base.design.turnEnd;
    s.design.turnStart = Math.max(200, Math.min(5000, s.design.turnStart));
    s.design.turnEnd = Math.max(8000, Math.min(80000, s.design.turnEnd));
    s.design.guidanceOn = s.design.guidanceOn === true;
    if (!Array.isArray(s.ships)) s.ships = [];
    s.ships = s.ships.filter(function (sh) {
      return sh && D.STAR_ENGINES[sh.engine] && findBy(D.STARS, sh.star) &&
        isNum(sh.progressLy) && isNum(sh.cruiseC) && sh.cruiseC > 0 && sh.cruiseC <= 1;
    });
    if (!Array.isArray(s.missions)) s.missions = [];
    s.missions = s.missions.filter(function (m) {
      return m && typeof m === 'object' && findBy(D.MISSIONS, m.id) && isNum(m.t0) && isNum(m.dur);
    });
    s.missions.forEach(function (m) {
      if (!isNum(m.mult)) m.mult = 1;
      if (!isNum(m.uid)) m.uid = ++s.uid;
      if (m.traj !== 'assist') m.traj = 'direct';
    });
    if (!Array.isArray(s.vehicles)) s.vehicles = [];
    s.vehicles = s.vehicles.filter(function (v) {
      if (!v || typeof v !== 'object' || !isNum(v.payload) || !isNum(v.budget)) return false;
      v.stages = sanitizeStages(v.stages);
      if (!v.stages) return false;
      if (!isNum(v.ionDv)) v.ionDv = 0;
      return true;
    }).slice(0, MAX_VEHICLES);
    if (!Array.isArray(s.contracts)) s.contracts = [];
    s.contracts = s.contracts.filter(function (c) {
      return c && typeof c === 'object' && (c.kind === 'alt' || c.kind === 'speed' || c.kind === 'orbit') &&
        isNum(c.target) && isNum(c.payload) && isNum(c.funds) && isNum(c.sci) && isNum(c.expires);
    });
    var o = s.objective;
    if (o && !(typeof o === 'object' &&
        ((o.kind === 'contract' && findBy(s.contracts, o.id)) ||
         (o.kind === 'mission' && findBy(D.MISSIONS, o.id))))) s.objective = null;
    if (s.lastYield && !(typeof s.lastYield === 'object' &&
        isNum(s.lastYield.funds) && isNum(s.lastYield.sci))) {
      s.lastYield = null;
    }
    if (s.lastYield && !isNum(s.lastYield.cost)) s.lastYield.cost = 0;
    if (s.lastYield && !isNum(s.lastYield.t)) s.lastYield.t = 0;
    s.crewLock = s.crewLock === true;
    if (s.migratedFrom) claimPassedMilestones(s);
    s.migrationShown = s.migrationShown !== false;
    s.v = SAVE_VERSION;
    return s;
  }

  var G = {
    state: freshState(),
    flight: null,      // active P.Flight
    flightMeta: null,  // {spaceDv, manual, payload, cost, objective}
    warp: 1,
    log: [],           // {t, text, kind}
    listeners: {},
    rng: Math.random,  // the balance bot swaps in a seeded one
    _autoT: 0,
    SAVE_KEY: SAVE_KEY, SAVE_VERSION: SAVE_VERSION, MAX_STAGES: MAX_STAGES,
    freshState: freshState, sanitizeState: sanitizeState
  };

  // Where the money and science came from this session (not saved; the
  // balance bot and the feedback report read it).
  G.ledger = {};
  function earn(src, f, sc) {
    var l = G.ledger[src] || (G.ledger[src] = { funds: 0, sci: 0 });
    l.funds += f || 0; l.sci += sc || 0;
  }
  G.earn = earn;

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

  G.now = function () { return G.state.clock; };

  // ---- Derived values -------------------------------------------------------

  G.colonyCount = function () {
    var n = 0, k; for (k in G.state.colonies) if (G.state.colonies[k]) n++;
    return n;
  };
  G.missionsExplored = function () {
    var n = 0, k; for (k in G.state.missionsDone) if (G.state.missionsDone[k]) n++;
    return n;
  };
  // Public interest: +10% income per distinct mission completed.
  G.fameMult = function () { return 1 + D.FAME_PER_MISSION * G.missionsExplored(); };
  // Colonies double everything; fame adds up mission by mission.
  G.globalMult = function () { return Math.pow(2, G.colonyCount()) * G.fameMult(); };
  G.telemetryMult = function () {
    var s = G.state.research;
    return s.telem2 ? 2.25 : (s.telem1 ? 1.5 : 1);
  };
  G.dryFrac = function () {
    var s = G.state.research;
    return s.mat4 ? 0.045 : s.mat3 ? 0.055 : s.mat2 ? 0.07 : s.mat1 ? 0.085 : D.TANK.dryFrac;
  };
  G.cdA = function () {
    var s = G.state.research;
    return D.BASE_CDA * (s.aero3 ? 0.4 : s.aero2 ? 0.55 : s.aero1 ? 0.72 : 1);
  };
  G.tankCap = function () {
    var r = G.state.research;
    return r.heavy3 ? D.HEAVY_TANKS.heavy3 : r.heavy2 ? D.HEAVY_TANKS.heavy2 :
      r.heavy1 ? D.HEAVY_TANKS.heavy1 : D.STRUCTURE.tanks.max;
  };
  G.maxTanks = function () {
    return Math.min(G.tankCap(), D.STRUCTURE.tanks.start + G.state.structure.tanks);
  };
  G.maxEngines = function () { return D.STRUCTURE.engines.start + G.state.structure.engines; };
  G.maxStages = function () {
    var s = G.state.research;
    return s.stage4 ? 4 : s.stage3 ? 3 : s.stage2 ? 2 : 1;
  };
  G.satCap = function () {
    return D.STRUCTURE.constellation.start + G.state.structure.constellation * D.STRUCTURE.constellation.step;
  };
  // Ground crew: pad turnaround between auto-launches (0 = no crew yet)
  G.autoTurnaround = function () {
    var s = G.state.research;
    return s.crew4 ? CREW_TURNAROUND.crew4 : s.crew3 ? CREW_TURNAROUND.crew3 :
      s.crew2 ? CREW_TURNAROUND.crew2 : s.crew1 ? CREW_TURNAROUND.crew1 : 0;
  };
  // Seconds per auto-launch. Several rockets can be in the air at once, so
  // it's just the pad turnaround: clicking LAUNCH by hand to grind stops
  // being worth it as soon as you have a crew.
  G.autoInterval = function () { return G.autoTurnaround(); };
  G.missionSlots = function () {
    var r = G.state.research;
    return 1 + (r.dsn1 ? 1 : 0) + (r.dsn2 ? 1 : 0) + (r.dsn3 ? 1 : 0);
  };
  G.shipSlots = function () {
    var r = G.state.research;
    return 1 + (r.yard2 ? 1 : 0) + (r.yard3 ? 1 : 0) + (r.yard4 ? 1 : 0);
  };
  G.SAT_RATE = 40; // $/s per satellite
  G.satRate = function () { return G.state.sats * G.SAT_RATE * G.globalMult(); };
  G.sciRate = function () {
    var r = G.state.research.station ? 3 : 0;
    return (r + G.colonyCount() * D.COLONY.sciRate) * G.globalMult();
  };
  G.colonyFundsRate = function () { return G.colonyCount() * D.COLONY.fundsRate * G.globalMult(); };

  // ---- Sim speed (flight warp) ---------------------------------------------

  G.warpOptions = function () {
    var r = G.state.research;
    return D.WARPS.filter(function (w) { return !w.research || r[w.research]; })
      .map(function (w) { return w.x; });
  };
  G.maxWarp = function () {
    var o = G.warpOptions();
    return o[o.length - 1];
  };
  G.setWarp = function (x) {
    var o = G.warpOptions();
    if (o.indexOf(x) < 0) return false;
    G.warp = x;
    return true;
  };

  // ---- Engines & designs ----------------------------------------------------

  // Effective exhaust velocity (some engines get a later upgrade)
  G.engineVe = function (id) {
    var e = D.ENGINES[id];
    if (!e) return 0;
    return e.upgrade && G.state.research[e.upgrade.research] ? e.upgrade.ve : e.ve;
  };

  G.engineUnlocked = function (id) {
    var e = D.ENGINES[id];
    if (!e) return false;
    return !e.research || !!G.state.research[e.research];
  };
  // Stage 1 lights at sea level: vacuum engines and ion drives can't go there.
  G.engineAllowed = function (id, stageIndex) {
    var e = D.ENGINES[id];
    if (!e || !G.engineUnlocked(id)) return false;
    if (stageIndex === 0 && (e.upper || e.planner)) return false;
    return true;
  };

  G.stageLimit = function (field) {
    return field === 'count' ? G.maxEngines() : G.maxTanks();
  };
  // value: a number, 'max' or 'min'. Returns the clamped value that was set.
  G.setStageField = function (i, field, value, design) {
    design = design || G.state.design;
    var st = design.stages[i];
    if (!st || (field !== 'count' && field !== 'tanks')) return null;
    var lo = field === 'count' ? 1 : 0, hi = G.stageLimit(field);
    var v = value === 'max' ? hi : value === 'min' ? lo : Math.round(+value);
    if (!isFinite(v)) return null;
    v = Math.max(lo, Math.min(hi, v));
    st[field] = v;
    return v;
  };
  G.setStageEngine = function (i, id, design) {
    design = design || G.state.design;
    var st = design.stages[i];
    if (!st || !G.engineAllowed(id, i)) return false;
    st.engine = id;
    return true;
  };
  G.addStage = function (design) {
    design = design || G.state.design;
    var n = design.stages.length;
    if (n >= G.maxStages()) return false;
    var top = design.stages[n - 1];
    design.stages.push({ engine: top.engine, count: 1, tanks: Math.min(2, G.maxTanks()) });
    return true;
  };
  G.removeStage = function (i, design) {
    design = design || G.state.design;
    if (design.stages.length <= 1 || !design.stages[i]) return false;
    design.stages.splice(i, 1);
    if (!G.engineAllowed(design.stages[0].engine, 0)) design.stages[0].engine = 'fizz';
    return true;
  };
  // Pull a design back inside the current limits (after a reset of caps,
  // migrated saves, or a proven vehicle built before a research change).
  G.clampDesign = function (design) {
    design = design || G.state.design;
    while (design.stages.length > G.maxStages()) design.stages.pop();
    design.stages.forEach(function (st, i) {
      if (!G.engineAllowed(st.engine, i)) st.engine = i === 0 ? 'fizz' : design.stages[0].engine;
      st.count = Math.max(1, Math.min(G.maxEngines(), st.count));
      st.tanks = Math.max(0, Math.min(G.maxTanks(), st.tanks));
    });
    return design;
  };

  // Hardware bill per launch. Booster recovery refunds most of stage 1.
  G.designCost = function (design) {
    design = design || G.state.design;
    var total = 0;
    design.stages.forEach(function (st, i) {
      var e = D.ENGINES[st.engine];
      if (!e) return;
      var c = e.unit * st.count + e.tank * st.tanks;
      if (i === 0 && G.state.research.reuse) c *= 0.25;
      total += c;
    });
    return Math.round(total);
  };

  // Resolve the builder design into physics stage specs.
  // Planner engines (ion) don't burn during ascent: they ride as payload and
  // contribute dv to ion-friendly missions instead.
  G.resolveDesign = function (design, payload) {
    design = design || G.state.design;
    payload = isNum(payload) ? payload : G.objectivePayload();
    var dryFrac = G.dryFrac();
    var vac = !!G.state.research.vacNozzles;
    var ascent = [], spaceStages = [];
    var invalid = '';
    var i, st;
    for (i = 0; i < design.stages.length; i++) {
      st = design.stages[i];
      var e = D.ENGINES[st.engine];
      if (!e || st.count < 1) continue;
      if (i === 0 && (e.upper || e.planner)) invalid = e.name + ' can’t be the first stage.';
      var ve = G.engineVe(st.engine);
      if (ve !== e.ve) e = Object.assign({}, e, { ve: ve });
      var spec = {
        engine: e, engineCount: st.count, tanks: st.tanks,
        tankFuel: D.TANK.fuel, tankDry: D.TANK.fuel * dryFrac * (e.dryMult || 1)
      };
      if (e.planner) { spaceStages.push(spec); continue; }
      if (vac && ascent.length > 0 && e.vac) {
        spec = Object.assign({}, spec, { engine: Object.assign({}, e, { ve: e.ve * e.vac }) });
      }
      ascent.push(spec);
    }
    var spaceMass = 0;
    spaceStages.forEach(function (sp) { spaceMass += P.stageMasses(sp).wet; });
    var spaceStats = spaceStages.length ? P.vehicleStats(spaceStages, payload) : null;
    var guided = !!G.state.research.guidance && design.guidanceOn === true;
    return {
      ascent: ascent,
      payload: payload + spaceMass,
      probe: payload,
      spaceDv: spaceStats ? spaceStats.totalDv : 0,
      cdA: G.cdA(),
      turnStart: guided ? design.turnStart : 0,
      turnEnd: guided ? design.turnEnd : 0,
      stats: P.vehicleStats(ascent, payload + spaceMass),
      invalid: invalid || (ascent.length ? '' : 'No engines that work in an atmosphere.')
    };
  };

  G.makeFlight = function (r) {
    return new P.Flight({
      stages: r.ascent, payload: r.payload, cdA: r.cdA,
      turnStart: r.turnStart, turnEnd: r.turnEnd
    });
  };

  // Fly a design headless, start to finish, with no side effects.
  G.simulate = function (design, payload) {
    var r = G.resolveDesign(design, payload);
    if (r.invalid) return null;
    var f = G.makeFlight(r);
    while (f.status === 'flying' && f.t < 7200) f.advance(120);
    if (f.status === 'flying') f.status = 'aborted';
    return { flight: f, resolved: r };
  };

  // ---- Objectives (what the payload is for) ---------------------------------

  G.objectivePayload = function (obj) {
    obj = obj === undefined ? G.state.objective : obj;
    if (obj && obj.kind === 'contract') {
      var c = findBy(G.state.contracts, obj.id);
      if (c) return c.payload;
    }
    if (obj && obj.kind === 'mission') {
      var m = findBy(D.MISSIONS, obj.id);
      if (m) return m.payload;
    }
    return D.PAYLOAD_MASS;
  };
  G.setObjective = function (obj) {
    if (!obj) { G.state.objective = null; G.emit('change'); return true; }
    if (obj.kind === 'contract' && findBy(G.state.contracts, obj.id)) {
      G.state.objective = { kind: 'contract', id: obj.id };
    } else if (obj.kind === 'mission') {
      var m = findBy(D.MISSIONS, obj.id);
      if (!m || !G.missionVisible(m) || !G.state.gotOrbit) return false;
      G.state.objective = { kind: 'mission', id: obj.id,
        traj: obj.traj === 'assist' && G.canAssist(m) ? 'assist' : 'direct' };
    } else return false;
    G.emit('change');
    return true;
  };

  // ---- Milestones -----------------------------------------------------------

  function checkMilestones(f) {
    var st = G.state, out = [], mult = G.globalMult();
    function award(m) {
      st.funds += m.funds * mult;
      st.sci += m.sci * mult;
      earn('milestones', m.funds * mult, m.sci * mult);
      out.push(m);
    }
    D.ALT_MILESTONES.forEach(function (m) {
      var key = 'alt' + m.alt;
      if (!st.milestones[key] && f.maxAlt >= m.alt) { st.milestones[key] = true; award(m); }
    });
    D.SPEED_MILESTONES.forEach(function (m) {
      var key = 'spd' + m.speed;
      if (!st.milestones[key] && f.maxSpeed >= m.speed) { st.milestones[key] = true; award(m); }
    });
    if (f.status === 'orbit' && !st.milestones.orbit) {
      st.milestones.orbit = true;
      st.gotOrbit = true;
      award(D.ORBIT_MILESTONE);
    }
    if (f.status === 'escape' && !st.milestones.escape) {
      st.milestones.escape = true;
      award(D.ESCAPE_MILESTONE);
    }
    return out;
  }

  // ---- Flight lifecycle -----------------------------------------------------

  // Effective income per second, for the UI (passive + auto-launch replay).
  G.autoNet = function () {
    var y = G.state.lastYield;
    if (!y) return { funds: 0, sci: 0 };
    var mult = G.globalMult();
    return { funds: G.flightNet(y.funds * mult, y.cost || 0), sci: y.sci * mult };
  };
  G.incomeRates = function () {
    var st = G.state, iv = G.autoInterval();
    var f = G.satRate() + G.colonyFundsRate();
    var s = G.sciRate();
    if (st.autolaunch && iv > 0 && st.lastYield) {
      var n = G.autoNet();
      f += n.funds / iv;
      s += n.sci / iv;
    }
    return { funds: f, sci: s };
  };

  G.launchCost = function () { return G.designCost(G.state.design); };
  // what a flight actually pays you: its earnings minus hardware, with hardware capped at half the earnings
  G.HARDWARE_CAP = 0.5;
  G.flightNet = function (payout, hardware) { return payout - Math.min(hardware, payout * G.HARDWARE_CAP); };

  // Returns '' if this design can launch right now, else the reason.
  G.launchBlocker = function () {
    if (G.flight && G.flight.status === 'flying') return 'A flight is already in progress.';
    var r = G.resolveDesign();
    if (r.invalid) return r.invalid;
    // no funds check: the sponsor fronts the hardware and is paid back out of the flight's earnings,
    // so you can always launch (being broke can never lock you out)
    return '';
  };

  G.launch = function (manual) {
    if (G.launchBlocker()) return false;
    G.warpTouched = false;
    var st = G.state;
    var r = G.resolveDesign();
    var cost = G.launchCost(); // settled when the flight ends, out of its earnings
    G.flight = G.makeFlight(r);
    G.flightMeta = { spaceDv: r.spaceDv, manual: !!manual, payload: r.probe, cost: cost,
      objective: st.objective ? Object.assign({}, st.objective) : null,
      design: JSON.parse(JSON.stringify(st.design)) };
    G.warp = 1;   // watch the ascent; main.js speeds up the boring coast
    st.totalLaunches++;
    G.emit('launch');
    return true;
  };

  function vehicleKey(design, payload) {
    return JSON.stringify([design.stages, design.guidanceOn ? [design.turnStart, design.turnEnd] : 0, payload]);
  }
  function vehicleName(design) {
    return design.stages.map(function (s) {
      var e = D.ENGINES[s.engine];
      return (s.count > 1 ? s.count + '×' : '') + (e ? e.name.split(' ')[0] : s.engine);
    }).join(' / ');
  }

  // A design that reached orbit with payload P and dv left B is "proven":
  // the Missions tab can dispatch it again without flying it by hand.
  function recordVehicle(design, payload, budget, ionDv) {
    var st = G.state, key = vehicleKey(design, payload);
    var v = null, i;
    for (i = 0; i < st.vehicles.length; i++) if (st.vehicles[i].key === key) v = st.vehicles[i];
    if (v) {
      v.budget = Math.max(v.budget, budget);
      v.ionDv = Math.max(v.ionDv, ionDv);
      st.vehicles.splice(st.vehicles.indexOf(v), 1);
    } else {
      v = { key: key, name: vehicleName(design), payload: payload, budget: budget, ionDv: ionDv,
        stages: JSON.parse(JSON.stringify(design.stages)),
        guidanceOn: !!design.guidanceOn, turnStart: design.turnStart, turnEnd: design.turnEnd };
    }
    st.vehicles.unshift(v);                      // most recent first
    // full garage: drop the vehicle no one would pick (dominated, or oldest)
    while (st.vehicles.length > MAX_VEHICLES) {
      var worst = st.vehicles.length - 1;
      for (i = st.vehicles.length - 1; i > 0; i--) {
        var a = st.vehicles[i];
        var dominated = st.vehicles.some(function (b) {
          return b !== a && b.payload >= a.payload && b.budget >= a.budget &&
            G.designCost(b) <= G.designCost(a);
        });
        if (dominated) { worst = i; break; }
      }
      st.vehicles.splice(worst, 1);
    }
    return v;
  }
  G.vehicleCost = function (v) { return G.designCost(v); };
  G.removeVehicle = function (key) {
    var st = G.state;
    st.vehicles = st.vehicles.filter(function (v) { return v.key !== key; });
    G.emit('change');
  };

  G.endFlight = function () {
    var f = G.flight, meta = G.flightMeta;
    if (!f) return null;
    var st = G.state;
    var gotOrbit = f.status === 'orbit';
    var mult = G.globalMult();
    var funds = D.launchPayout(f.maxAlt, f.maxSpeed, gotOrbit, G.telemetryMult()) * mult;
    var sci = D.launchScience(f.maxAlt) * mult;
    // hardware comes out of the flight's earnings, but never more than half of them: every flight keeps
    // at least 50% of its payout (the sponsor covers the rest), so a big rocket costs profit, never money
    var net = G.flightNet(funds, meta.cost);
    st.funds += net; st.sci += sci;
    earn('flights', net, sci);
    if (f.maxAlt > st.bestAlt) st.bestAlt = f.maxAlt;
    if (f.maxSpeed > st.bestSpeed) st.bestSpeed = f.maxSpeed;

    var result = {
      status: f.status, maxAlt: f.maxAlt, maxSpeed: f.maxSpeed,
      funds: funds, sci: sci, cost: meta.cost, net: net, covered: Math.max(0, meta.cost - (funds - net)), payload: meta.payload,
      satDeployed: false, budget: 0, manual: meta.manual, t: f.t,
      contract: null, mission: null, missionShort: 0
    };
    var inSpace = gotOrbit || f.status === 'escape';
    if (inSpace) {
      // an escape trajectory is already past C3 = 0 (~3.2 km/s beyond LEO)
      result.budget = f.remainingDv() + (gotOrbit ? 0 : 3200);
      if (gotOrbit && meta.payload > st.bestOrbitPayload) st.bestOrbitPayload = meta.payload;
      recordVehicle(meta.design, meta.payload, result.budget, meta.spaceDv);
    }
    var milestones = checkMilestones(f);
    result.milestones = milestones;

    // objective: contract or mission
    var obj = meta.objective;
    if (obj && obj.kind === 'contract') {
      var c = findBy(st.contracts, obj.id);
      if (c && contractMet(c, f, meta.payload)) {
        st.contracts.splice(st.contracts.indexOf(c), 1);
        st.funds += c.funds * mult; st.sci += c.sci * mult;
        earn('contracts', c.funds * mult, c.sci * mult);
        result.contract = c;
        G.addLog('Contract complete: ' + contractText(c) + '  +$' + D.fmt(c.funds * mult) +
          (c.sci ? ' +' + D.fmt(c.sci * mult) + '⚗' : ''), 'good');
        if (st.objective && st.objective.kind === 'contract' && st.objective.id === c.id) st.objective = null;
      }
    } else if (obj && obj.kind === 'mission' && !inSpace) {
      result.missionWhy = 'Didn’t reach orbit — no mission this time.';
    } else if (obj && obj.kind === 'mission' && inSpace) {
      var m = findBy(D.MISSIONS, obj.id);
      if (m) {
        var need = G.missionNeed(m, obj.traj);
        var avail = result.budget + (m.ionOk ? meta.spaceDv : 0);
        var why = G.dispatchBlocker(m, avail, meta.payload, 0, obj.traj);
        if (!why) {
          result.mission = startMission(m, obj.traj, result.budget, meta.spaceDv, true);
        } else {
          result.missionShort = Math.max(0, need - avail);
          result.missionWhy = why;
        }
      }
    }
    if (gotOrbit && !result.mission && st.sats < G.satCap()) { st.sats++; result.satDeployed = true; }

    // the ground crew re-flies your latest free flight (unless you pinned one)
    if (meta.manual && !obj && !st.crewLock) {
      st.lastYield = { funds: funds / mult, sci: sci / mult, orbit: gotOrbit, cost: meta.cost,
        t: f.t, name: vehicleName(meta.design), status: f.status, maxAlt: f.maxAlt };
      result.crewJob = true;
    }
    G.lastResult = result;
    G.flight = null; G.flightMeta = null;
    G.emit('flightEnd', result);
    return result;
  };

  // ---- Purchases ------------------------------------------------------------

  G.structureMaxed = function (key) {
    var spec = D.STRUCTURE[key], owned = G.state.structure[key];
    if (key === 'constellation') return G.satCap() >= spec.max;
    if (key === 'tanks') return spec.start + owned >= G.tankCap();
    return spec.start + owned >= spec.max;
  };
  G.buyStructure = function (key) {
    var spec = D.STRUCTURE[key], st = G.state;
    if (!spec || G.structureMaxed(key)) return false;
    var cost = D.structureCost(spec, st.structure[key]);
    if (st.funds < cost) return false;
    st.funds -= cost; st.structure[key]++;
    G.emit('change');
    return true;
  };
  // Buy as many as affordable (the "max" button). Returns how many.
  G.buyStructureMax = function (key) {
    var n = 0;
    while (n < 200 && G.buyStructure(key)) n++;
    return n;
  };

  G.researchById = function (id) { return findBy(D.RESEARCH, id); };
  G.researchGate = function (r) {
    // unmet non-research gates, for the UI ("reach 10 km", ...)
    var st = G.state, parts = [];
    if (r.requiresAlt && st.bestAlt < r.requiresAlt) parts.push('reach ' + D.fmtDist(r.requiresAlt));
    if (r.requiresOrbit && !st.gotOrbit) parts.push('reach orbit');
    if (r.requiresMission && !st.missionsDone[r.requiresMission]) {
      var m = findBy(D.MISSIONS, r.requiresMission);
      parts.push('complete ' + (m ? m.name : r.requiresMission));
    }
    if (r.requiresStar && !G.starVisited(r.requiresStar)) {
      var s = findBy(D.STARS, r.requiresStar);
      parts.push('reach ' + (s ? s.name : r.requiresStar));
    }
    return parts.join(', ');
  };
  G.researchPrereqsMet = function (r) {
    if (!r.requires) return true;
    for (var i = 0; i < r.requires.length; i++) if (!G.state.research[r.requires[i]]) return false;
    return true;
  };
  G.researchVisible = function (r) {
    return G.researchPrereqsMet(r) && !G.researchGate(r);
  };
  G.researchCost = function (r) {
    return { funds: (r.cost && r.cost.funds) || 0, sci: (r.cost && r.cost.sci) || 0 };
  };
  G.canResearch = function (id) {
    var r = findBy(D.RESEARCH, id), st = G.state;
    if (!r || st.research[id] || !G.researchVisible(r)) return false;
    var c = G.researchCost(r);
    return st.funds >= c.funds && st.sci >= c.sci;
  };
  G.buyResearch = function (id) {
    if (!G.canResearch(id)) return false;
    var st = G.state, r = findBy(D.RESEARCH, id), c = G.researchCost(r);
    st.funds -= c.funds; st.sci -= c.sci; st.research[id] = true;
    if (id === 'crew1') st.autolaunch = true; // you hired the crew; they launch
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
    earn('outsourcing', -cost, D.outsourceSci(st.outsourced) * G.globalMult());
    st.outsourced++;
    G.emit('change');
    return true;
  };

  // ---- Contracts ------------------------------------------------------------

  var PAYLOADS = [25, 50, 100, 150, 250, 400, 600, 800, 1200];
  function niceNum(x) {
    var e = Math.pow(10, Math.floor(Math.log10(x)));
    return Math.max(e, Math.round(x / (e / 2)) * (e / 2));
  }
  function pick(list) { return list[Math.min(list.length - 1, Math.floor(G.rng() * list.length))]; }

  function contractText(c) {
    return c.kind === 'alt' ? 'reach ' + D.fmtDist(c.target) + ' with ' + c.payload + ' kg' :
      c.kind === 'speed' ? 'hit ' + D.fmtSpeed(c.target) + ' with ' + c.payload + ' kg' :
      'put a ' + c.payload + ' kg satellite in orbit';
  }
  G.contractText = contractText;
  function contractMet(c, f, payload) {
    if (payload < c.payload) return false;
    if (c.kind === 'alt') return f.maxAlt >= c.target;
    if (c.kind === 'speed') return f.maxSpeed >= c.target;
    return f.status === 'orbit';
  }

  var CLIENTS = ['the Weather Service', 'a university physics club', 'Amog’s cousin', 'a cereal brand',
    'the Ministry of Vibes', 'a crypto startup (paid upfront, thankfully)', 'the local news',
    'a very rich cat', 'the Groupoid Appreciation Society', 'an ant farm (they want to see the curvature)'];

  G.makeContract = function () {
    var st = G.state, kinds = [];
    if (st.bestAlt >= D.CONTRACTS.unlockAlt && st.bestAlt < 300e3) kinds.push('alt');
    if (st.bestSpeed >= 343 && st.bestSpeed < 7000) kinds.push('speed');
    if (st.gotOrbit) kinds.push('orbit', 'orbit');
    if (!kinds.length) return null;
    var kind = pick(kinds), c = { kind: kind };
    var stretch = G.rng() < 0.4;
    var maxIdx;
    if (kind === 'alt') {
      c.target = niceNum(Math.max(500, st.bestAlt * (stretch ? 1.15 + G.rng() * 0.6 : 0.4 + G.rng() * 0.5)));
      maxIdx = st.bestAlt < 3e3 ? 2 : st.bestAlt < 30e3 ? 3 : 4;
      c.payload = PAYLOADS[Math.floor(G.rng() * (maxIdx + 1))];
      var base = D.launchPayout(c.target, 0, false, 1);
      c.funds = Math.round(4 * base * Math.pow(c.payload / 100, 0.5) * (stretch ? 1.6 : 1) + 25);
      c.sci = c.target >= 5e3 ? Math.round(5 * D.launchScience(c.target) * (stretch ? 1.5 : 1)) : 0;
    } else if (kind === 'speed') {
      c.target = niceNum(Math.max(200, st.bestSpeed * (stretch ? 1.15 + G.rng() * 0.5 : 0.4 + G.rng() * 0.5)));
      maxIdx = st.bestSpeed < 500 ? 2 : st.bestSpeed < 2000 ? 3 : 4;
      c.payload = PAYLOADS[Math.floor(G.rng() * (maxIdx + 1))];
      var sb = D.launchPayout(0, c.target, false, 1) + D.launchPayout(c.target * 15, 0, false, 1);
      c.funds = Math.round(4 * sb * Math.pow(c.payload / 100, 0.5) * (stretch ? 1.6 : 1) + 25);
      c.sci = c.target >= 1000 ? Math.round(3 * D.launchScience(c.target * 15) * (stretch ? 1.5 : 1)) : 0;
    } else {
      var top = Math.max(100, st.bestOrbitPayload);
      var opts = PAYLOADS.filter(function (p) { return p >= 100 && p <= top * (stretch ? 2 : 1); });
      if (!opts.length) opts = [100];
      if (stretch) { opts = opts.filter(function (p) { return p > top; }); if (!opts.length) opts = [top]; }
      c.payload = pick(opts);
      c.target = 0;
      c.funds = Math.round(8000 * Math.pow(c.payload / 100, 0.8) * (stretch ? 1.4 : 1));
      c.sci = Math.round(120 * Math.pow(c.payload / 100, 0.6));
    }
    c.stretch = stretch;
    c.client = pick(CLIENTS);
    c.id = 'c' + (++st.contractSeq);
    c.expires = st.clock + D.CONTRACTS.expire;
    return c;
  };

  function tickContracts() {
    var st = G.state;
    for (var i = st.contracts.length - 1; i >= 0; i--) {
      if (st.contracts[i].expires <= st.clock) {
        var gone = st.contracts.splice(i, 1)[0];
        if (st.objective && st.objective.kind === 'contract' && st.objective.id === gone.id) {
          st.objective = null;
          G.addLog('Contract expired: ' + contractText(gone), 'warn');
        }
        G.emit('change');
      }
    }
    if (st.clock >= st.nextContractAt) {
      st.nextContractAt = st.clock + D.CONTRACTS.every;
      if (st.contracts.length < D.CONTRACTS.board) {
        var c = G.makeContract();
        if (c) { st.contracts.push(c); G.emit('contract', c); G.emit('change'); }
      }
    }
  }
  G.declineContract = function (id) {
    var st = G.state, c = findBy(st.contracts, id);
    if (!c) return false;
    st.contracts.splice(st.contracts.indexOf(c), 1);
    if (st.objective && st.objective.id === id) st.objective = null;
    G.emit('change');
    return true;
  };

  // ---- Missions -------------------------------------------------------------

  G.missionById = function (id) { return findBy(D.MISSIONS, id); };
  G.missionVisible = function (m) {
    return !m.requires || !!G.state.missionsDone[m.requires];
  };
  G.canAssist = function (m) { return !!(m.assistDv && G.state.research.slingshot); };

  // Every planet gets its own window phase so they don't all line up.
  function windowOffset(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    return h / 997;
  }
  // {open, left}: is the window open, and seconds until that changes
  G.missionWindow = function (m, t) {
    if (!m.window) return { open: true, left: Infinity, always: true };
    t = isNum(t) ? t : G.state.clock;
    var ph = (t / m.window + windowOffset(m.id)) % 1;
    var open = ph < D.WINDOW.open;
    return { open: open, left: (open ? D.WINDOW.open - ph : 1 - ph) * m.window };
  };

  G.missionNeed = function (m, traj, t) {
    var dv = m.dv;
    if (traj === 'assist' && G.canAssist(m)) dv = m.assistDv;
    if (m.aeroDv && G.state.research.aerobrake) dv *= m.aeroDv / m.dv;
    if (!G.missionWindow(m, t).open) dv *= D.WINDOW.offPenalty;
    return Math.round(dv);
  };
  G.missionOps = function (m) {
    return (m.cost || 0) * (G.state.missionsDone[m.id] ? 0.5 : 1);
  };
  G.missionReward = function (m, k) {
    // k = completions so far
    if (k === undefined) k = G.state.missionsDone[m.id] || 0;
    if (!k) return { funds: m.funds, sci: m.sci, first: true };
    var R = D.REPEAT;
    return {
      funds: m.funds * Math.max(R.fundsFloor, R.funds * Math.pow(R.fundsDecay, k - 1)),
      sci: m.sci * R.sci * Math.pow(R.sciDecay, k - 1),
      first: false
    };
  };
  // Excess Δv buys a faster trajectory — barely-enough budget flies the slow
  // Hohmann transfer, double the budget roughly halves the trip. Gravity
  // assists and ion legs take longer.
  G.missionDuration = function (m, budget, traj, ion) {
    var need = G.missionNeed(m, traj);
    var ratio = need > 0 ? budget / need : 1;
    var timeMult = Math.max(0.5, Math.min(1, 2 / (1 + ratio)));
    return m.time * timeMult * (traj === 'assist' ? 1.6 : 1) * (ion ? 1.5 : 1);
  };
  G.activeCount = function () { return G.state.missions.length; };

  // '' if mission m can depart with this much dv and payload, else why not.
  // extraCost: the vehicle's hardware (0 when it already flew).
  G.dispatchBlocker = function (m, budget, payload, extraCost, traj) {
    var st = G.state;
    if (!st.gotOrbit) return 'Reach orbit first.';
    if (!G.missionVisible(m)) return 'Locked.';
    if (st.missions.length >= G.missionSlots()) return 'All mission slots busy.';
    if (payload < m.payload) return 'Payload too light (' + m.payload + ' kg needed).';
    var need = G.missionNeed(m, traj);
    if (budget < need) return 'Short by ' + D.fmtSpeed(need - budget) + '.';
    if (st.funds < G.missionOps(m) + (extraCost || 0)) return 'Can’t afford it.';
    return '';
  };

  function startMission(m, traj, budget, ionDv, manual) {
    var st = G.state;
    var need = G.missionNeed(m, traj);
    var ion = m.ionOk && budget < need && budget + ionDv >= need;
    var total = budget + (m.ionOk ? ionDv : 0);
    var ops = G.missionOps(m);
    st.funds -= ops;
    earn('missions', -ops, 0);
    var am = { uid: ++st.uid, id: m.id, t0: st.clock, dur: G.missionDuration(m, total, traj, ion),
      traj: traj === 'assist' && G.canAssist(m) ? 'assist' : 'direct', mult: 1, ion: ion, manual: !!manual };
    st.missions.push(am);
    G.addLog('Mission underway: ' + m.name + (am.traj === 'assist' ? ' (gravity assist)' : '') +
      (ion ? ' (ion leg)' : '') + ' — ETA ' + D.fmtTime(am.dur) + (ops ? ' (ops −$' + D.fmt(ops) + ')' : ''), 'info');
    G.emit('missionStart', { mission: m, active: am });
    G.emit('change');
    return am;
  }

  // Proven vehicles that can fly mission m right now, cheapest first.
  G.capableVehicles = function (m, traj) {
    var need = G.missionNeed(m, traj);
    return G.state.vehicles.filter(function (v) {
      return v.payload >= m.payload && v.budget + (m.ionOk ? v.ionDv : 0) >= need;
    }).sort(function (a, b) { return G.designCost(a) - G.designCost(b); });
  };
  // What a dispatch would cost and whether it can go: {vehicle, cost, why}
  G.dispatchPlan = function (m, traj) {
    var vs = G.capableVehicles(m, traj);
    if (!vs.length) {
      var best = 0;
      G.state.vehicles.forEach(function (v) {
        if (v.payload >= m.payload) best = Math.max(best, v.budget + (m.ionOk ? v.ionDv : 0));
      });
      return { vehicle: null, cost: 0, why: best ? 'Best proven vehicle for ' + m.payload + ' kg has ' +
        D.fmtSpeed(best) + ' — need ' + D.fmtSpeed(G.missionNeed(m, traj)) + '.' :
        'No proven vehicle carries ' + m.payload + ' kg to orbit yet.' };
    }
    var v = vs[0], cost = G.designCost(v);
    var why = G.dispatchBlocker(m, v.budget + (m.ionOk ? v.ionDv : 0), v.payload, cost, traj);
    return { vehicle: v, cost: cost + G.missionOps(m), why: why };
  };
  // Re-fly a proven vehicle for mission id (no flight to watch).
  G.dispatch = function (id, traj, manual) {
    var m = findBy(D.MISSIONS, id), st = G.state;
    if (!m) return null;
    traj = traj === 'assist' && G.canAssist(m) ? 'assist' : 'direct';
    var plan = G.dispatchPlan(m, traj);
    if (!plan.vehicle || plan.why) return null;
    var hw = G.designCost(plan.vehicle);
    st.funds -= hw;
    earn('missions', -hw, 0);
    st.totalLaunches++;
    return startMission(m, traj, plan.vehicle.budget, plan.vehicle.ionDv, manual);
  };
  G.setAutoMission = function (id, on, traj) {
    var st = G.state;
    if (!st.research.dispatch || !findBy(D.MISSIONS, id)) return false;
    if (on) st.autoMissions[id] = traj === 'assist' ? 'assist' : 'direct';
    else delete st.autoMissions[id];
    G.emit('change');
    return true;
  };

  function finishMission(am) {
    var st = G.state;
    var m = findBy(D.MISSIONS, am.id);
    var idx = st.missions.indexOf(am);
    if (idx >= 0) st.missions.splice(idx, 1);
    if (!m) return;
    var rw = G.missionReward(m);
    // manual descent outcome (landing missions): soft touchdown 1.5x, crater 0.5x
    var dMult = isNum(am.mult) ? am.mult : 1;
    var mult = G.globalMult() * dMult;
    st.funds += rw.funds * mult;
    st.sci += rw.sci * mult;
    earn('missions', rw.funds * mult, rw.sci * mult);
    st.missionsDone[m.id] = (st.missionsDone[m.id] || 0) + 1;
    G.addLog((rw.first ? 'MISSION COMPLETE: ' : 'Repeat mission: ') + m.name +
      (dMult > 1 ? ' — flawless landing!' : dMult < 1 ? ' — probe arrived as debris.' : '') +
      '  +$' + D.fmt(rw.funds * mult) + ' +' + D.fmt(rw.sci * mult) + '⚗', 'good');
    G.emit('missionDone', { mission: m, first: rw.first, funds: rw.funds * mult, sci: rw.sci * mult });
    G.emit('change');
  }

  // Called by the manual-descent minigame while its mission is in transit.
  G.setDescentResult = function (uid, mult) {
    G.state.missions.forEach(function (am) { if (am.uid === uid) am.mult = mult; });
  };

  function tickMissions() {
    var st = G.state;
    if (!G.missionHold) {
      var done = st.missions.filter(function (am) { return st.clock - am.t0 >= am.dur; });
      done.forEach(finishMission);
    }
    // auto-dispatch: only inside launch windows, only when it can pay, and
    // (once you have two or more slots) never into the last free one — that
    // one is kept for whatever you fly yourself
    if (st.research.dispatch) {
      var reserve = G.missionSlots() >= 2 ? 1 : 0;
      Object.keys(st.autoMissions).forEach(function (id) {
        var m = findBy(D.MISSIONS, id);
        if (!m || st.missions.length + reserve >= G.missionSlots()) return;
        if (!G.missionWindow(m).open) return;
        var plan = G.dispatchPlan(m, st.autoMissions[id]);
        if (plan.vehicle && !plan.why) G.dispatch(id, st.autoMissions[id], false);
      });
    }
  }

  // ---- Starships (phase 3) --------------------------------------------------

  G.phase = function () {
    var st = G.state;
    if (st.won) return 4;
    if (st.missionsDone.voyager) return 3;
    if (st.gotOrbit) return 2;
    return 1;
  };

  G.starById = function (id) { return findBy(D.STARS, id); };
  G.starVisited = function (id) { return !!(G.state.flybys[id] || G.state.colonies[id]); };
  // Sequential navigation: the previous destination must be visited first.
  G.starPrev = function (star) {
    var i = D.STARS.indexOf(star);
    return i > 0 ? D.STARS[i - 1] : null;
  };
  G.starUnlocked = function (star) {
    var prev = G.starPrev(star);
    return !prev || G.starVisited(prev.id);
  };

  G.shipCruise = function (engineId, ratio, mode) {
    // returns cruise speed as fraction of c, or -1 if impossible
    var r = G.state.research;
    if (engineId === 'sail') {
      if (mode === 'colonize' && !r.magsail) return -1;
      return r.laser ? 0.12 : 0.02;
    }
    var e = D.STAR_ENGINES[engineId];
    if (!e || !isNum(ratio) || ratio < 1) return -1;
    var dv = P.tsiolkovskyRel(e.ve, ratio, 1);
    var cruise = (mode === 'colonize' ? dv / 2 : dv) / P.C.C_LIGHT;
    return Math.min(cruise, 0.99);
  };

  // Drive (bigger mass ratio = more fuel = more money) plus, for colony
  // ships, the settlers: a fixed share of the destination's value.
  G.shipCost = function (engineId, ratio, mode, starId) {
    var e = D.STAR_ENGINES[engineId];
    if (!e) return Infinity;
    var c = e.sail ? e.base : e.base * Math.pow(ratio, 0.8);
    if (mode === 'colonize') {
      c *= 2;
      var star = findBy(D.STARS, starId);
      if (star) c += star.funds * D.COLONY.settlers;
    }
    return c;
  };

  G.shipEngineUnlocked = function (engineId) {
    var r = G.state.research;
    return { orion: !!r.orion, fusion: !!r.fusionEng, antimatter: !!r.antimatterEng, sail: !!r.sailTech }[engineId] || false;
  };

  // What the next arrival at this star would pay. Flat: no multipliers.
  G.starReward = function (star, mode) {
    var st = G.state, F = D.FLYBY;
    if (mode === 'colonize' && !st.colonies[star.id]) {
      return { funds: star.funds * D.COLONY.payback, sci: star.sci, colony: true };
    }
    var k = st.flybys[star.id] || 0;
    if (!k && !st.colonies[star.id]) {
      return { funds: star.funds * (star.precursor ? F.precursorFunds : F.funds), sci: star.sci * F.sci };
    }
    return { funds: 0, sci: star.sci * F.repeat * Math.pow(F.decay, Math.max(0, k - 1)) };
  };

  G.shipBlocker = function (engineId, ratio, mode, starId) {
    var st = G.state, star = findBy(D.STARS, starId);
    if (!star) return 'Pick a target.';
    if (!G.shipEngineUnlocked(engineId)) return 'Research a starship drive first.';
    if (st.ships.length >= G.shipSlots()) return 'Shipyard busy (' + st.ships.length + '/' + G.shipSlots() + ' ships in flight).';
    if (!G.starUnlocked(star)) return 'No nav data yet — visit ' + G.starPrev(star).name + ' first.';
    if (mode === 'colonize' && star.precursor) return 'Nothing to colonize out there — flyby only.';
    if (mode === 'colonize' && st.colonies[star.id]) return 'Already colonized.';
    if (star.intergalactic && !G.colonyCount()) return 'Found a colony among the stars first.';
    if (G.shipCruise(engineId, ratio, mode) <= 0) return 'Sails can’t brake — research the magnetic sail to colonize with one.';
    if (st.funds < G.shipCost(engineId, ratio, mode, starId)) return 'Can’t afford it.';
    return '';
  };

  G.launchShip = function (engineId, ratio, mode, starId) {
    if (G.shipBlocker(engineId, ratio, mode, starId)) return false;
    var st = G.state, star = findBy(D.STARS, starId);
    var cruise = G.shipCruise(engineId, ratio, mode);
    var cost = G.shipCost(engineId, ratio, mode, starId);
    st.funds -= cost;
    earn('starships', -cost, 0);
    st.ships.push({
      uid: ++st.uid, engine: engineId, ratio: ratio, mode: mode, star: starId,
      progressLy: 0, cruiseC: cruise, name: D.STAR_ENGINES[engineId].name
    });
    G.addLog('Starship departed for ' + star.name + ' at ' + cruise.toFixed(3) + 'c (' +
      D.fmtYears(star.ly / cruise) + ' of travel)', 'info');
    G.emit('change');
    return true;
  };

  G.warpRate = function () { return 2 * Math.pow(4, G.state.warpLevel); }; // sim-years per real second
  G.warpUpCost = function () { return 2e5 * Math.pow(6, G.state.warpLevel); };
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
      var star = findBy(D.STARS, s.star);
      if (star && s.progressLy >= star.ly) arrived.push({ ship: s, star: star });
    });
    arrived.forEach(function (a) {
      var idx = st.ships.indexOf(a.ship);
      if (idx >= 0) st.ships.splice(idx, 1);
      var rw = G.starReward(a.star, a.ship.mode);
      st.funds += rw.funds; st.sci += rw.sci;
      earn('starships', rw.funds, rw.sci);
      if (rw.colony) {
        st.colonies[a.star.id] = true;
        G.addLog('COLONY ESTABLISHED at ' + a.star.name + '! All income ×2. +$' +
          D.fmt(rw.funds) + ' +' + D.fmt(rw.sci) + '⚗', 'good');
        if (a.star.intergalactic && !st.won) {
          st.won = true;
          G.emit('won');
        }
      } else {
        st.flybys[a.star.id] = (st.flybys[a.star.id] || 0) + 1;
        G.addLog((rw.funds ? 'Flyby of ' + a.star.name + ' — photos incredible. +$' + D.fmt(rw.funds) + ' ' :
          'Another flyby of ' + a.star.name + ' — nice, but we have these photos. ') +
          '+' + D.fmt(rw.sci) + '⚗', 'good');
      }
      G.emit('shipArrived', { star: a.star, reward: rw });
      G.emit('change');
    });
  }

  // ---- Main tick ------------------------------------------------------------

  G.tick = function (dtReal) {
    var st = G.state;
    if (!(dtReal > 0)) return;
    st.timePlayed += dtReal;
    st.clock += dtReal;

    // passive income
    var f = (G.satRate() + G.colonyFundsRate()) * dtReal;
    if (f > 0) st.funds += f;
    var s = G.sciRate() * dtReal;
    if (s > 0) st.sci += s;
    if (f > 0 || s > 0) earn('passive', f, s);

    // auto-launch: the ground crew re-flies the recorded result of your last
    // manual flight (paused while you fly by hand, skipped if it can't pay)
    var iv = G.autoInterval();
    if (st.autolaunch && iv > 0 && st.lastYield && !(G.flight && G.flightMeta && G.flightMeta.manual)) {
      G._autoT += dtReal;
      var mult = G.globalMult();
      while (G._autoT >= iv) {
        G._autoT -= iv;
        var y = st.lastYield;
        // same deal as a manual flight: hardware comes out of the earnings and never takes you below $0
        var net = G.flightNet(y.funds * mult, y.cost);
        st.funds += net;
        st.sci += y.sci * mult;
        earn('crew', net, y.sci * mult);
        st.totalLaunches++;
        if (y.orbit && st.sats < G.satCap()) st.sats++;
      }
    }

    tickContracts();
    tickMissions();
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

  // Advance the game clock by `seconds` in chunks (offline progress).
  G.fastForward = function (seconds) {
    var steps = Math.min(4000, Math.max(1, Math.ceil(seconds / 2)));
    var dt = seconds / steps;
    var hold = G.missionHold; G.missionHold = false;
    for (var i = 0; i < steps; i++) G.tick(dt);
    G.missionHold = hold;
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
    G.clampDesign();
    // offline progress
    var away = Math.min(Math.max((Date.now() - (s.lastSave || Date.now())) / 1000, 0), OFFLINE_CAP);
    if (away > 60) {
      var f0 = s.funds, s0 = s.sci, l0 = s.totalLaunches, m0 = 0, k;
      for (k in s.missionsDone) m0 += s.missionsDone[k];
      G.fastForward(away);
      var m1 = 0; for (k in G.state.missionsDone) m1 += G.state.missionsDone[k];
      var df = G.state.funds - f0, ds = G.state.sci - s0;
      var summary = 'While you were away (' + D.fmtTime(away) + '): ' + (df >= 0 ? '+$' : '−$') + D.fmt(Math.abs(df)) +
        ', +' + D.fmt(Math.max(0, ds)) + '⚗' +
        (G.state.totalLaunches > l0 ? ', ' + (G.state.totalLaunches - l0) + ' launches' : '') +
        (m1 > m0 ? ', ' + (m1 - m0) + ' missions completed' : '');
      G.addLog(summary, 'info');
      G.offlineSummary = summary; // UI shows this as a toast once it boots
    }
    return G.state;
  };

  G.hardReset = function () {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    G.state = freshState();
    G.flight = null; G.flightMeta = null; G.log = []; G.lastResult = null; G._autoT = 0;
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
      if (isNum(s.v) && s.v > SAVE_VERSION) return false;
      G.state = sanitizeState(s);
      G.clampDesign();
      G.flight = null; G.flightMeta = null;
      G.save();
      G.emit('change');
      return true;
    } catch (e) { return false; }
  };

  root.ASP.game = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
