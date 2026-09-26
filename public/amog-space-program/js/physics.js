/* Amog Space Program — physics core.
 * Real formulas, 2D. Shared between the browser and the node balance harness.
 *
 *   gravity   g(r) = mu / r^2                       (inverse square)
 *   drag      F = 1/2 * rho * v^2 * Cd * A          (rho = rho0 * e^(-h/H))
 *   rocket eq dv = v_e * ln(m0 / m1)                (Tsiolkovsky)
 */
(function (root) {
  'use strict';

  var C = {
    G0: 9.80665,            // m/s^2, standard gravity (TWR reference)
    R_EARTH: 6.371e6,       // m
    MU_EARTH: 3.986004418e14, // m^3/s^2
    RHO0: 1.225,            // kg/m^3 sea level
    SCALE_H: 8500,          // m, atmospheric scale height
    ATMO_TOP: 140e3,        // m, above this drag = 0
    ORBIT_MIN: 140e3,       // m, periapsis above this = stable orbit
    FINE_DT_TOP: 220e3,     // m, keep the integrator fine through the orbit-decision band
    C_LIGHT: 299792458      // m/s
  };

  // ---- Rocket equation ------------------------------------------------------

  function tsiolkovsky(ve, m0, m1) {
    if (m1 <= 0 || m0 <= m1) return 0;
    return ve * Math.log(m0 / m1);
  }

  // Relativistic form, for the interstellar endgame (ve as fraction of c
  // matters): dv = c * tanh( (ve/c) * ln(m0/m1) )
  function tsiolkovskyRel(ve, m0, m1) {
    if (m1 <= 0 || m0 <= m1) return 0;
    var x = (ve / C.C_LIGHT) * Math.log(m0 / m1);
    return C.C_LIGHT * Math.tanh(x);
  }

  function airDensity(h) {
    if (h > C.ATMO_TOP) return 0;
    if (h < 0) h = 0;
    return C.RHO0 * Math.exp(-h / C.SCALE_H);
  }

  // ---- Stage/vehicle math ---------------------------------------------------
  // A "stage spec" (resolved from the builder + research):
  //   { engine: {ve, thrust, mass}, engineCount, tanks, tankFuel, tankDry, payloadAbove }
  // tanks: count; tankFuel/tankDry: per-tank masses (kg) after materials research.

  function stageMasses(stage) {
    var engines = stage.engine.mass * stage.engineCount;
    var fuel = stage.tanks * stage.tankFuel;
    var dry = engines + stage.tanks * stage.tankDry;
    return { fuel: fuel, dry: dry, wet: fuel + dry };
  }

  // Full-vehicle summary: per-stage dv (stages listed bottom-first), total dv,
  // liftoff TWR. `payload` rides on top of everything.
  function vehicleStats(stages, payload) {
    var i, ms = [], totalWet = payload;
    for (i = 0; i < stages.length; i++) ms.push(stageMasses(stages[i]));
    for (i = 0; i < stages.length; i++) totalWet += ms[i].wet;

    var above = totalWet, perStage = [], totalDv = 0;
    for (i = 0; i < stages.length; i++) {
      var m0 = above;                 // everything from this stage up
      var m1 = above - ms[i].fuel;    // after burning this stage's fuel
      var dv = tsiolkovsky(stages[i].engine.ve, m0, m1);
      var thrust = stages[i].engine.thrust * stages[i].engineCount;
      perStage.push({
        m0: m0, m1: m1, dv: dv,
        thrust: thrust,
        twr: thrust / (m0 * C.G0),
        burnTime: stages[i].engine.ve > 0 ? ms[i].fuel * stages[i].engine.ve / Math.max(thrust, 1e-9) : 0
      });
      above = m1 - ms[i].dry;         // jettison stage dry mass
      totalDv += dv;
    }
    return {
      perStage: perStage,
      totalDv: totalDv,
      liftoffMass: totalWet,
      liftoffTwr: perStage.length ? perStage[0].twr : 0
    };
  }

  // ---- Flight simulation ----------------------------------------------------
  // 2D Cartesian, Earth center at origin. Launch site at (0, R). East = +x.
  // Pitch program: angle from local vertical ramps 0 -> 90 deg between
  // turnStart and turnEnd altitudes (0/0 means "straight up forever").

  function Flight(cfg) {
    // cfg: { stages: [...], payload, cdA, turnStart, turnEnd }
    this.cfg = cfg;
    this.t = 0;
    this.x = 0; this.y = C.R_EARTH;
    this.vx = 0; this.vy = 0;
    this.stageIndex = 0;
    this.stageFuel = cfg.stages.length ? stageMasses(cfg.stages[0]).fuel : 0;
    this.mass = vehicleStats(cfg.stages, cfg.payload).liftoffMass;
    this.maxAlt = 0; this.maxSpeed = 0;
    this.dvSpent = 0;
    this.status = 'flying';   // flying | orbit | escape | crashed | landed
    this.events = [];         // {t, type, ...} staging, burnout, apoapsis...
    this.thrusting = false;
    this.wasRising = true;
    this.apoapsis = 0; this.periapsis = 0; this.ecc = 1;
    // Guidance autopilot: ascent -> coast (to apoapsis) -> circ (burn)
    this.guided = cfg.turnEnd > cfg.turnStart;
    this.apMode = 'ascent';
    this.targetAp = cfg.targetAp || 180e3;
  }

  Flight.prototype.alt = function () {
    return Math.sqrt(this.x * this.x + this.y * this.y) - C.R_EARTH;
  };
  Flight.prototype.speed = function () {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  };

  Flight.prototype._orbitElements = function () {
    var r = Math.sqrt(this.x * this.x + this.y * this.y);
    var v2 = this.vx * this.vx + this.vy * this.vy;
    var eps = v2 / 2 - C.MU_EARTH / r;            // specific orbital energy
    var hAng = this.x * this.vy - this.y * this.vx; // specific angular momentum (z)
    var a = -C.MU_EARTH / (2 * eps);              // semi-major axis (neg if hyperbolic)
    var e2 = 1 + 2 * eps * hAng * hAng / (C.MU_EARTH * C.MU_EARTH);
    var e = Math.sqrt(Math.max(0, e2));
    this.ecc = e;
    // rp = h^2/mu/(1+e) is valid for every conic (no NaN at eps == 0)
    this.periapsis = hAng * hAng / C.MU_EARTH / (1 + e) - C.R_EARTH;
    this.apoapsis = eps >= 0 ? Infinity : a * (1 + e) - C.R_EARTH;
    return { eps: eps, a: a, e: e };
  };

  // Advance the sim by `seconds` of flight time. Returns the flight.
  Flight.prototype.advance = function (seconds) {
    var cfg = this.cfg, remaining = seconds;
    var steps = 0, MAX_STEPS = 400000; // hard cap per call, spiral-of-death guard
    while (remaining > 0 && this.status === 'flying' && steps++ < MAX_STEPS) {
      var r = Math.sqrt(this.x * this.x + this.y * this.y);
      var h = r - C.R_EARTH;
      var stage = cfg.stages[this.stageIndex];
      var haveFuel = !!stage && this.stageFuel > 0;

      // Guidance phases above the thick atmosphere:
      //   insertion (closed-loop burn) -> coast (to apoapsis) -> circ (burn)
      if (this.guided && haveFuel && h > 40e3) {
        var elG = this._orbitElements();
        var vrG = (this.x * this.vx + this.y * this.vy) / r;
        if (this.apMode === 'ascent') this.apMode = 'insertion';
        if (this.apMode === 'insertion' && elG.eps < 0 && isFinite(this.apoapsis) &&
            this.apoapsis >= this.targetAp && vrG > 0) {
          this.apMode = 'coast';
          this.events.push({ t: this.t, type: 'coast' });
        }
        if (this.apMode === 'coast') {
          if (h < 50e3) this.apMode = 'insertion';         // sagging — power back on
          else if ((C.R_EARTH + this.apoapsis) - r < 15e3 || vrG < 25) {
            this.apMode = 'circ';
            this.events.push({ t: this.t, type: 'circburn' });
          }
        }
      }
      var burning = haveFuel && this.apMode !== 'coast';
      var padHeld = false;

      // adaptive dt: fine while thrusting and through the orbit-decision band
      // (a dt switch exactly at the orbit threshold lets integrator drift
      // fabricate orbits — keep it fine well past ORBIT_MIN)
      var dt;
      if (burning || h < C.FINE_DT_TOP) dt = 0.05;
      else if (h < 1000e3) dt = 0.5;
      else dt = 4;
      if (dt > remaining) dt = remaining;

      // gravity
      var invR = 1 / r;
      var gMag = C.MU_EARTH * invR * invR;
      var ax = -gMag * this.x * invR;
      var ay = -gMag * this.y * invR;

      // thrust along the pitch program
      this.thrusting = false;
      if (burning) {
        var thrust = stage.engine.thrust * stage.engineCount;
        // pitch: 0 (radial out) -> pi/2 (prograde-east) between turn altitudes
        var pitch = 0;
        if (cfg.turnEnd > cfg.turnStart) {
          var f = (h - cfg.turnStart) / (cfg.turnEnd - cfg.turnStart);
          f = f < 0 ? 0 : (f > 1 ? 1 : f);
          pitch = f * f * (3 - 2 * f) * (Math.PI / 2); // smoothstep
        }
        var upx = this.x * invR, upy = this.y * invR;       // local vertical
        var eastx = upy, easty = -upx;                       // local east (+x at launch... see note)
        // note: at (0,R), up=(0,1) so east=(1,0). Good.
        var tx = upx * Math.cos(pitch) + eastx * Math.sin(pitch);
        var ty = upy * Math.cos(pitch) + easty * Math.sin(pitch);
        // Above the thick atmosphere the guidance computer flies closed-loop:
        // burn mostly horizontal (that's what orbit IS — going sideways fast),
        // with a radial correction that steers apoapsis toward the target and
        // damps vertical speed. This is how real upper-stage guidance behaves.
        if (this.guided && h > 40e3 && this.apMode === 'insertion') {
          var vr = (this.x * this.vx + this.y * this.vy) / r;
          var apo = isFinite(this.apoapsis) ? this.apoapsis : this.targetAp * 2;
          var u = 1.5 * (1 - apo / this.targetAp) - vr / 1500;
          if (u > 1.2) u = 1.2; else if (u < -0.35) u = -0.35;
          var edir = (this.vx * eastx + this.vy * easty) >= 0 ? 1 : -1;
          tx = eastx * edir + upx * u; ty = easty * edir + upy * u;
          var tn = Math.sqrt(tx * tx + ty * ty) || 1;
          tx /= tn; ty /= tn;
        }
        // Circularization: prograde at apoapsis, the cheapest place to buy
        // periapsis altitude.
        if (this.apMode === 'circ') {
          var vNowC = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
          if (vNowC > 1) { tx = this.vx / vNowC; ty = this.vy / vNowC; }
        }
        var aT = thrust / this.mass;
        // don't lift off until TWR > 1 (clamped to the pad)
        if (h <= 0.5 && aT * (tx * upx + ty * upy) <= gMag) {
          // engines on, going nowhere — burn fuel in place
          ax = 0; ay = 0;
          padHeld = true;
        } else {
          ax += aT * tx; ay += aT * ty;
          this.thrusting = true;
        }
        var mdot = thrust / stage.engine.ve;
        var burned = Math.min(this.stageFuel, mdot * dt);
        this.stageFuel -= burned;
        this.mass -= burned;
        this.dvSpent += (thrust / this.mass) * dt * (this.thrusting ? 1 : 0);
        if (this.stageFuel <= 1e-9) {
          // burnout: jettison stage
          var sm = stageMasses(stage);
          this.mass -= sm.dry;
          this.events.push({ t: this.t, type: this.stageIndex + 1 < cfg.stages.length ? 'staging' : 'burnout' });
          this.stageIndex++;
          this.stageFuel = this.stageIndex < cfg.stages.length ?
            stageMasses(cfg.stages[this.stageIndex]).fuel : 0;
        }
      }

      // drag
      var v = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      var rho = airDensity(h);
      if (rho > 0 && v > 0.1) {
        var fd = 0.5 * rho * v * v * cfg.cdA;
        var aD = fd / this.mass;
        ax -= aD * this.vx / v;
        ay -= aD * this.vy / v;
        this.lastDrag = fd;
      } else this.lastDrag = 0;

      // semi-implicit Euler
      this.vx += ax * dt; this.vy += ay * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.t += dt; remaining -= dt;

      var r2 = Math.sqrt(this.x * this.x + this.y * this.y);
      var h2 = r2 - C.R_EARTH;
      var v2 = this.speed();
      if (h2 > this.maxAlt) this.maxAlt = h2;
      if (v2 > this.maxSpeed) this.maxSpeed = v2;

      // apoapsis event (for flavor)
      var rising = (this.x * this.vx + this.y * this.vy) > 0;
      if (this.wasRising && !rising && h2 > 100) {
        this.events.push({ t: this.t, type: 'apoapsis', alt: h2 });
      }
      this.wasRising = rising;

      // terminal states (a vehicle held on the pad by TWR<=1 is not "landed" —
      // it is still burning; it lands when the fuel runs out)
      if (h2 <= 0 && !padHeld) {
        this.x *= C.R_EARTH / r2; this.y *= C.R_EARTH / r2;
        this.status = v2 > 8 ? 'crashed' : 'landed';
        this.vx = 0; this.vy = 0;
        break;
      }
      if (h2 > C.ATMO_TOP) {
        var el = this._orbitElements();
        // 2 km hysteresis so residual integrator noise can't fabricate orbits
        if (el.eps < 0 && this.periapsis > C.ORBIT_MIN + 2e3) { this.status = 'orbit'; break; }
        if (el.eps >= 0 && !burning && h2 > 400e3) { this.status = 'escape'; break; }
      }
    }
    return this;
  };

  // Remaining dv in the vehicle right now (current stage partial fuel + upper stages)
  Flight.prototype.remainingDv = function () {
    var cfg = this.cfg, dv = 0, above = this.mass, i;
    for (i = this.stageIndex; i < cfg.stages.length; i++) {
      var sm = stageMasses(cfg.stages[i]);
      var fuel = (i === this.stageIndex) ? this.stageFuel : sm.fuel;
      var m1 = above - fuel;
      dv += tsiolkovsky(cfg.stages[i].engine.ve, above, m1);
      above = m1 - sm.dry;
    }
    return dv;
  };

  var P = {
    C: C,
    tsiolkovsky: tsiolkovsky,
    tsiolkovskyRel: tsiolkovskyRel,
    airDensity: airDensity,
    stageMasses: stageMasses,
    vehicleStats: vehicleStats,
    Flight: Flight
  };

  root.ASP = root.ASP || {};
  root.ASP.physics = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
