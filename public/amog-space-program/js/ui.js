/* Amog Space Program — DOM UI. */
(function (root) {
  'use strict';
  var P = root.ASP.physics, D = root.ASP.data, G = root.ASP.game;
  var $ = function (id) { return document.getElementById(id); };

  var els = {};
  var currentTab = 'rocket';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function txt(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Tabs -----------------------------------------------------------------

  function switchTab(name) {
    currentTab = name;
    document.querySelectorAll('#tabs .tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    refresh();
  }

  // ---- Rocket builder -------------------------------------------------------

  function renderStages() {
    var box = $('stages');
    box.innerHTML = '';
    var st = G.state, design = st.design;
    var maxE = G.maxEngines(), maxT = G.maxTanks();

    design.stages.forEach(function (s, i) {
      var e = D.ENGINES[s.engine];
      var card = el('div', 'stage-card');
      var head = el('div', 'stage-head',
        '<b>Stage ' + (i + 1) + '</b>' + (e.planner ? ' <span class="chip">orbital tug</span>' : ''));
      if (design.stages.length > 1) {
        var rm = el('button', 'ghost tiny', '✕');
        rm.title = 'Remove stage';
        rm.onclick = function () { design.stages.splice(i, 1); refresh(); };
        head.appendChild(rm);
      }
      card.appendChild(head);

      var sel = document.createElement('select');
      Object.keys(D.ENGINES).forEach(function (id) {
        if (!st.engines[id]) return;
        var o = document.createElement('option');
        o.value = id;
        o.textContent = D.ENGINES[id].name + '  (ve ' + D.fmtSpeed(D.ENGINES[id].ve) + ')';
        if (id === s.engine) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { s.engine = sel.value; refresh(); };
      card.appendChild(sel);

      card.appendChild(stepper('engines ×', s.count, 1, maxE, function (v) { s.count = v; refresh(); }));
      card.appendChild(stepper('fuel tanks', s.tanks, 0, maxT, function (v) { s.tanks = v; refresh(); }));
      box.appendChild(card);
    });

    var add = $('add-stage');
    add.classList.toggle('hidden', design.stages.length >= G.maxStages());
  }

  function stepper(label, val, min, max, onset) {
    var w = el('div', 'stepper');
    w.appendChild(el('span', 'steplabel', txt(label)));
    var minus = el('button', 'ghost tiny', '−');
    var num = el('b', '', val + '<span class="stepmax">/' + max + '</span>');
    var plus = el('button', 'ghost tiny', '+');
    minus.onclick = function () { if (val > min) onset(val - 1); };
    plus.onclick = function () { if (val < max) onset(val + 1); };
    w.appendChild(minus); w.appendChild(num); w.appendChild(plus);
    return w;
  }

  function renderDesignStats() {
    var box = $('design-stats');
    var r = G.resolveDesign();
    var html = '';
    if (r.ascent.length) {
      html += '<table><tr><th></th><th>Δv</th><th>TWR</th><th>burn</th></tr>';
      r.stats.perStage.forEach(function (ps, i) {
        html += '<tr><td>S' + (i + 1) + '</td><td>' + D.fmtSpeed(ps.dv) + '</td><td class="' +
          (i === 0 && ps.twr < 1.05 ? 'bad' : '') + '">' + ps.twr.toFixed(2) + '</td><td>' +
          ps.burnTime.toFixed(0) + 's</td></tr>';
      });
      html += '</table>';
      html += '<div class="total">Total ascent Δv: <b>' + D.fmtSpeed(r.stats.totalDv) + '</b>';
      if (G.state.gotOrbit || G.state.bestAlt > 100e3) {
        html += ' <span class="hint">(orbit needs ≈ ' + D.fmtSpeed(D.LEO_DV) + ' incl. losses)</span>';
      }
      html += '</div>';
      if (r.stats.liftoffTwr < 1.02) {
        html += '<div class="bad">TWR &lt; 1 — this will sit on the pad and burn until it’s light enough.</div>';
      } else if (r.stats.liftoffTwr > 2.6 && G.state.bestAlt < 200e3) {
        html += '<div class="hint">TWR ' + r.stats.liftoffTwr.toFixed(1) +
          ' — thick air punishes speed (drag ∝ v²). Fewer engines or more tanks usually flies higher.</div>';
      }
      if (r.spaceDv > 0) {
        html += '<div class="good">Orbital tug Δv: ' + D.fmtSpeed(r.spaceDv) +
          ' <span class="hint">(added to mission budget once you reach orbit)</span></div>';
      }
    } else {
      html = '<div class="bad">No atmosphere-capable engines. Ion drives can’t lift off.</div>';
    }
    box.innerHTML = html;
  }

  function renderStructureShop() {
    var box = $('structure-shop');
    box.innerHTML = '';
    Object.keys(D.STRUCTURE).forEach(function (key) {
      if (key === 'constellation' && !G.state.gotOrbit) return;
      var spec = D.STRUCTURE[key];
      var owned = G.state.structure[key];
      var cur = key === 'constellation' ? G.satCap() : spec.start + owned;
      var maxed = cur >= spec.max;
      var cost = D.structureCost(spec, owned);
      var b = el('button', 'shopitem' + (maxed || G.state.funds < cost ? ' locked' : ''));
      b.innerHTML = '<b>' + txt(spec.name) + '</b> <span>' + txt(spec.desc) + '</span>' +
        '<em>' + (maxed ? 'MAX (' + cur + ')' : 'now ' + cur + ' — $' + D.fmt(cost)) + '</em>';
      b.disabled = maxed;
      b.onclick = function () { if (G.buyStructure(key)) refresh(); };
      box.appendChild(b);
    });
  }

  function renderEngineShop() {
    var box = $('engine-shop');
    box.innerHTML = '';
    Object.keys(D.ENGINES).forEach(function (id) {
      var e = D.ENGINES[id];
      if (G.state.engines[id]) return;
      if (!G.engineUnlocked(id)) return;
      var b = el('button', 'shopitem' + (G.state.funds < e.cost ? ' locked' : ''));
      b.innerHTML = '<b>' + txt(e.name) + '</b> <span>' + txt(e.blurb) +
        ' — ve ' + D.fmtSpeed(e.ve) + ', ' + D.fmt(e.thrust / 1000) + ' kN</span>' +
        '<em>$' + D.fmt(e.cost) + '</em>';
      b.onclick = function () {
        var res = G.buyEngine(id);
        if (res) {
          toast(res.equipped ? e.name + ' purchased and fitted to Stage 1.'
                             : e.name + ' purchased — pick it in a stage dropdown.', 'good');
          refresh();
        }
      };
      box.appendChild(b);
    });
    if (!box.children.length) {
      box.innerHTML = G.state.bestAlt < 1000
        ? '<p class="hint">Nothing for sale yet — new hardware unlocks as you fly higher.</p>'
        : '<p class="hint">Nothing new for sale. Research unlocks more engines.</p>';
    }
  }

  // ---- R&D ------------------------------------------------------------------

  function gateText(r) {
    var st = G.state, parts = [];
    if (r.requiresAlt && st.bestAlt < r.requiresAlt) parts.push('reach ' + D.fmtDist(r.requiresAlt));
    if (r.requiresOrbit && !st.gotOrbit) parts.push('reach orbit');
    if (r.requiresMission && !st.missionsDone[r.requiresMission]) {
      var m = D.MISSIONS.find(function (x) { return x.id === r.requiresMission; });
      parts.push('complete ' + (m ? m.name : r.requiresMission));
    }
    return parts.join(', ');
  }

  function renderResearch() {
    var box = $('research-list');
    box.innerHTML = '';
    // funds -> science, so money stays relevant while research is the wall
    var n = G.state.outsourced;
    var oc = D.outsourceCost(n), os = Math.round(D.outsourceSci(n) * G.globalMult());
    var ob = el('button', 'shopitem' + (G.state.funds < oc ? ' locked' : ''));
    ob.innerHTML = '<b>Outsource a study</b>' +
      '<span>Pay a university to do the science for you. Repeatable; each one costs more.</span>' +
      '<em>−$' + D.fmt(oc) + ' → +' + D.fmt(os) + '⚗</em>';
    ob.onclick = function () { if (G.buyOutsource()) refresh(); };
    box.appendChild(ob);
    D.RESEARCH.forEach(function (r) {
      if (G.state.research[r.id]) return;
      // hide only entries whose research prerequisites are unmet (keeps the
      // tree tidy); alt/orbit/mission gates show as visible locks with goals
      if (r.requires) {
        for (var i = 0; i < r.requires.length; i++)
          if (!G.state.research[r.requires[i]]) return;
      }
      var gate = gateText(r);
      var afford = G.state.sci >= r.sci;
      var b = el('button', 'shopitem' + (gate || !afford ? ' locked' : ''));
      b.innerHTML = '<b>' + (gate ? '🔒 ' : '') + txt(r.name) + '</b> <span>' + txt(r.desc) + '</span>' +
        '<em>' + (gate ? 'to unlock: ' + txt(gate) : D.fmt(r.sci) + '⚗') + '</em>';
      b.disabled = !!gate;
      b.onclick = function () {
        if (G.buyResearch(r.id)) {
          var hint = { stage2: ' Use “+ add stage” in the Rocket tab.',
                       stage3: ' Use “+ add stage” in the Rocket tab.',
                       guidance: ' Toggle + sliders are in the Rocket tab.',
                       mc1: ' Tick “Auto-launch” under the LAUNCH button.' }[r.id] || '';
          toast('Researched: ' + r.name + '.' + hint, 'good');
          refresh();
        }
      };
      box.appendChild(b);
    });
    if (box.children.length <= 1) box.appendChild(el('p', 'hint', 'Everything is researched. Amog salutes you.'));
  }

  // ---- Missions -------------------------------------------------------------

  function renderMissions() {
    var st = G.state;
    $('budget-box').innerHTML =
      '<div class="budget">Mission Δv budget: <b>' + D.fmtSpeed(st.bestBudget) + '</b>' +
      '<div class="hint">Leftover Δv after your best orbital insertion (+ orbital tug stages). ' +
      'To land somewhere you must also <em>slow down</em> at the other end — it’s all in the budget.' +
      (st.research.slingshot ? ' <b class="good">Jupiter slingshot active: outer-system discounts applied.</b>' : '') +
      '</div></div>';

    var am = st.activeMission, box = $('active-mission');
    if (am) {
      var m = D.MISSIONS.find(function (x) { return x.id === am.id; });
      var elapsed = Date.now() / 1000 - am.t0;
      var f = Math.max(0, Math.min(1, elapsed / am.dur));
      var eta = Math.max(0, am.dur - elapsed);
      box.innerHTML = '<div class="mission-active"><b>' + txt(m ? m.name : am.id) + '</b>' +
        ' <span class="hint">' + D.fmtTime(eta) + ' remaining</span>' +
        '<div class="bar"><i style="width:' + (f * 100).toFixed(1) + '%"></i></div></div>';
    } else box.innerHTML = '';

    var list = $('mission-list');
    list.innerHTML = '';
    D.MISSIONS.forEach(function (m) {
      if (!G.missionVisible(m)) return;
      var need = G.missionDv(m);
      var done = st.missionsDone[m.id] || 0;
      var cost = G.missionCost(m);
      var can = !st.activeMission && st.bestBudget >= need && st.funds >= cost;
      var b = el('button', 'shopitem mission' + (can ? '' : ' locked') + (done ? ' done' : ''));
      var dur = G.missionDuration(m);
      b.innerHTML = '<b>' + txt(m.name) + (done ? ' ✓' + (done > 1 ? '×' + done : '') : '') + '</b>' +
        '<span>needs ' + D.fmtSpeed(need) + ' beyond LEO · ~' + dur.toFixed(0) + 's' +
        (st.bestBudget > need * 1.05 ? ' (excess Δv = faster transfer)' : '') +
        (m.descent ? ' · 🕹 manual descent: soft landing pays ×1.5' : '') +
        (m.assistDv && !st.research.slingshot ? ' (with assist: ' + D.fmtSpeed(m.assistDv) + ')' : '') +
        (m.note ? ' — ' + txt(m.note) : '') + '</span>' +
        '<em>−$' + D.fmt(cost) + ' → +$' + D.fmt(m.funds * (done ? 0.2 : 1)) + ' +' + D.fmt(m.sci * (done ? 0.2 : 1)) + '⚗</em>';
      b.onclick = function () {
        if (G.startMission(m.id)) {
          refresh();
          if (m.descent) offerDescent(m);
        }
      };
      list.appendChild(b);
    });
  }

  // ---- Manual descent minigame ----------------------------------------------
  // The suicide burn, playable: gravity pulls you down, you have one engine,
  // limited Δv, and the optimal strategy is to brake as late as you dare.

  var descentActive = false;

  function offerDescent(m) {
    G.missionHold = true;
    openModal(
      '<h2>🕹 MANUAL DESCENT — ' + txt(m.descent.body) + '</h2>' +
      '<p>The transfer stage has done its job. The last few kilometers are yours: ' +
      'gravity pulls at ' + m.descent.g.toFixed(2) + ' m/s², and the most efficient landing ' +
      'is a <b>suicide burn</b> — brake as late as you dare.</p>' +
      '<p class="hint">Touch down under 5 m/s → rewards ×1.5. Under 15 m/s → ×1. ' +
      'Faster than that → the probe becomes a crater (×0.5).</p>' +
      '<button id="descent-fly">Fly it yourself 🕹</button> ' +
      '<button id="descent-skip" class="ghost">Auto-land (×1)</button>');
    $('descent-fly').onclick = function () { runDescent(m); };
    $('descent-skip').onclick = function () { G.missionHold = false; closeModal(); };
  }

  function runDescent(m) {
    var g = m.descent.g;
    // every approach is a little different — keeps repeat landings a skill
    var alt0 = 1000 + Math.random() * 600;
    var alt = alt0, vel = 50 + Math.random() * 40; // m, m/s downward
    var burnA = 3.2 * g;                          // engine acceleration
    var ideal = Math.sqrt(vel * vel + 2 * g * alt) * Math.sqrt(burnA / (burnA - g));
    var fuel = ideal * 1.35;                      // Δv budget with 35% margin
    var burning = false, over = false;
    descentActive = true;

    openModal(
      '<h2>Descending to ' + txt(m.descent.body) + '</h2>' +
      '<div id="descent-hud" class="hudrow" style="margin-bottom:6px"></div>' +
      '<canvas id="descent-canvas" width="380" height="240" style="width:100%;border:1px solid var(--edge);border-radius:8px;background:#05070d"></canvas>' +
      '<button id="descent-burn" style="width:100%;margin-top:10px;touch-action:none;user-select:none;-webkit-user-select:none">🔥 BURN (hold — or hold SPACE)</button>');
    var cv = $('descent-canvas'), c2 = cv.getContext('2d');
    var burnBtn = $('descent-burn');
    burnBtn.onpointerdown = function (e) { e.preventDefault(); burning = true; };
    burnBtn.onpointerup = burnBtn.onpointerleave = function () { burning = false; };
    function keydn(e) { if (e.code === 'Space') { e.preventDefault(); burning = true; } }
    function keyup(e) { if (e.code === 'Space') burning = false; }
    document.addEventListener('keydown', keydn);
    document.addEventListener('keyup', keyup);

    var last = performance.now();
    var timer = setInterval(function () { frame(performance.now()); }, 33);
    function frame(now) {
      if (over) return;
      var dt = Math.min((now - last) / 1000, 0.1) * 1.5; // gentle time scale
      last = now;
      var thrust = burning && fuel > 0;
      if (thrust) {
        vel -= burnA * dt;
        fuel -= burnA * dt;
      }
      vel += g * dt;
      alt -= vel * dt;
      if (alt > 2200) { finish(1, 'You flew away. The autopilot sighs and takes over.'); return; }
      if (alt <= 0) {
        var v = Math.abs(vel);
        if (v <= 5) finish(1.5, 'FLAWLESS LANDING — ' + v.toFixed(1) + ' m/s. NASA is taking notes. Rewards ×1.5!');
        else if (v <= 15) finish(1, 'Landed at ' + v.toFixed(1) + ' m/s. Firm, but everything beeps. Rewards ×1.');
        else finish(0.5, 'Impact at ' + v.toFixed(0) + ' m/s. The probe is now geology. Rewards ×0.5.');
        return;
      }
      // draw
      c2.clearRect(0, 0, 380, 240);
      c2.fillStyle = '#05070d'; c2.fillRect(0, 0, 380, 240);
      c2.fillStyle = '#fff';
      for (var i = 0; i < 24; i++) c2.fillRect((i * 73) % 380, (i * 37) % 200, 1.5, 1.5);
      c2.fillStyle = '#6b6b5f'; c2.fillRect(0, 222, 380, 18);
      var y = 210 - (alt / alt0) * 195;
      c2.fillStyle = '#e8e4da';
      c2.beginPath(); c2.moveTo(190, y); c2.lineTo(198, y + 14); c2.lineTo(182, y + 14); c2.closePath(); c2.fill();
      if (thrust) {
        c2.fillStyle = 'rgba(255,160,60,0.9)';
        c2.beginPath(); c2.moveTo(186, y + 15); c2.lineTo(194, y + 15); c2.lineTo(190, y + 25 + Math.random() * 6); c2.closePath(); c2.fill();
      }
      $('descent-hud').innerHTML =
        '<span>ALT <b>' + Math.max(0, alt).toFixed(0) + ' m</b></span>' +
        '<span>VEL <b class="' + (vel > 15 ? 'bad' : '') + '">' + vel.toFixed(1) + ' m/s</b></span>' +
        '<span>Δv <b class="' + (fuel < ideal * 0.2 ? 'bad' : '') + '">' + Math.max(0, fuel).toFixed(0) + ' m/s</b></span>';
    }
    function finish(mult, text) {
      over = true; burning = false; descentActive = false;
      clearInterval(timer);
      document.removeEventListener('keydown', keydn);
      document.removeEventListener('keyup', keyup);
      G.setDescentResult(m.id, mult);
      G.missionHold = false;
      openModal('<h2>' + (mult > 1 ? '🏆 ' : mult < 1 ? '💥 ' : '') + 'Touchdown report</h2>' +
        '<p>' + txt(text) + '</p><button id="modal-close">Continue</button>');
    }
  }

  // ---- Stars ----------------------------------------------------------------

  var shipSel = { engine: 'orion', ratio: 20, mode: 'flyby', star: 'alphacen' };

  function renderStars() {
    var st = G.state;
    // never leave a locked engine selected
    if (!G.shipEngineUnlocked(shipSel.engine)) {
      var firstUnlocked = Object.keys(D.STAR_ENGINES).filter(G.shipEngineUnlocked)[0];
      if (firstUnlocked) shipSel.engine = firstUnlocked;
    }
    $('warp-box').innerHTML =
      '<div class="budget">Deep-time warp: <b>' + D.fmt(G.warpRate()) + ' years/s</b> ' +
      '<button class="ghost tiny" id="warp-up"' + (st.sci < G.warpUpCost() || st.warpLevel >= 14 ? ' disabled' : '') + '>' +
      (st.warpLevel >= 14 ? 'MAX' : 'upgrade — ' + D.fmt(G.warpUpCost()) + '⚗') + '</button>' +
      '<div class="hint">Interstellar travel takes decades to megayears. Time is a resource; warp it.</div></div>';
    var wu = $('warp-up');
    if (wu) wu.onclick = function () { if (G.buyWarp()) refresh(); };

    // builder
    var b = $('ship-builder');
    var html = '<div class="ship-engines">';
    Object.keys(D.STAR_ENGINES).forEach(function (id) {
      var e = D.STAR_ENGINES[id];
      var unlocked = G.shipEngineUnlocked(id);
      html += '<label class="' + (unlocked ? '' : 'locked') + '"><input type="radio" name="seng" value="' + id + '"' +
        (shipSel.engine === id ? ' checked' : '') + (unlocked ? '' : ' disabled') + '> <b>' + txt(e.name) + '</b>' +
        '<span class="hint"> ' + txt(e.blurb) + '</span></label>';
    });
    html += '</div>';
    var isSail = shipSel.engine === 'sail';
    if (!isSail) {
      html += '<label>mass ratio m₀/m₁ = <b id="ratio-val">' + shipSel.ratio + '</b>' +
        '<input type="range" id="ship-ratio" min="0" max="100" value="' +
        Math.round(Math.log(shipSel.ratio / 2) / Math.log(500) * 100) + '"></label>';
    }
    html += '<div class="modes"><label><input type="radio" name="smode" value="flyby"' +
      (shipSel.mode === 'flyby' ? ' checked' : '') + '> flyby</label>' +
      '<label><input type="radio" name="smode" value="colonize"' +
      (shipSel.mode === 'colonize' ? ' checked' : '') + '> colonize <span class="hint">(burn half the Δv slowing down)</span></label></div>';
    html += '<select id="ship-star">';
    D.STARS.forEach(function (s) {
      if (s.intergalactic && !Object.keys(st.colonies).length) return;
      html += '<option value="' + s.id + '"' + (shipSel.star === s.id ? ' selected' : '') + '>' +
        txt(s.name) + ' — ' + (s.ly >= 1000 ? D.fmt(s.ly) : s.ly) + ' ly' +
        (st.colonies[s.id] ? ' (colonized)' : st.flybys[s.id] ? ' (visited)' : '') + '</option>';
    });
    html += '</select>';

    var cruise = G.shipCruise(shipSel.engine, shipSel.ratio, shipSel.mode);
    var star = D.STARS.find(function (s) { return s.id === shipSel.star; });
    var cost = G.shipCost(shipSel.engine, shipSel.ratio, shipSel.mode);
    if (cruise <= 0) {
      html += '<div class="bad">Sails can’t brake — research the magnetic sail to colonize with one.</div>';
    } else if (star) {
      var years = star.ly / cruise;
      var gamma = 1 / Math.sqrt(1 - cruise * cruise);
      html += '<div class="total">cruise <b>' + cruise.toFixed(3) + 'c</b> → ' + txt(star.name) + ' in <b>' +
        D.fmtYears(years) + '</b>' +
        (gamma > 1.05 ? ' <span class="hint">(crew experiences ' + D.fmtYears(years / gamma) + ' — relativity!)</span>' : '') +
        '</div>';
    }
    var engineLocked = !G.shipEngineUnlocked(shipSel.engine);
    html += '<button id="ship-launch"' + (engineLocked || cruise <= 0 || st.funds < cost ? ' disabled' : '') +
      '>' + (engineLocked ? 'Research a starship drive first' : 'Launch starship — $' + D.fmt(cost)) + '</button>';
    b.innerHTML = html;

    b.querySelectorAll('input[name="seng"]').forEach(function (r) {
      r.onchange = function () { shipSel.engine = r.value; renderStars(); };
    });
    b.querySelectorAll('input[name="smode"]').forEach(function (r) {
      r.onchange = function () { shipSel.mode = r.value; renderStars(); };
    });
    var rs = $('ship-ratio');
    if (rs) {
      // live label while dragging; full re-render only on release
      rs.oninput = function () {
        shipSel.ratio = Math.round(2 * Math.pow(500, rs.value / 100));
        var rv = $('ratio-val');
        if (rv) rv.textContent = shipSel.ratio;
      };
      rs.onchange = function () { renderStars(); };
    }
    var ss = $('ship-star');
    if (ss) ss.onchange = function () { shipSel.star = ss.value; renderStars(); };
    var lb = $('ship-launch');
    if (lb) lb.onclick = function () {
      if (G.launchShip(shipSel.engine, shipSel.ratio, shipSel.mode, shipSel.star)) refresh();
    };

    // in flight
    var sl = $('ship-list');
    sl.innerHTML = st.ships.length ? '' : '<p class="hint">No ships in flight.</p>';
    st.ships.forEach(function (s) {
      var star2 = D.STARS.find(function (x) { return x.id === s.star; });
      if (!star2) return;
      var f = Math.min(1, s.progressLy / star2.ly);
      var left = (star2.ly - s.progressLy) / s.cruiseC / G.warpRate();
      var row = el('div', 'mission-active');
      row.innerHTML = '<b>' + txt(s.name) + ' → ' + txt(star2.name) + '</b> <span class="hint">' +
        (s.mode === 'colonize' ? 'colony ship' : 'flyby probe') + ', ' + s.cruiseC.toFixed(3) + 'c — ' +
        D.fmtTime(Math.max(0, left)) + ' real time left</span>' +
        '<div class="bar"><i style="width:' + (f * 100).toFixed(2) + '%"></i></div>';
      sl.appendChild(row);
    });

    // colonies
    var cl = $('colony-list');
    var names = D.STARS.filter(function (s) { return st.colonies[s.id]; }).map(function (s) { return s.name; });
    cl.innerHTML = names.length
      ? '<p>' + names.map(txt).join(' · ') + '</p><p class="hint">Each colony doubles all income.</p>'
      : '<p class="hint">None yet. Send a colony ship (it must be able to slow down).</p>';
  }

  // ---- Log ------------------------------------------------------------------

  function renderLog() {
    var box = $('log-list');
    box.innerHTML = '';
    G.log.slice().reverse().forEach(function (l) {
      box.appendChild(el('div', 'logline ' + l.kind, txt(l.text)));
    });
    var st = G.state;
    $('stats-line').textContent =
      'Launches: ' + st.totalLaunches + ' · Best altitude: ' + D.fmtDist(st.bestAlt) +
      ' · Best speed: ' + D.fmtSpeed(st.bestSpeed) +
      ' · Colonies: ' + G.colonyCount();
  }

  // ---- HUD ------------------------------------------------------------------

  function updateHud() {
    var f = G.flight;
    var flying = !!f;
    $('hud').classList.toggle('hidden', !flying);
    $('warpbar').classList.toggle('hidden', !flying);
    $('idle-hint').classList.toggle('hidden', flying || G.state.totalLaunches > 0);
    document.querySelectorAll('#warpbar button[data-warp]').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.warp === G.warp);
    });
    if (!f) return;
    $('hud-alt').textContent = D.fmtDist(Math.max(0, f.alt()));
    $('hud-spd').textContent = D.fmtSpeed(f.speed());
    $('hud-dv').textContent = D.fmtSpeed(f.remainingDv());
    $('hud-mass').textContent = (f.mass / 1000).toFixed(2) + ' t';
    var r2 = Math.sqrt(f.x * f.x + f.y * f.y);
    var g = P.C.MU_EARTH / (r2 * r2);
    var stage = f.cfg.stages[f.stageIndex];
    var twr = stage && f.stageFuel > 0
      ? (stage.engine.thrust * stage.engineCount) / (f.mass * g) : 0;
    $('hud-twr').textContent = twr ? twr.toFixed(2) : '—';
    $('hud-drag').textContent = f.lastDrag > 1 ? D.fmt(f.lastDrag / 1000) + ' kN' : '0';
    var o = '';
    if (f.alt() > 60e3 && f.ecc < 1 && f.apoapsis > 0) {
      o = 'apo ' + D.fmtDist(f.apoapsis) + ' · peri ' +
        (f.periapsis > 0 ? D.fmtDist(f.periapsis) : 'underground');
    }
    $('hud-orbit').textContent = o;
    var spent = f.stageIndex >= f.cfg.stages.length;
    $('hud-mode').textContent =
      f.apMode === 'insertion' ? 'guidance: closed-loop insertion' :
      f.apMode === 'coast' && f.stageFuel > 0 ? 'guidance: coasting to apoapsis' :
      f.apMode === 'circ' ? 'guidance: circularization burn' :
      f.thrusting ? 'burn: stage ' + (f.stageIndex + 1) :
      f.stageFuel > 0 ? 'pad hold (TWR<1) — burning down to liftoff weight' :
      spent ? 'ballistic' : 'coasting';
  }

  function renderLastFlight() {
    var box = $('last-flight');
    var res = G.lastResult;
    if (!res) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var s = STATUS_LINE[res.status] || ['Flight over', ''];
    box.innerHTML = '<b>Last flight: ' + txt(s[0]) + '</b>' +
      '<span>' + D.fmtDist(res.maxAlt) + ' · ' + D.fmtSpeed(res.maxSpeed) + ' · ' + D.fmtTime(res.t) + '</span>' +
      '<em>+$' + D.fmt(res.funds) + (res.sci >= 1 ? ' · +' + D.fmt(res.sci) + '⚗' : '') +
      (res.budget ? ' · budget ' + D.fmtSpeed(res.budget) : '') + '</em>';
  }

  // ---- Results modal --------------------------------------------------------

  var STATUS_LINE = {
    crashed: ['Lithobraking detected', 'That was not a landing. Data recovered from the crater.'],
    landed: ['Soft landing?!', 'Somehow it came down gently. The interns are cheering.'],
    orbit: ['STABLE ORBIT', 'Periapsis clear of the atmosphere. You’re going sideways so fast you keep missing the ground.'],
    escape: ['EARTH ESCAPE', 'This one belongs to the Sun now.'],
    aborted: ['Flight aborted', 'Range safety pressed the big red button. Scored as flown so far.']
  };

  function showResults(res) {
    var s = STATUS_LINE[res.status] || ['Flight over', ''];
    var html = '<h2>' + s[0] + '</h2><p class="hint">' + s[1] + '</p>';
    html += '<table class="results">' +
      '<tr><td>Max altitude</td><td>' + D.fmtDist(res.maxAlt) + '</td></tr>' +
      '<tr><td>Max speed</td><td>' + D.fmtSpeed(res.maxSpeed) + '</td></tr>' +
      '<tr><td>Flight time</td><td>' + D.fmtTime(res.t) + '</td></tr>' +
      '<tr><td>Payout</td><td>+$' + D.fmt(res.funds) + (res.sci >= 1 ? ' · +' + D.fmt(res.sci) + '⚗' : '') + '</td></tr>' +
      (res.budget ? '<tr><td>Mission Δv budget</td><td>' + D.fmtSpeed(res.budget) + '</td></tr>' : '') +
      '</table>';
    if (res.satDeployed) html += '<p class="good">🛰 Satellite deployed — passive income increased.</p>';
    res.milestones.forEach(function (m) {
      html += '<div class="milestone"><b>' + txt(m.name) + '</b> — ' + txt(m.note || '') +
        ' <em>+$' + D.fmt(m.funds) + (m.sci ? ' +' + D.fmt(m.sci) + '⚗' : '') + '</em></div>';
    });
    html += '<button id="modal-close">Back to the pad</button>';
    queueModal(html);
  }

  function showWin() {
    if (G.state.wonShown) return;
    G.state.wonShown = true;
    queueModal(
      '<h2>🌌 AMOG INTERGALACTIC</h2>' +
      '<p>A colony ship has arrived in <b>Andromeda</b>. From a soda-bottle rocket that barely cleared ' +
      'the treeline, to a civilization spanning two galaxies.</p>' +
      '<p class="hint">Amog would be proud. The rocket equation was with you the whole way: ' +
      'Δv = vₑ · ln(m₀/m₁).</p>' +
      '<p class="hint">You can keep playing — there are always more stars.</p>' +
      '<button id="modal-close">Keep going</button>');
  }

  var modalQueue = [];
  function openModal(html) {
    $('modal').innerHTML = html;
    $('modal-back').classList.remove('hidden');
    var c = $('modal-close');
    if (c) c.onclick = closeModal;
  }
  // async modals (flight results, win screen) wait instead of clobbering
  // whatever dialog the player has open
  function queueModal(html) {
    if (!$('modal-back').classList.contains('hidden')) { modalQueue.push(html); return; }
    openModal(html);
  }
  function closeModal() {
    if (modalQueue.length) { openModal(modalQueue.shift()); return; }
    $('modal-back').classList.add('hidden');
    refresh();
  }

  function toast(text, kind) {
    var t = el('div', 'toast ' + (kind || ''), txt(text));
    $('toasts').appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 30);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 500);
    }, 4200);
  }

  // Feedback goes to GitHub issues with the player's game state attached —
  // "too grindy" means nothing without knowing where in the curve they are.
  // Everything is visible and editable before the player submits.
  function feedbackUrl() {
    var st = G.state;
    var research = Object.keys(st.research);
    var missions = Object.keys(st.missionsDone).map(function (id) {
      return id + (st.missionsDone[id] > 1 ? '×' + st.missionsDone[id] : '');
    });
    var design = st.design.stages.map(function (s, i) {
      var e = D.ENGINES[s.engine];
      return 'S' + (i + 1) + ' ' + (e ? e.name : s.engine) + '×' + s.count + ' + ' + s.tanks + ' tanks';
    }).join('; ');
    var body = [
      '**What felt off?** (too grindy / too easy / confusing / a bug — anything!)',
      '',
      '…write here…',
      '',
      '---',
      '_Auto-attached game state (edit or delete freely):_',
      '- Phase ' + G.phase() + ' · ' + D.fmtTime(st.timePlayed) + ' played · ' + st.totalLaunches + ' launches',
      '- Best altitude ' + D.fmtDist(st.bestAlt) + ' · best speed ' + D.fmtSpeed(st.bestSpeed),
      '- Mission Δv budget ' + D.fmtSpeed(st.bestBudget) + ' · $' + D.fmt(st.funds) + ' · ' +
        D.fmt(st.sci) + '⚗ · sats ' + st.sats + '/' + G.satCap(),
      '- Research (' + research.length + '): ' + (research.join(', ') || 'none'),
      '- Missions: ' + (missions.join(', ') || 'none'),
      '- Colonies: ' + (Object.keys(st.colonies).join(', ') || 'none'),
      '- Design: ' + design + ' · guidance ' + (st.design.guidanceOn
        ? 'on (' + D.fmtDist(st.design.turnStart) + '→' + D.fmtDist(st.design.turnEnd) + ')' : 'off')
    ].join('\n');
    var title = 'Balance feedback: phase ' + G.phase() + ', ' + st.totalLaunches + ' launches';
    return 'https://github.com/ErhaiYKao/amog-fun/issues/new?labels=feedback&title=' +
      encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
  }
  function openFeedback() { window.open(feedbackUrl(), '_blank', 'noopener'); }

  // One-time announcements (seen-flags live outside the save so a game reset
  // doesn't re-summon the gods)
  function announce(id, html) {
    var key = 'asp-notice-' + id;
    try { if (localStorage.getItem(key)) return; } catch (e) { /* show anyway */ }
    queueModal(html);
    try { localStorage.setItem(key, '1'); } catch (e) { /* fine */ }
  }

  // ---- Top-level refresh ----------------------------------------------------

  function refresh() {
    var st = G.state;
    var sciHidden = st.sci < 1 && !Object.keys(st.research).length;
    $('funds').textContent = D.fmt(st.funds);
    $('sci').textContent = D.fmt(st.sci);
    $('sats').textContent = st.sats + '/' + G.satCap();
    $('cur-sci').classList.toggle('hidden', sciHidden);
    $('cur-sats').classList.toggle('hidden', !st.gotOrbit);
    // mirror in the left panel, right where the spending happens
    $('funds-l').textContent = D.fmt(st.funds);
    $('sci-l').textContent = D.fmt(st.sci);
    $('sats-l').textContent = st.sats + '/' + G.satCap();
    $('cur-sci-l').classList.toggle('hidden', sciHidden);
    $('cur-sats-l').classList.toggle('hidden', !st.gotOrbit);
    // income per second, so the idle part of the game is visible
    var rates = G.incomeRates();
    [['funds-rate', rates.funds, '+$'], ['funds-rate-l', rates.funds, '+$'],
     ['sci-rate', rates.sci, '+'], ['sci-rate-l', rates.sci, '+']].forEach(function (r) {
      var e2 = $(r[0]);
      e2.classList.toggle('hidden', r[1] < 0.01);
      if (r[1] >= 0.01) e2.textContent = r[2] + D.fmt(r[1]) + (r[0].indexOf('sci') === 0 ? '⚗' : '') + '/s';
    });

    var phase = G.phase();
    $('phase-label').textContent =
      phase === 1 ? 'Phase 1 — GO UP' :
      phase === 2 ? 'Phase 2 — GO SIDEWAYS (orbit & the planets)' :
      phase === 3 ? 'Phase 3 — GO TO THE STARS' :
      'Phase ∞ — INTERGALACTIC';

    $('tab-rnd').classList.toggle('hidden', st.bestAlt < 10e3);
    $('tab-missions').classList.toggle('hidden', !st.gotOrbit);
    $('tab-stars').classList.toggle('hidden', phase < 3);

    // guidance sliders
    var gd = $('guidance');
    gd.classList.toggle('hidden', !st.research.guidance);
    if (st.research.guidance) {
      $('guidance-on').checked = st.design.guidanceOn === true;
      $('turn-start').value = st.design.turnStart;
      $('turn-end').value = st.design.turnEnd;
      $('ts-val').textContent = D.fmtDist(st.design.turnStart);
      $('te-val').textContent = D.fmtDist(st.design.turnEnd);
    }
    $('auto-wrap').classList.toggle('hidden', !G.autoInterval());
    $('auto-launch').checked = st.autolaunch;
    $('launch-btn').disabled = !!G.flight;

    if (currentTab === 'rocket') {
      renderStages(); renderDesignStats(); renderStructureShop(); renderEngineShop(); renderLastFlight();
    } else if (currentTab === 'rnd') renderResearch();
    else if (currentTab === 'missions') renderMissions();
    else if (currentTab === 'stars') renderStars();
    else if (currentTab === 'log') renderLog();
  }

  // ---- Init -----------------------------------------------------------------

  function init() {
    document.querySelectorAll('#tabs .tab').forEach(function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });
    $('launch-btn').onclick = function () {
      if (G.launch(true)) { $('launch-btn').disabled = true; }
    };
    $('add-stage').onclick = function () {
      var st = G.state.design.stages;
      if (st.length < G.maxStages()) {
        st.push({ engine: st[st.length - 1].engine, count: 1, tanks: 2 });
        refresh();
      }
    };
    $('auto-launch').onchange = function () {
      G.state.autolaunch = $('auto-launch').checked;
    };
    $('guidance-on').onchange = function () {
      G.state.design.guidanceOn = $('guidance-on').checked;
      refresh();
    };
    // keyboard: Space/Enter = launch (or dismiss modal), E = end flight
    document.addEventListener('keydown', function (ev) {
      if (descentActive) return; // the minigame owns the keyboard
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (ev.code === 'Space' || ev.code === 'Enter') {
        ev.preventDefault();
        if (!$('modal-back').classList.contains('hidden')) {
          var c = $('modal-close');
          if (c) c.click();
          return;
        }
        if (!G.flight && G.launch(true)) refresh();
      } else if (ev.key === 'e' || ev.key === 'E') {
        if (G.flight) $('end-flight').onclick();
      }
    });
    $('turn-start').oninput = function () {
      G.state.design.turnStart = +this.value;
      $('ts-val').textContent = D.fmtDist(+this.value);
    };
    $('turn-end').oninput = function () {
      G.state.design.turnEnd = +this.value;
      $('te-val').textContent = D.fmtDist(+this.value);
    };
    document.querySelectorAll('#warpbar button[data-warp]').forEach(function (b) {
      b.onclick = function () { G.warp = +b.dataset.warp; G.warpTouched = true; };
    });
    $('end-flight').onclick = function () {
      var f = G.flight;
      if (!f) return;
      // abort = stop NOW, score only what has actually been flown. (It used
      // to fast-forward the whole trajectory, which made waiting pointless.)
      if (f.status === 'flying') f.status = 'aborted';
      G.endFlight();
    };
    $('feedback-top').onclick = openFeedback;
    $('feedback-log').onclick = openFeedback;
    $('save-export').onclick = function () {
      var s = G.exportSave();
      openModal('<h2>Export save</h2><textarea id="save-text" readonly>' + s + '</textarea>' +
        '<p class="hint">Copy this somewhere safe.</p><button id="modal-close">Done</button>');
      var ta = $('save-text'); ta.focus(); ta.select();
    };
    $('save-import').onclick = function () {
      openModal('<h2>Import save</h2><textarea id="save-text" placeholder="paste save here"></textarea>' +
        '<button id="save-do">Import</button> <button id="modal-close" class="ghost">Cancel</button>');
      $('save-do').onclick = function () {
        if (G.importSave($('save-text').value)) { closeModal(); toast('Save imported.', 'good'); }
        else toast('That save didn’t parse.', 'warn');
      };
    };
    $('save-reset').onclick = function () {
      openModal('<h2>Reset everything?</h2><p>Your entire space program will be erased. Forever.</p>' +
        '<button id="reset-do" class="danger">Yes, erase it</button> <button id="modal-close" class="ghost">No</button>');
      $('reset-do').onclick = function () { G.hardReset(); closeModal(); };
    };

    G.on('flightEnd', function (res) {
      // the full-screen ceremony is reserved for flights that hit a milestone;
      // routine flights get a toast + the last-flight card, and the pad is
      // immediately ready again — no click-through loop
      if (res.manual && res.milestones.length) showResults(res);
      else if (res.manual) {
        var s = STATUS_LINE[res.status] || ['Flight over', ''];
        toast(s[0] + ' — ' + D.fmtDist(res.maxAlt) + ' · +$' + D.fmt(res.funds), '');
      } else if (res.milestones.length) {
        res.milestones.forEach(function (m) { toast(m.name, 'good'); });
      }
      refresh();
    });
    G.on('change', function () { if (!document.hidden) refresh(); });
    G.on('log', function () { if (currentTab === 'log') renderLog(); });
    G.on('won', showWin);
    G.on('missionDone', function (m) { toast('Mission complete: ' + m.name, 'good'); });

    refresh();
  }

  root.ASP.ui = { init: init, refresh: refresh, updateHud: updateHud, toast: toast, showWin: showWin, announce: announce };
})(typeof window !== 'undefined' ? window : globalThis);
