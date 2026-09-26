/* Amog Space Program — game data & economy.
 * All dv numbers are real-ish (LEO-departure budgets, m/s). Shared with the
 * node balance harness.
 */
(function (root) {
  'use strict';

  // ---- Engines --------------------------------------------------------------
  // ve m/s, thrust N, mass kg. cost is a one-time purchase ($).
  // planner: usable in the mission planner only (TWR too low to matter live).
  var ENGINES = {
    fizz:   { id: 'fizz',   name: 'Fizz-1',            ve: 400,    thrust: 7.0e3,  mass: 30,   cost: 0,
              blurb: 'A soda bottle, a bike pump, and optimism. ve = 400 m/s.' },
    sundancer:{ id:'sundancer', name: 'Sundancer',     ve: 1400,   thrust: 1.4e4,  mass: 80,   cost: 250,
              blurb: 'Hobby-store solid motor, scaled up irresponsibly.' },
    kestrel:{ id: 'kestrel',name: 'Kestrel',           ve: 2500,   thrust: 2.6e4,  mass: 180,  cost: 1200,
              blurb: 'A real kerolox engine. Small, honest, flammable.' },
    merlin: { id: 'merlin', name: 'Merlin-ish',        ve: 3000,   thrust: 1.2e5,  mass: 450,  cost: 9000,
              blurb: 'Now we are actually doing this.' },
    raptor: { id: 'raptor', name: 'Raptor-class',      ve: 3550,   thrust: 4.5e5,  mass: 950,  cost: 60000,
              blurb: 'Full-flow staged combustion. Amog approves.' },
    nerva:  { id: 'nerva',  name: 'NERVA (nuclear)',   ve: 8800,   thrust: 8.0e4,  mass: 1200, cost: 250000,
              blurb: 'A nuclear reactor with a hole in one end. ve = 8.8 km/s, and real 1960s hardware.' },
    ion:    { id: 'ion',    name: 'Ion drive',         ve: 30000,  thrust: 100,    mass: 60,   cost: 120000, planner: true,
              blurb: 'Shoots ions. Absurd ve = 30 km/s, thrust of a gentle breeze. Cannot lift off anything — pure orbital Δv.' }
  };

  // Starship drives (phase 3). ve in m/s; sail is special-cased.
  var STAR_ENGINES = {
    orion:      { id: 'orion',      name: 'Orion nuclear pulse', ve: 1.0e6,
                  blurb: 'A series of nuclear explosions behind the ship. Genuinely a real 1958 design.' },
    fusion:     { id: 'fusion',     name: 'Fusion torch',        ve: 8.0e6,
                  blurb: 'Continuous fusion exhaust at ~2.7% of lightspeed.' },
    antimatter: { id: 'antimatter', name: 'Antimatter core',     ve: 1.0e8,
                  blurb: 've ≈ c/3. The rocket equation goes relativistic: Δv = c·tanh(ve/c · ln(m₀/m₁)).' },
    sail:       { id: 'sail',       name: 'Solar sail',          ve: 0, sail: true,
                  blurb: 'No propellant at all — photon pressure from sunlight. Cheap, but it cannot slow down.' }
  };

  // ---- Tanks / structure ----------------------------------------------------
  var TANK = { fuel: 250, dryFrac: 0.10 };    // kg fuel per tank; dry = frac*fuel
  var PAYLOAD_MASS = 100;                      // kg probe on top
  var BASE_CDA = 0.9;                          // m^2 * Cd, before aero research

  // ---- Structure upgrades (funds, geometric costs) --------------------------
  var STRUCTURE = {
    tanks:   { name: 'Tank factory',   desc: '+1 max tanks per stage',   base: 30,   growth: 1.5,  start: 2, max: 30 },
    engines: { name: 'Engine cluster', desc: '+1 max engines per stage', base: 250,  growth: 2.2,  start: 1, max: 9 },
    constellation: { name: 'Constellation slots', desc: '+2 max satellites', base: 250000, growth: 2.2, start: 4, max: 30, step: 2 }
  };

  // ---- Milestones -----------------------------------------------------------
  var ALT_MILESTONES = [
    { alt: 300,    funds: 150,    sci: 0,   name: 'Cleared the treeline',            note: 'It flew. Technically.' },
    { alt: 1e3,    funds: 400,    sci: 0,   name: '1 km up',                          note: 'Higher than Amog’s apartment.' },
    { alt: 3e3,    funds: 900,    sci: 0,   name: '3 km — small aircraft territory',  note: 'Please file a flight plan.' },
    { alt: 10e3,   funds: 2500,   sci: 25,  name: '10 km — airliner altitude',        note: 'Science unlocked! High-altitude data is worth something.' },
    { alt: 20e3,   funds: 5000,   sci: 50,  name: '20 km — stratosphere',             note: 'The sky is getting dark.' },
    { alt: 35e3,   funds: 10000,  sci: 80,  name: '35 km — weather balloons quit here', note: 'Air is 1% of sea level. Drag barely matters now.' },
    { alt: 50e3,   funds: 20000,  sci: 120, name: '50 km — mesosphere',               note: 'Halfway to space by altitude. Nowhere near by Δv.' },
    { alt: 100e3,  funds: 60000,  sci: 300, name: '100 km — THE KÁRMÁN LINE', note: 'You are officially in space. Amog is losing it. Guidance research available.' },
    { alt: 200e3,  funds: 130000, sci: 400, name: '200 km — definitely space',        note: 'Going up is solved. Now try going sideways fast enough to miss the ground.' }
  ];
  var SPEED_MILESTONES = [
    { speed: 343,  funds: 700,    sci: 20,  name: 'Mach 1',            note: 'The rocket is now louder behind itself.' },
    { speed: 1000, funds: 3000,   sci: 40,  name: '1 km/s',            note: 'Faster than a rifle round.' },
    { speed: 3000, funds: 15000,  sci: 100, name: '3 km/s',            note: 'A third of the way to orbital velocity.' },
    { speed: 7800, funds: 120000, sci: 200, name: 'Orbital velocity',  note: '7.8 km/s sideways. The magic number.' }
  ];

  // ---- Research tree (science) ---------------------------------------------
  // requiresAlt: max altitude ever reached gate. requires: other research ids.
  var RESEARCH = [
    { id: 'aero1',    name: 'Aerodynamics I',    sci: 30,    requiresAlt: 3e3,
      desc: 'Nose cone + fins. Drag ×0.72.' },
    { id: 'aero2',    name: 'Aerodynamics II',   sci: 150,   requires: ['aero1'],
      desc: 'Actual wind-tunnel time. Drag ×0.55 total.' },
    { id: 'aero3',    name: 'Aerodynamics III',  sci: 700,   requires: ['aero2'],
      desc: 'Grid fins & a very pointy hat. Drag ×0.4 total.' },
    { id: 'mat1',     name: 'Materials I',       sci: 40,    requiresAlt: 10e3,
      desc: 'Lighter tanks: dry mass 10% → 8% of fuel.' },
    { id: 'mat2',     name: 'Materials II',      sci: 200,   requires: ['mat1'],
      desc: 'Tank dry mass → 6.5%.' },
    { id: 'mat3',     name: 'Materials III',     sci: 700,   requires: ['mat2'],
      desc: 'Tank dry mass → 5%.' },
    { id: 'stage2',   name: 'Staging',           sci: 30,    requiresAlt: 20e3,
      desc: 'Drop empty tanks mid-flight. The rocket equation loves this: each stage gets its own Δv = ve·ln(m₀/m₁). Unlocks “+ add stage” in the builder.' },
    { id: 'stage3',   name: 'Triple staging',    sci: 300,   requires: ['stage2'],
      desc: 'A third stage slot for the builder. Now you’re thinking with logarithms.' },
    { id: 'engKestrel',name:'Kestrel engine',    sci: 20,    requiresAlt: 3e3,
      desc: 'Unlock a real liquid-fuel engine for purchase.' },
    { id: 'engMerlin', name:'Merlin-ish engine', sci: 120,   requires: ['engKestrel'], requiresAlt: 20e3,
      desc: 'Serious thrust, ve = 3.0 km/s.' },
    { id: 'engRaptor', name:'Raptor-class',      sci: 400,   requires: ['engMerlin'], requiresAlt: 100e3,
      desc: 've = 3.55 km/s and outrageous thrust.' },
    { id: 'vacNozzles', name:'Vacuum nozzles',   sci: 600,   requiresAlt: 100e3,
      desc: 'Big engine bells only work where there’s no air pushing back: stages 2+ get +15% ve.' },
    { id: 'engNerva',  name:'Nuclear thermal',   sci: 1200,  requires: ['engRaptor'], requiresOrbit: true,
      desc: 'NERVA: ve = 8.8 km/s. Best as an upper stage.' },
    { id: 'engIon',    name:'Ion propulsion',    sci: 900,   requiresOrbit: true,
      desc: 've = 30 km/s, thrust ≈ a sheet of paper resting on your hand. Mission-planner Δv only.' },
    { id: 'guidance', name: 'Guidance computer', sci: 200,   requiresAlt: 100e3,
      desc: 'Gravity turn program. Orbit is 90% sideways — unlock the pitch-over sliders. Toggleable: straight-up flights still fly higher until your rockets are orbit-class.' },
    { id: 'telem1',   name: 'Telemetry I',       sci: 50,    requiresAlt: 10e3,
      desc: 'Launch payouts ×1.5.' },
    { id: 'telem2',   name: 'Telemetry II',      sci: 300,   requires: ['telem1'],
      desc: 'Launch payouts ×2.25 total.' },
    { id: 'mc1',      name: 'Mission Control I', sci: 100,   requiresAlt: 10e3,
      desc: 'Auto-launch: repeats your most recent flight result every 30s. Fly your best design once, then let it run.' },
    { id: 'mc2',      name: 'Mission Control II',sci: 400,   requires: ['mc1'],
      desc: 'Auto-launch repeats every 12s.' },
    { id: 'mc3',      name: 'Mission Control III',sci: 2000, requires: ['mc2'],
      desc: 'Auto-launch repeats every 5s.' },
    { id: 'mc4',      name: 'Mission Control IV', sci: 9000, requires: ['mc3'],
      desc: 'Auto-launch repeats every 2s.' },
    { id: 'station',  name: 'Space station',     sci: 2500,  requiresOrbit: true,
      desc: 'A lab in orbit: +2 science/s.' },
    { id: 'dsn',      name: 'Deep Space Network',sci: 1500,  requiresOrbit: true,
      desc: 'Missions run 2× faster.' },
    { id: 'slingshot',name: 'Gravity assists',   sci: 2000,  requiresMission: 'jupiterFlyby',
      desc: 'Steal momentum from Jupiter. Outer-system missions cost 30% less Δv.' },
    // Phase 3
    { id: 'orion',    name: 'Project Orion',     sci: 20000,  requiresMission: 'voyager',
      desc: 'Nuclear pulse propulsion. Fastest thing we’ve ever seriously designed.' },
    { id: 'sailTech', name: 'Solar sails',       sci: 35000,  requiresMission: 'voyager',
      desc: 'Photon pressure. No fuel. Flyby only — you can’t brake with sunlight behind you.' },
    { id: 'magsail',  name: 'Magnetic sail brake', sci: 120000, requires: ['sailTech'],
      desc: 'Drag against the interstellar medium: sails can now stop and colonize.' },
    { id: 'laser',    name: 'Launch laser array', sci: 300000, requires: ['sailTech'],
      desc: 'Push sails with a ground laser: cruise 0.02c → 0.12c.' },
    { id: 'fusionEng',name: 'Fusion torch',      sci: 150000, requires: ['orion'],
      desc: ' Continuous 0.027c exhaust.' },
    { id: 'antimatterEng', name: 'Antimatter drive', sci: 1500000, requires: ['fusionEng'],
      desc: 've ≈ c/3. Intergalactic candidate.' }
  ];

  // ---- Missions (phase 2): dv budget needed beyond LEO, m/s -----------------
  // cost = what the launch + probe run you (repeats pay 20% of both cost and
  // reward). The requires chains roughly follow how it actually went: lunar
  // probes first, then the inner planets, then outward.
  var MISSIONS = [
    { id: 'moonFlyby',   name: 'Moon flyby',      dv: 3150,  cost: 6.0e4, funds: 2.0e5, sci: 200,  time: 18,
      note: 'Free return trajectory, like Apollo 13.' },
    { id: 'moonOrbit',   name: 'Moon orbit',      dv: 3900,  cost: 1.0e5, funds: 3.5e5, sci: 300,  time: 22, requires: 'moonFlyby' },
    { id: 'moonLanding', name: 'Moon landing',    dv: 5900,  cost: 2.5e5, funds: 9.0e5, sci: 600,  time: 28, requires: 'moonOrbit',
      descent: { g: 1.62, body: 'the Moon' },
      note: 'No atmosphere, no parachutes: every m/s of descent is paid in Δv.' },
    { id: 'venusFlyby',  name: 'Venus flyby',     dv: 3500,  cost: 9.0e4, funds: 3.0e5, sci: 250,  time: 26, requires: 'moonFlyby' },
    { id: 'marsFlyby',   name: 'Mars flyby',      dv: 3900,  cost: 1.2e5, funds: 4.0e5, sci: 350,  time: 30, requires: 'moonFlyby' },
    { id: 'marsOrbit',   name: 'Mars orbit',      dv: 5700,  cost: 2.0e5, funds: 7.0e5, sci: 500,  time: 34, requires: 'marsFlyby' },
    { id: 'marsLanding', name: 'Mars landing',    dv: 7600,  cost: 5.0e5, funds: 1.8e6, sci: 900,  time: 40, requires: 'marsOrbit',
      descent: { g: 3.71, body: 'Mars' },
      note: 'Thin-atmosphere aerobraking discount included.' },
    { id: 'mercuryOrbit',name: 'Mercury orbit',   dv: 9500,  cost: 7.0e5, funds: 2.4e6, sci: 800,  time: 40, requires: 'venusFlyby',
      note: 'Falling toward the Sun is easy. Stopping is not.' },
    { id: 'ceres',       name: 'Ceres (asteroid belt)', dv: 9800, cost: 9.0e5, funds: 3.0e6, sci: 1000, time: 45, requires: 'marsOrbit' },
    { id: 'jupiterFlyby',name: 'Jupiter flyby',   dv: 6300,  cost: 1.0e6, funds: 3.6e6, sci: 1500, time: 50, requires: 'marsFlyby',
      note: 'Unlocks gravity-assist research: use Jupiter as a catapult.' },
    { id: 'europaOrbit', name: 'Europa orbit',    dv: 14000, assistDv: 9800, cost: 2.0e6, funds: 7.0e6, sci: 2500, time: 60, requires: 'jupiterFlyby' },
    { id: 'saturnFlyby', name: 'Saturn flyby',    dv: 7300,  assistDv: 5100, cost: 1.7e6, funds: 6.0e6, sci: 2000, time: 60, requires: 'jupiterFlyby' },
    { id: 'titanLanding',name: 'Titan landing',   dv: 12500, assistDv: 8750, cost: 3.5e6, funds: 1.2e7, sci: 4000, time: 70, requires: 'saturnFlyby',
      descent: { g: 1.35, body: 'Titan' },
      note: 'Thick atmosphere: parachutes work here. Huygens did this in 2005.' },
    { id: 'uranusFlyby', name: 'Uranus flyby',    dv: 8000,  assistDv: 5600, cost: 2.5e6, funds: 9.0e6, sci: 3000, time: 75, requires: 'saturnFlyby' },
    { id: 'neptuneFlyby',name: 'Neptune flyby',   dv: 8700,  assistDv: 6100, cost: 3.0e6, funds: 1.1e7, sci: 3500, time: 80, requires: 'uranusFlyby' },
    { id: 'plutoFlyby',  name: 'Pluto flyby',     dv: 9500,  assistDv: 6650, cost: 4.0e6, funds: 1.4e7, sci: 4500, time: 85, requires: 'neptuneFlyby' },
    { id: 'voyager',     name: 'Solar escape (Voyager moment)', dv: 8800, assistDv: 6160, cost: 6.0e6, funds: 2.5e7, sci: 9000, time: 90, requires: 'jupiterFlyby',
      note: 'Leave the Sun behind. The stars are next.' }
  ];

  // ---- Stars (phase 3) ------------------------------------------------------
  var STARS = [
    { id: 'alphacen', name: 'Alpha Centauri',  ly: 4.37,   funds: 1e9,   sci: 5e5,
      note: 'Closest star system. Has planets!' },
    { id: 'barnard',  name: "Barnard's Star",  ly: 5.96,   funds: 2e9,   sci: 1e6 },
    { id: 'sirius',   name: 'Sirius',          ly: 8.61,   funds: 5e9,   sci: 2e6,
      note: 'Brightest star in the sky, plus a white dwarf.' },
    { id: 'tauceti',  name: 'Tau Ceti',        ly: 11.9,   funds: 1e10,  sci: 5e6 },
    { id: 'trappist', name: 'TRAPPIST-1',      ly: 40.7,   funds: 5e10,  sci: 2e7,
      note: 'Seven rocky planets around one tiny red star.' },
    { id: 'kepler',   name: 'Kepler-452',      ly: 1800,   funds: 5e11,  sci: 2e8 },
    { id: 'core',     name: 'Galactic core',   ly: 26000,  funds: 1e13,  sci: 5e9,
      note: 'Sagittarius A*. Do not get close.' },
    { id: 'andromeda',name: 'ANDROMEDA',       ly: 2.5e6,  funds: 1e16,  sci: 1e12, intergalactic: true,
      note: 'A different galaxy. The final phase.' }
  ];

  // ---- Economy --------------------------------------------------------------

  // Altitude value saturates (log) past ~200 km — going straight up forever
  // is not a business plan. Orbit is where the money is.
  function effectiveAlt(maxAlt) {
    var altKm = maxAlt / 1000;
    return altKm <= 200 ? altKm : 200 + 90 * Math.log(altKm / 200);
  }

  function launchPayout(maxAlt, maxSpeed, gotOrbit, telemetryMult) {
    var f = 30 * Math.pow(effectiveAlt(maxAlt), 1.05) + 1.2 * Math.pow(maxSpeed / 100, 2);
    if (gotOrbit) f *= 6;
    return f * (telemetryMult || 1);
  }

  function launchScience(maxAlt) {
    // Every flight above 5 km returns a trickle of data — with the same
    // soft cap as funds, so lobbing a NERVA to 30,000 km isn't a science farm.
    if (maxAlt < 5000) return 0;
    return 1.2 * Math.pow(effectiveAlt(maxAlt), 0.72);
  }

  // Outsourced studies: turn mid-game money into science, so funds never go
  // fully irrelevant while research is the bottleneck.
  var OUTSOURCE = { baseCost: 2500, costGrowth: 1.4, baseSci: 30, sciGrowth: 1.18 };
  function outsourceCost(n) { return Math.round(OUTSOURCE.baseCost * Math.pow(OUTSOURCE.costGrowth, n)); }
  function outsourceSci(n) { return Math.round(OUTSOURCE.baseSci * Math.pow(OUTSOURCE.sciGrowth, n)); }

  function structureCost(spec, owned) {
    // owned = how many increments already bought
    return Math.round(spec.base * Math.pow(spec.growth, owned));
  }

  // ---- Number formatting ----------------------------------------------------
  var SUFFIX = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + fmt(-n);
    if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n));
    var tier = Math.floor(Math.log10(n) / 3);
    var scaled = n / Math.pow(10, tier * 3);
    if (scaled >= 999.5) { tier++; scaled = n / Math.pow(10, tier * 3); } // 999,600 is "1.00M", not "1000k"
    if (tier >= SUFFIX.length) return n.toExponential(2).replace('+', '');
    return (scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)) + SUFFIX[tier];
  }
  function fmtDist(m) {
    if (m < 1000) return m.toFixed(0) + ' m';
    if (m < 1e6) return (m / 1000).toFixed(1) + ' km';
    return fmt(m / 1000) + ' km';
  }
  function fmtSpeed(v) {
    if (v < 2000) return v.toFixed(0) + ' m/s';
    return (v / 1000).toFixed(2) + ' km/s';
  }
  function fmtTime(s) {
    if (s < 90) return s.toFixed(0) + 's';
    if (s < 5400) return (s / 60).toFixed(1) + 'min';
    if (s < 172800) return (s / 3600).toFixed(1) + 'h';
    return (s / 86400).toFixed(1) + 'd';
  }
  function fmtYears(y) {
    if (y < 1000) return y.toFixed(1) + ' years';
    return fmt(y) + ' years';
  }

  var D = {
    ENGINES: ENGINES, STAR_ENGINES: STAR_ENGINES,
    TANK: TANK, PAYLOAD_MASS: PAYLOAD_MASS, BASE_CDA: BASE_CDA,
    STRUCTURE: STRUCTURE,
    ALT_MILESTONES: ALT_MILESTONES, SPEED_MILESTONES: SPEED_MILESTONES,
    RESEARCH: RESEARCH, MISSIONS: MISSIONS, STARS: STARS,
    launchPayout: launchPayout, launchScience: launchScience, structureCost: structureCost,
    outsourceCost: outsourceCost, outsourceSci: outsourceSci,
    fmt: fmt, fmtDist: fmtDist, fmtSpeed: fmtSpeed, fmtTime: fmtTime, fmtYears: fmtYears,
    LEO_DV: 9400 // display: rough dv-to-orbit including losses
  };

  root.ASP = root.ASP || {};
  root.ASP.data = D;
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
