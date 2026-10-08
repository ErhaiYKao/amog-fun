/* Amog Space Program — game data & economy.
 * All dv numbers are real-ish (LEO-departure budgets, m/s). Shared with the
 * node test suite and the headless balance bot (tools/amog-space-program/).
 *
 * Balance lives here. game.js reads everything from these tables:
 *   ENGINES    ve m/s, thrust N, mass kg; unit = $ per engine per launch,
 *              tank = $ per tank of this engine's propellant per launch.
 *              upper: vacuum engine, stages 2+ only. planner: never burns
 *              during ascent, adds orbital dv for ionOk missions only.
 *              vac: ve multiplier on stages 2+ once Vacuum nozzles is researched.
 *              dryMult: tank dry mass multiplier (liquid hydrogen is fluffy).
 *              upgrade: { research, ve } a later research raises ve.
 *              research: the research id that unlocks it (cost is folded in there).
 *   RESEARCH   cost { funds, sci }; gates: requiresAlt (m), requiresOrbit,
 *              requiresMission (id), requires [research ids].
 *   MISSIONS   dv beyond LEO, payload kg the vehicle must carry, time s (real
 *              seconds of transit), funds/sci reward, cost = mission ops $,
 *              window: launch window period in seconds (open for WINDOW.open
 *              of each period), ionOk: ion tugs may help, descent: manual
 *              landing minigame, assistDv: dv with gravity assists, aeroDv: dv
 *              with aerobraking.
 */
(function (root) {
  'use strict';

  // ---- Engines --------------------------------------------------------------
  var ENGINES = {
    fizz:      { id: 'fizz',      name: 'Fizz-1',          ve: 400,   thrust: 7.0e3, mass: 30,   unit: 0,     tank: 0,
                 blurb: 'A soda bottle, a bike pump, and optimism. Free to fly (water is free).' },
    sundancer: { id: 'sundancer', name: 'Sundancer',       ve: 1400,  thrust: 1.4e4, mass: 80,   unit: 12,    tank: 4,   research: 'engSundancer',
                 blurb: 'Hobby-store solid motor, scaled up irresponsibly.' },
    kestrel:   { id: 'kestrel',   name: 'Kestrel',         ve: 2500,  thrust: 2.6e4, mass: 180,  unit: 90,    tank: 10,  research: 'engKestrel', vac: 1.12,
                 blurb: 'A real kerolox engine. Small, honest, flammable.' },
    merlin:    { id: 'merlin',    name: 'Merlin-ish',      ve: 3000,  thrust: 1.2e5, mass: 450,  unit: 500,   tank: 12,  research: 'engMerlin', vac: 1.12,
                 blurb: 'Now we are actually doing this.' },
    raptor:    { id: 'raptor',    name: 'Raptor-class',    ve: 3550,  thrust: 4.5e5, mass: 950,  unit: 2500,  tank: 15,  research: 'engRaptor', vac: 1.10,
                 blurb: 'Full-flow staged combustion. Amog approves.' },
    hydra:     { id: 'hydra',     name: 'Hydra (hydrolox)', ve: 4300, thrust: 7.0e4, mass: 320,  unit: 6000,  tank: 40,  research: 'engHydra', upper: true, dryMult: 1.6,
                 blurb: 'Liquid hydrogen + oxygen, vacuum nozzle. Upper stages only — at sea level the bell would just flap.' },
    nerva:     { id: 'nerva',     name: 'NERVA (nuclear)', ve: 8200,  thrust: 7.0e4, mass: 1800, unit: 40000, tank: 60,  research: 'engNerva', upper: true, dryMult: 1.8,
                 upgrade: { research: 'nerva2', ve: 9200 },
                 blurb: 'A nuclear reactor with a hole in one end. ve = 8.2 km/s, but it weighs 1.8 t and its hydrogen tanks are fat.' },
    ion:       { id: 'ion',       name: 'Ion drive',       ve: 30000, thrust: 100,   mass: 60,   unit: 15000, tank: 300, research: 'engIon', planner: true, dryMult: 1.5,
                 blurb: 'Shoots xenon at 30 km/s with the thrust of a sheet of paper. Can’t lift off and can’t land: only helps ion-friendly missions (orbits, asteroids), and slowly.' }
  };

  // Starship drives (phase 3). ve in m/s; sail is special-cased.
  var STAR_ENGINES = {
    sail:       { id: 'sail',       name: 'Solar sail',          ve: 0, sail: true, base: 2e7,
                  blurb: 'No propellant at all — photon pressure from sunlight. Cheap, but it cannot slow down.' },
    orion:      { id: 'orion',      name: 'Orion nuclear pulse', ve: 1.0e6, base: 6e7,
                  blurb: 'A series of nuclear explosions behind the ship. Genuinely a real 1958 design.' },
    fusion:     { id: 'fusion',     name: 'Fusion torch',        ve: 8.0e6, base: 4e9,
                  blurb: 'Continuous fusion exhaust at ~2.7% of lightspeed.' },
    antimatter: { id: 'antimatter', name: 'Antimatter core',     ve: 1.0e8, base: 3e12,
                  blurb: 've ≈ c/3. The rocket equation goes relativistic: Δv = c·tanh(ve/c · ln(m₀/m₁)).' }
  };

  // ---- Tanks / structure ----------------------------------------------------
  var TANK = { fuel: 250, dryFrac: 0.10 };    // kg fuel per tank; dry = frac*fuel
  var PAYLOAD_MASS = 100;                      // kg sounding probe on free flights
  var BASE_CDA = 0.9;                          // m^2 * Cd, before aero research

  // Funds upgrades, geometric costs. tanks/engines are per stage.
  var STRUCTURE = {
    tanks:   { name: 'Tank factory',   desc: '+1 max tanks per stage',   base: 20,  growth: 1.5,  knee: 10, growth2: 1.13, start: 2, max: 30 },
    engines: { name: 'Engine cluster', desc: '+1 max engines per stage', base: 300, growth: 2.4,  start: 1, max: 9 },
    constellation: { name: 'Constellation slots', desc: '+2 max satellites', base: 4e4, growth: 1.9, start: 4, max: 40, step: 2 }
  };
  // Heavy-lift research raises the tank cap: 30 -> 45 -> 60 -> 80
  var HEAVY_TANKS = { heavy1: 45, heavy2: 60, heavy3: 80 };

  // ---- Sim speed ------------------------------------------------------------
  // Flight warp choices. Up to 16x from the start; research buys the rest.
  var WARPS = [
    { x: 1 }, { x: 2 }, { x: 4 }, { x: 8 }, { x: 16 },
    { x: 32, research: 'warp1' }, { x: 64, research: 'warp1' },
    { x: 128, research: 'warp2' }, { x: 256, research: 'warp2' },
    { x: 512, research: 'warp3' }, { x: 1024, research: 'warp3' }
  ];

  // ---- Milestones -----------------------------------------------------------
  // Small, frequent rewards early (so the first minutes feel good), and the
  // big ones are spread out so no single flight hands you the next tier.
  var ALT_MILESTONES = [
    { alt: 100,    funds: 10,    sci: 0,   name: 'Liftoff!',                         note: 'It left the ground on purpose.' },
    { alt: 300,    funds: 20,    sci: 0,   name: 'Cleared the treeline',             note: 'It flew. Technically.' },
    { alt: 600,    funds: 30,    sci: 0,   name: '600 m — the Eiffel Tower, twice',  note: 'Paris has been notified.' },
    { alt: 1e3,    funds: 50,    sci: 0,   name: '1 km up',                          note: 'Higher than Amog’s apartment.' },
    { alt: 2e3,    funds: 80,    sci: 0,   name: '2 km — cloud base',                note: 'It went into a cloud and came back out. Wet.' },
    { alt: 3e3,    funds: 120,   sci: 0,   name: '3 km — small aircraft territory',  note: 'Please file a flight plan.' },
    { alt: 5e3,    funds: 200,   sci: 10,  name: '5 km — first real data',           note: 'Science unlocked! Flights above 5 km bring back ⚗ science.' },
    { alt: 10e3,   funds: 400,   sci: 20,  name: '10 km — airliner altitude',        note: 'Wave at the passengers.' },
    { alt: 20e3,   funds: 800,   sci: 35,  name: '20 km — stratosphere',             note: 'The sky is getting dark.' },
    { alt: 35e3,   funds: 1500,  sci: 55,  name: '35 km — weather balloons quit here', note: 'Air is 1% of sea level. Drag barely matters now.' },
    { alt: 50e3,   funds: 2000,  sci: 80,  name: '50 km — mesosphere',               note: 'Halfway to space by altitude. Nowhere near by Δv.' },
    { alt: 75e3,   funds: 3000,  sci: 110, name: '75 km — meteors burn up here',     note: 'You are now the meteor. Try not to burn up.' },
    { alt: 100e3,  funds: 5000,  sci: 200, name: '100 km — THE KÁRMÁN LINE',         note: 'You are officially in space. Amog is losing it. Guidance research available.' },
    { alt: 200e3,  funds: 8000,  sci: 250, name: '200 km — definitely space',        note: 'Going up is solved. Now try going sideways fast enough to miss the ground.' },
    { alt: 1000e3, funds: 12000, sci: 300, name: '1000 km — lofted',                 note: 'Very high, very not-in-orbit. Orbit is about sideways speed.' }
  ];
  var SPEED_MILESTONES = [
    { speed: 343,  funds: 100,    sci: 0,   name: 'Mach 1',            note: 'The rocket is now louder behind itself.' },
    { speed: 1000, funds: 600,    sci: 20,  name: '1 km/s',            note: 'Faster than a rifle round.' },
    { speed: 2000, funds: 1500,   sci: 40,  name: '2 km/s',            note: 'Sideways is where the speed is.' },
    { speed: 3000, funds: 3000,   sci: 70,  name: '3 km/s',            note: 'A third of the way to orbital velocity.' },
    { speed: 5000, funds: 6000,   sci: 120, name: '5 km/s',            note: 'Hypersonic doesn’t cover it any more.' },
    { speed: 7800, funds: 15000,  sci: 200, name: 'Orbital velocity',  note: '7.8 km/s sideways. The magic number.' }
  ];
  var ORBIT_MILESTONE = { name: 'STABLE ORBIT', funds: 60000, sci: 600,
    note: 'Periapsis above the atmosphere. You are missing the ground forever. Welcome to Phase 2: missions and contracts.' };
  var ESCAPE_MILESTONE = { name: 'EARTH ESCAPE', funds: 40000, sci: 300,
    note: 'Past escape velocity — this rocket now orbits the Sun.' };

  // ---- Research tree --------------------------------------------------------
  // cost.funds is folded in: researching an engine is all it takes to fly it.
  var RESEARCH = [
    // Phase 1: going up
    { id: 'engSundancer', name: 'Sundancer solid motor', cost: { funds: 150 }, requiresAlt: 300,
      desc: 'A real(ish) rocket motor: ve 1.4 km/s. 3.5× the soda bottle.' },
    { id: 'aero1',    name: 'Aerodynamics I',    cost: { funds: 400 },  requiresAlt: 1e3,
      desc: 'Nose cone + fins. Drag ×0.72.' },
    { id: 'telem1',   name: 'Telemetry I',       cost: { funds: 700 },  requiresAlt: 2e3,
      desc: 'Sell the flight data. Launch payouts ×1.5.' },
    { id: 'crew1',    name: 'Ground crew',       cost: { funds: 1000 }, requiresAlt: 3e3,
      desc: 'Interns re-fly your last free flight back to back (12 s pad turnaround), paying for the hardware each time. No more clicking LAUNCH to grind — fly by hand to try new designs.' },
    { id: 'engKestrel', name: 'Kestrel engine',  cost: { funds: 2500, sci: 20 }, requiresAlt: 5e3,
      desc: 'A real liquid-fuel engine: ve 2.5 km/s.' },
    { id: 'mat1',     name: 'Materials I',       cost: { funds: 2000, sci: 25 }, requiresAlt: 5e3,
      desc: 'Lighter tanks: dry mass 10% → 8.5% of fuel.' },
    { id: 'stage2',   name: 'Staging',           cost: { funds: 7500, sci: 90 }, requiresAlt: 10e3,
      desc: 'Drop empty tanks mid-flight. Each stage gets its own Δv = ve·ln(m₀/m₁). Unlocks “+ add stage”.' },
    { id: 'warp1',    name: 'Flight computer I', cost: { funds: 6000, sci: 75 }, requiresAlt: 10e3,
      desc: 'Sim speed 32× and 64× (the ground crew flies faster too).' },
    { id: 'aero2',    name: 'Aerodynamics II',   cost: { funds: 12000, sci: 150 }, requires: ['aero1'], requiresAlt: 20e3,
      desc: 'Actual wind-tunnel time. Drag ×0.55 total.' },
    { id: 'crew2',    name: 'Ground crew II',    cost: { funds: 15000, sci: 180 }, requires: ['crew1'], requiresAlt: 20e3,
      desc: 'Pad turnaround 12 s → 6 s.' },
    { id: 'engMerlin', name: 'Merlin-ish engine', cost: { funds: 22500, sci: 300 }, requires: ['engKestrel'], requiresAlt: 20e3,
      desc: 'Serious thrust (120 kN), ve 3.0 km/s.' },
    { id: 'mat2',     name: 'Materials II',      cost: { funds: 40000, sci: 300 }, requires: ['mat1'], requiresAlt: 35e3,
      desc: 'Tank dry mass → 7%.' },
    { id: 'telem2',   name: 'Telemetry II',      cost: { funds: 60000, sci: 350 }, requires: ['telem1'], requiresAlt: 50e3,
      desc: 'Launch payouts ×2.25 total.' },
    { id: 'stage3',   name: 'Triple staging',    cost: { funds: 80000, sci: 450 }, requires: ['stage2'], requiresAlt: 50e3,
      desc: 'A third stage slot. Now you’re thinking with logarithms.' },
    { id: 'guidance', name: 'Guidance computer', cost: { funds: 150000, sci: 700 }, requiresAlt: 100e3,
      desc: 'Gravity turn + closed-loop orbital insertion. Orbit is 90% sideways — unlocks the pitch-over sliders.' },
    { id: 'warp2',    name: 'Flight computer II', cost: { funds: 80000, sci: 400 }, requires: ['warp1'], requiresAlt: 100e3,
      desc: 'Sim speed 128× and 256×.' },
    { id: 'engRaptor', name: 'Raptor-class',     cost: { funds: 250000, sci: 900 }, requires: ['engMerlin'], requiresAlt: 100e3,
      desc: 've 3.55 km/s and an outrageous 450 kN.' },
    { id: 'vacNozzles', name: 'Vacuum nozzles',  cost: { funds: 180000, sci: 700 }, requires: ['stage2'], requiresAlt: 100e3,
      desc: 'Big bells only work where there’s no air pushing back: kerolox/methalox engines on stages 2+ get +10–12% ve.' },
    { id: 'aero3',    name: 'Aerodynamics III',  cost: { funds: 180000, sci: 800 }, requires: ['aero2'], requiresAlt: 100e3,
      desc: 'Grid fins & a very pointy hat. Drag ×0.4 total.' },
    { id: 'mat3',     name: 'Materials III',     cost: { funds: 250000, sci: 900 }, requires: ['mat2'], requiresAlt: 100e3,
      desc: 'Tank dry mass → 5.5%.' },

    // Phase 2: orbit and the planets. Each tech tier opens one to three
    // missions (see the capability table in tools/amog-space-program).
    { id: 'crew3',    name: 'Ground crew III',   cost: { funds: 1.2e5, sci: 600 }, requires: ['crew2'], requiresOrbit: true,
      desc: 'Pad turnaround → 3 s.' },
    { id: 'reuse',    name: 'Booster recovery',  cost: { funds: 1.5e5, sci: 800 }, requiresOrbit: true,
      desc: 'Stage 1 lands on a barge: 75% of its hardware cost comes back every launch. Big cheap first stages are now a strategy.' },
    { id: 'station',  name: 'Space station',     cost: { funds: 2.5e5, sci: 1000 }, requiresOrbit: true,
      desc: 'A lab in orbit: +3 science/s.' },
    { id: 'dispatch', name: 'Mission Control',   cost: { funds: 2.0e5, sci: 1000 }, requiresMission: 'weather',
      desc: 'Auto-dispatch: tick “auto” on a mission and it re-launches with your cheapest proven vehicle whenever a slot is free and its window is open.' },
    { id: 'engHydra', name: 'Hydrolox upper stage', cost: { funds: 3.0e5, sci: 1500 }, requiresMission: 'meo',
      desc: 'Hydra: ve 4.3 km/s vacuum engine (stages 2+ only). Hydrogen tanks weigh 1.6× more.' },
    { id: 'warp3',    name: 'Flight computer III', cost: { funds: 3.0e5, sci: 1500 }, requires: ['warp2'], requiresMission: 'meo',
      desc: 'Sim speed 512× and 1024×.' },
    { id: 'stage4',   name: 'Quadruple staging', cost: { funds: 6.0e5, sci: 2500 }, requires: ['stage3'], requiresMission: 'moonFlyby',
      desc: 'A fourth stage. The rocket equation’s favorite cheat code.' },
    { id: 'dsn1',     name: 'Deep Space Network I',  cost: { funds: 5.0e5, sci: 2500 }, requiresMission: 'moonFlyby',
      desc: '+1 concurrent mission (2 total).' },
    { id: 'heavy1',   name: 'Heavy-lift pad I',  cost: { funds: 1.0e6, sci: 4000 }, requiresMission: 'moonOrbit',
      desc: 'Tank factory cap 30 → 45 tanks per stage.' },
    { id: 'crew4',    name: 'Ground crew IV',    cost: { funds: 1.0e6, sci: 4000 }, requires: ['crew3'], requiresMission: 'moonOrbit',
      desc: 'Pad turnaround → 1.5 s.' },
    { id: 'aerobrake', name: 'Aerobraking',      cost: { funds: 1.5e6, sci: 6000 }, requiresMission: 'marsFlyby',
      desc: 'Use a planet’s atmosphere as a free brake: Venus, Mars and Titan missions need less Δv.' },
    { id: 'engIon',   name: 'Ion propulsion',    cost: { funds: 2.5e6, sci: 9000 }, requiresMission: 'marsOrbit',
      desc: 'Ion drive (mission Δv only, ion-friendly missions only — like SMART-1 and Dawn). Ion legs add 50% to the trip time.' },
    { id: 'dsn2',     name: 'Deep Space Network II', cost: { funds: 2.5e6, sci: 9000 }, requires: ['dsn1'], requiresMission: 'marsOrbit',
      desc: '+1 concurrent mission (3 total).' },
    { id: 'heavy2',   name: 'Heavy-lift pad II', cost: { funds: 4.0e6, sci: 12000 }, requires: ['heavy1'], requiresMission: 'venusLander',
      desc: 'Tank factory cap 45 → 60 tanks per stage.' },
    { id: 'mat4',     name: 'Materials IV',      cost: { funds: 5.0e6, sci: 15000 }, requires: ['mat3'], requiresMission: 'moonLanding',
      desc: 'Carbon-composite tanks: dry mass → 4.5%.' },
    { id: 'engNerva', name: 'Nuclear thermal',   cost: { funds: 8.0e6, sci: 20000 }, requiresMission: 'moonLanding',
      desc: 'NERVA: ve 8.2 km/s upper stage. Heavy, low thrust, fat tanks — a specialist, not a cheat code.' },
    { id: 'slingshot',name: 'Gravity assists',   cost: { funds: 1.2e7, sci: 30000 }, requiresMission: 'jupiterFlyby',
      desc: 'Steal momentum from Jupiter: outer-system missions can fly a cheaper-Δv, 60% longer assist trajectory.' },
    { id: 'dsn3',     name: 'Deep Space Network III', cost: { funds: 1.5e7, sci: 40000 }, requires: ['dsn2'], requiresMission: 'jupiterFlyby',
      desc: '+1 concurrent mission (4 total).' },
    { id: 'heavy3',   name: 'Heavy-lift pad III', cost: { funds: 2.5e7, sci: 60000 }, requires: ['heavy2'], requiresMission: 'saturnFlyby',
      desc: 'Tank factory cap 60 → 80 tanks per stage. Super heavy.' },
    { id: 'nerva2',   name: 'Bimodal NERVA',     cost: { funds: 6.0e7, sci: 1.2e5 }, requires: ['engNerva'], requiresMission: 'neptuneFlyby',
      desc: 'Hotter core, better hydrogen: NERVA ve 8.2 → 9.2 km/s. The last word before the stars.' },

    // Phase 3: the stars
    { id: 'sailTech', name: 'Solar sails',       cost: { funds: 3e7, sci: 4e4 }, requiresMission: 'voyager',
      desc: 'Photon pressure. No fuel. Flyby only — you can’t brake with sunlight behind you.' },
    { id: 'orion',    name: 'Project Orion',     cost: { funds: 1e8, sci: 8e4 }, requiresMission: 'voyager',
      desc: 'Nuclear pulse propulsion. Fastest thing we’ve ever seriously designed.' },
    { id: 'yard2',    name: 'Orbital shipyard II', cost: { funds: 2e8, sci: 1.5e5 }, requiresMission: 'voyager', requiresStar: 'heliopause',
      desc: '+1 starship in flight at once (2 total).' },
    { id: 'magsail',  name: 'Magnetic sail brake', cost: { funds: 5e8, sci: 3e5 }, requires: ['sailTech'], requiresStar: 'focal',
      desc: 'Drag against the interstellar medium: sails can now stop and colonize.' },
    { id: 'laser',    name: 'Launch laser array', cost: { funds: 3e9, sci: 1e6 }, requires: ['sailTech'], requiresStar: 'alphacen',
      desc: 'Push sails with a ground laser: cruise 0.02c → 0.12c.' },
    { id: 'fusionEng',name: 'Fusion torch',      cost: { funds: 5e9, sci: 1.5e6 }, requires: ['orion'], requiresStar: 'alphacen',
      desc: 'Continuous 0.027c exhaust.' },
    { id: 'yard3',    name: 'Orbital shipyard III', cost: { funds: 2e10, sci: 5e6 }, requires: ['yard2'], requiresStar: 'barnard',
      desc: '+1 starship in flight at once (3 total).' },
    { id: 'antimatterEng', name: 'Antimatter drive', cost: { funds: 1e12, sci: 1e8 }, requires: ['fusionEng'], requiresStar: 'tauceti',
      desc: 've ≈ c/3. Intergalactic candidate.' },
    { id: 'yard4',    name: 'Orbital shipyard IV', cost: { funds: 1e13, sci: 1e9 }, requires: ['yard3'], requiresStar: 'trappist',
      desc: '+1 starship in flight at once (4 total).' }
  ];

  // ---- Missions -------------------------------------------------------------
  // Launch windows: planets line up once per (sped-up) synodic period.
  // Off-window launches are possible but need WINDOW.offPenalty × the Δv.
  var WINDOW = { open: 0.25, offPenalty: 1.3 };
  var MISSIONS = [
    { id: 'weather',     name: 'Weather satellite', dv: 150,  payload: 300, cost: 3e3,  funds: 6.0e4, sci: 400,  time: 30,
      note: 'Heavy payload, polar orbit. The first job that pays for itself.' },
    { id: 'meo',         name: 'Navigation satellite (MEO)', dv: 1200, payload: 100, cost: 6e3, funds: 1.2e5, sci: 700, time: 45, requires: 'weather',
      note: 'Medium Earth orbit, 20,000 km up, where GPS lives.' },
    { id: 'moonFlyby',   name: 'Moon flyby',      dv: 3150,  payload: 75,  cost: 1.5e4, funds: 4.0e5, sci: 2000, time: 60, requires: 'meo',
      note: 'Free-return trajectory, like Apollo 13. Luna 1 did it in 1959.' },
    { id: 'moonOrbit',   name: 'Moon orbit',      dv: 3950,  payload: 120, cost: 3e4,  funds: 8.0e5, sci: 3500, time: 75, requires: 'moonFlyby', ionOk: true,
      note: 'SMART-1 got here on an ion drive.' },
    { id: 'venusFlyby',  name: 'Venus flyby',     dv: 3500,  payload: 150, cost: 3e4,  funds: 7.0e5, sci: 3000, time: 120, requires: 'moonFlyby', window: 290 },
    { id: 'marsFlyby',   name: 'Mars flyby',      dv: 3700,  payload: 250, cost: 5e4,  funds: 1.2e6, sci: 5000, time: 150, requires: 'moonFlyby', window: 390 },
    { id: 'l2scope',     name: 'Deep-space telescope (L2)', dv: 3300, payload: 500, cost: 8e4, funds: 1.5e6, sci: 7000, time: 90, requires: 'moonOrbit',
      note: 'Heavy mirror, parked 1.5 million km out. Built for the heavy-lift pad.' },
    { id: 'venusLander', name: 'Venus lander',    dv: 4400,  aeroDv: 3600, payload: 400, cost: 1e5, funds: 2.5e6, sci: 9000, time: 150, requires: 'venusFlyby', window: 290,
      note: 'Venera-style: the atmosphere does the braking, then crushes the probe. 57 glorious minutes of data.' },
    { id: 'marsOrbit',   name: 'Mars orbit',      dv: 5700,  aeroDv: 4700, payload: 200, cost: 1.5e5, funds: 3.0e6, sci: 11000, time: 180, requires: 'marsFlyby', window: 390, ionOk: true },
    { id: 'mercuryOrbit',name: 'Mercury orbit',   dv: 9500,  payload: 150, cost: 3e5, funds: 6.0e6, sci: 18000, time: 220, requires: 'venusFlyby', window: 120, ionOk: true,
      note: 'Falling toward the Sun is easy. Stopping is not. BepiColombo used ion drives.' },
    { id: 'ceres',       name: 'Ceres (asteroid belt)', dv: 9800, payload: 200, cost: 3e5, funds: 6.5e6, sci: 20000, time: 280, requires: 'marsOrbit', window: 230, ionOk: true,
      note: 'Dawn did it on ion drives. Hint, hint.' },
    { id: 'moonLanding', name: 'Moon landing',    dv: 5900,  payload: 100, cost: 2e5,  funds: 5.0e6, sci: 16000, time: 90, requires: 'moonOrbit',
      descent: { g: 1.62, body: 'the Moon' },
      note: 'No atmosphere, no parachutes: every m/s of descent is paid in Δv.' },
    { id: 'jupiterFlyby',name: 'Jupiter flyby',   dv: 6300,  payload: 120, cost: 3e5, funds: 9.0e6, sci: 25000, time: 300, requires: 'marsFlyby', window: 200,
      note: 'Unlocks gravity-assist research: use Jupiter as a catapult.' },
    { id: 'marsLanding', name: 'Mars landing',    dv: 7600,  aeroDv: 6300, payload: 250, cost: 5e5, funds: 1.4e7, sci: 35000, time: 200, requires: 'marsOrbit', window: 390,
      descent: { g: 3.71, body: 'Mars' },
      note: 'Thin air: aerobraking helps, but the last kilometers are rockets all the way.' },
    { id: 'saturnFlyby', name: 'Saturn flyby',    dv: 7300,  assistDv: 6200, payload: 300, cost: 6e5, funds: 2.0e7, sci: 50000, time: 420, requires: 'jupiterFlyby', window: 190 },
    { id: 'uranusFlyby', name: 'Uranus flyby',    dv: 8000,  assistDv: 6800, payload: 300, cost: 8e5, funds: 2.8e7, sci: 65000, time: 540, requires: 'saturnFlyby', window: 185 },
    { id: 'neptuneFlyby',name: 'Neptune flyby',   dv: 8700,  assistDv: 7400, payload: 300, cost: 1e6, funds: 3.6e7, sci: 80000, time: 600, requires: 'uranusFlyby', window: 184 },
    { id: 'titanLanding',name: 'Titan landing',   dv: 12500, assistDv: 10600, aeroDv: 10500, payload: 300, cost: 1.5e6, funds: 5.0e7, sci: 1.1e5, time: 480, requires: 'saturnFlyby', window: 190,
      descent: { g: 1.35, body: 'Titan' },
      note: 'Thick atmosphere: parachutes work here. Huygens did this in 2005.' },
    { id: 'europaOrbit', name: 'Europa orbit',    dv: 14000, assistDv: 9800, payload: 200, cost: 1.5e6, funds: 5.5e7, sci: 1.2e5, time: 400, requires: 'jupiterFlyby', window: 200,
      note: 'Jupiter’s radiation belts, then a moon with an ocean under the ice.' },
    { id: 'plutoFlyby',  name: 'Pluto flyby',     dv: 9500,  assistDv: 8100, payload: 250, cost: 2e6, funds: 6.5e7, sci: 1.5e5, time: 660, requires: 'neptuneFlyby', window: 183 },
    { id: 'voyager',     name: 'Solar escape (Voyager moment)', dv: 8800, assistDv: 7500, payload: 400, cost: 3e6, funds: 1.0e8, sci: 2.0e5, time: 720, requires: 'saturnFlyby',
      note: 'Leave the Sun behind. The stars are next.' }
  ];
  // Repeat missions: the public stops caring, slowly. Funds decay to a floor
  // (a repeat is a real, rate-limited job); science decays to ~nothing.
  var REPEAT = { funds: 0.3, fundsDecay: 0.8, fundsFloor: 0.08, sci: 0.25, sciDecay: 0.5 };

  // ---- Contracts ------------------------------------------------------------
  // A small board of rotating, expiring jobs. Rate-limited by construction:
  // one new offer every `every` seconds, at most `board` on offer.
  var CONTRACTS = { board: 3, every: 75, expire: 600, unlockAlt: 600 };

  // ---- Stars (phase 3) ------------------------------------------------------
  // precursor: flyby-only targets inside the Sun's neighbourhood.
  var STARS = [
    { id: 'heliopause', name: 'Heliopause (120 AU)', ly: 0.0019, funds: 1.5e8, sci: 6e4, precursor: true,
      note: 'Where the solar wind gives up. Voyager 1 crossed it in 2012.' },
    { id: 'focal',    name: 'Solar gravitational lens (550 AU)', ly: 0.0087, funds: 4e8, sci: 1.5e5, precursor: true,
      note: 'Line up behind the Sun and it becomes a telescope lens the size of a star.' },
    { id: 'oort',     name: 'Inner Oort cloud', ly: 0.1, funds: 1e9, sci: 4e5, precursor: true,
      note: 'A trillion frozen comets, very far apart.' },
    { id: 'alphacen', name: 'Alpha Centauri',  ly: 4.37,   funds: 5e9,   sci: 1.5e6,
      note: 'Closest star system. Has planets!' },
    { id: 'barnard',  name: "Barnard's Star",  ly: 5.96,   funds: 1e10,  sci: 3e6 },
    { id: 'sirius',   name: 'Sirius',          ly: 8.61,   funds: 2.5e10, sci: 6e6,
      note: 'Brightest star in the sky, plus a white dwarf.' },
    { id: 'tauceti',  name: 'Tau Ceti',        ly: 11.9,   funds: 6e10,  sci: 1.5e7 },
    { id: 'trappist', name: 'TRAPPIST-1',      ly: 40.7,   funds: 3e11,  sci: 6e7,
      note: 'Seven rocky planets around one tiny red star.' },
    { id: 'kepler',   name: 'Kepler-452',      ly: 1800,   funds: 5e12,  sci: 1e9 },
    { id: 'core',     name: 'Galactic core',   ly: 26000,  funds: 1e14,  sci: 2e10,
      note: 'Sagittarius A*. Do not get close.' },
    { id: 'andromeda',name: 'ANDROMEDA',       ly: 2.5e6,  funds: 1e17,  sci: 1e13, intergalactic: true,
      note: 'A different galaxy. The final phase.' }
  ];
  // Flybys: first visit pays FLYBY.first of the star's value; each repeat
  // pays FLYBY.repeat × FLYBY.decay^k in science only. No funds for repeats:
  // nobody pays twice for the same photos.
  var FLYBY = { first: 0.35, repeat: 0.05, decay: 0.5 };
  var COLONY = { fundsRate: 2e6, sciRate: 2e3 };   // per colony per second, before the ×2^n multiplier

  // ---- Economy --------------------------------------------------------------

  // Altitude value saturates (log) past ~200 km — going straight up forever
  // is not a business plan. Orbit is where the money is.
  function effectiveAlt(maxAlt) {
    var altKm = Math.max(0, maxAlt) / 1000;
    return altKm <= 200 ? altKm : 200 + 90 * Math.log(altKm / 200);
  }

  function launchPayout(maxAlt, maxSpeed, gotOrbit, telemetryMult) {
    var f = 15 * Math.pow(effectiveAlt(maxAlt), 0.85) + 0.25 * Math.pow(maxSpeed / 100, 2);
    if (gotOrbit) f *= 2;
    return f * (telemetryMult || 1);
  }

  function launchScience(maxAlt) {
    // Every flight above 5 km returns a trickle of data, with the same
    // soft cap as funds, so lobbing a NERVA to 30,000 km isn't a science farm.
    if (maxAlt < 5000) return 0;
    return 0.15 * Math.pow(effectiveAlt(maxAlt), 0.72);
  }

  // Outsourced studies: turn money into science, so funds never go fully
  // irrelevant while research is the bottleneck. Escalating, so it's a valve,
  // not a converter.
  var OUTSOURCE = { baseCost: 2500, costGrowth: 1.45, baseSci: 25, sciGrowth: 1.2 };
  function outsourceCost(n) { return Math.round(OUTSOURCE.baseCost * Math.pow(OUTSOURCE.costGrowth, n)); }
  function outsourceSci(n) { return Math.round(OUTSOURCE.baseSci * Math.pow(OUTSOURCE.sciGrowth, n)); }

  function structureCost(spec, owned) {
    // owned = how many increments already bought. Past the knee the curve
    // flattens, so the heavy-lift caps (45/60/80 tanks) stay reachable.
    if (spec.knee !== undefined && owned > spec.knee) {
      return Math.round(spec.base * Math.pow(spec.growth, spec.knee) * Math.pow(spec.growth2, owned - spec.knee));
    }
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
    if (y < 1) return (y * 365.25).toFixed(0) + ' days';
    if (y < 1000) return y.toFixed(1) + ' years';
    return fmt(y) + ' years';
  }

  var D = {
    ENGINES: ENGINES, STAR_ENGINES: STAR_ENGINES,
    TANK: TANK, PAYLOAD_MASS: PAYLOAD_MASS, BASE_CDA: BASE_CDA,
    STRUCTURE: STRUCTURE, HEAVY_TANKS: HEAVY_TANKS, WARPS: WARPS,
    ALT_MILESTONES: ALT_MILESTONES, SPEED_MILESTONES: SPEED_MILESTONES,
    ORBIT_MILESTONE: ORBIT_MILESTONE, ESCAPE_MILESTONE: ESCAPE_MILESTONE,
    RESEARCH: RESEARCH, MISSIONS: MISSIONS, WINDOW: WINDOW, REPEAT: REPEAT,
    CONTRACTS: CONTRACTS, STARS: STARS, FLYBY: FLYBY, COLONY: COLONY,
    effectiveAlt: effectiveAlt,
    launchPayout: launchPayout, launchScience: launchScience, structureCost: structureCost,
    outsourceCost: outsourceCost, outsourceSci: outsourceSci,
    fmt: fmt, fmtDist: fmtDist, fmtSpeed: fmtSpeed, fmtTime: fmtTime, fmtYears: fmtYears,
    LEO_DV: 9400 // display: rough dv-to-orbit including losses
  };

  root.ASP = root.ASP || {};
  root.ASP.data = D;
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
