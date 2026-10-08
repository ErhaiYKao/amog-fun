/* Amog Space Program — DOM UI. */
(function (root) {
  'use strict';
  var P = root.ASP.physics, D = root.ASP.data, G = root.ASP.game;
  var $ = function (id) { return document.getElementById(id); };

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
  function costText(c) {
    var parts = [];
    if (c.funds) parts.push('$' + D.fmt(c.funds));
    if (c.sci) parts.push(D.fmt(c.sci) + '⚗');
    return parts.join(' + ') || 'free';
  }
  function clock(s) {
    s = Math.max(0, Math.ceil(s));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
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

  function objectiveInfo() {
    var st = G.state, o = st.objective;
    if (o && o.kind === 'contract') {
      var c = st.contracts.filter(function (x) { return x.id === o.id; })[0];
      if (c) return { label: 'Contract: ' + G.contractText(c), payload: c.payload, contract: c };
    }
    if (o && o.kind === 'mission') {
      var m = G.missionById(o.id);
      if (m) return { label: 'Mission: ' + m.name + (o.traj === 'assist' ? ' (gravity assist)' : ''),
        payload: m.payload, mission: m, traj: o.traj };
    }
    return { label: 'Free flight', payload: D.PAYLOAD_MASS };
  }

  function renderObjective() {
    var st = G.state, box = $('objective');
    var o = st.objective;
    var html = '<label class="objlabel">Flight objective</label><select id="obj-select">';
    html += '<option value="">Free flight — ' + D.PAYLOAD_MASS + ' kg sounding probe' +
      (G.autoTurnaround() ? ' (the crew’s job)' : '') + '</option>';
    st.contracts.forEach(function (c) {
      html += '<option value="c:' + c.id + '"' + (o && o.kind === 'contract' && o.id === c.id ? ' selected' : '') + '>' +
        'Contract: ' + txt(G.contractText(c)) + ' — $' + D.fmt(c.funds * G.globalMult()) + '</option>';
    });
    if (st.gotOrbit) {
      D.MISSIONS.forEach(function (m) {
        if (!G.missionVisible(m)) return;
        var trajs = G.canAssist(m) ? ['direct', 'assist'] : ['direct'];
        trajs.forEach(function (tr) {
          var sel = o && o.kind === 'mission' && o.id === m.id && (o.traj || 'direct') === tr;
          html += '<option value="m:' + m.id + ':' + tr + '"' + (sel ? ' selected' : '') + '>' +
            'Mission: ' + txt(m.name) + (tr === 'assist' ? ' (assist)' : '') + ' — ' + m.payload + ' kg, ' +
            D.fmtSpeed(G.missionNeed(m, tr)) + (st.missionsDone[m.id] ? ' ✓' : '') + '</option>';
        });
      });
    }
    html += '</select>';
    var info = objectiveInfo();
    if (info.contract) {
      var c = info.contract;
      html += '<div class="hint">' + txt(c.client) + ' wants: <b>' + txt(G.contractText(c)) + '</b>. ' +
        'Expires in ' + clock(c.expires - st.clock) + '.</div>';
    } else if (info.mission) {
      var m = info.mission, w = G.missionWindow(m);
      html += '<div class="hint">Reach orbit carrying <b>' + m.payload + ' kg</b> with <b>≥ ' +
        D.fmtSpeed(G.missionNeed(m, info.traj)) + '</b> of Δv left' + (m.ionOk ? ' (ion tugs count)' : '') +
        ' and the probe departs. ' + windowText(m, w) +
        (st.missions.length >= G.missionSlots() ? ' <span class="bad">All mission slots busy.</span>' : '') + '</div>';
    } else if (st.gotOrbit) {
      html += '<div class="hint">Pick a mission or contract to set the payload. Free flights that reach orbit deploy a satellite.</div>';
    }
    box.innerHTML = html;
    $('obj-select').onchange = function () {
      var v = this.value;
      if (!v) G.setObjective(null);
      else if (v.indexOf('c:') === 0) G.setObjective({ kind: 'contract', id: v.slice(2) });
      else {
        var parts = v.split(':');
        G.setObjective({ kind: 'mission', id: parts[1], traj: parts[2] });
      }
      refresh();
    };
  }

  function windowText(m, w) {
    w = w || G.missionWindow(m);
    if (w.always) return '';
    return w.open
      ? '<span class="win open">window open · closes in ' + clock(w.left) + '</span>'
      : '<span class="win shut">window opens in ' + clock(w.left) + ' (now ×' + D.WINDOW.offPenalty + ' Δv)</span>';
  }

  function renderStages() {
    var box = $('stages');
    box.innerHTML = '';
    var st = G.state, design = st.design;
    var maxE = G.maxEngines(), maxT = G.maxTanks();

    design.stages.forEach(function (s, i) {
      var e = D.ENGINES[s.engine];
      var card = el('div', 'stage-card');
      var chip = e.planner ? ' <span class="chip">orbital tug</span>' : e.upper ? ' <span class="chip">vacuum</span>' : '';
      var head = el('div', 'stage-head', '<b>Stage ' + (i + 1) + '</b>' + chip +
        ' <span class="hint">$' + D.fmt(e.unit * s.count + e.tank * s.tanks) + '/launch</span>');
      if (design.stages.length > 1) {
        var rm = el('button', 'ghost tiny', '✕');
        rm.title = 'Remove stage';
        rm.onclick = function () { G.removeStage(i); refresh(); };
        head.appendChild(rm);
      }
      card.appendChild(head);

      var sel = document.createElement('select');
      Object.keys(D.ENGINES).forEach(function (id) {
        if (!G.engineAllowed(id, i)) return;
        var en = D.ENGINES[id];
        var o = document.createElement('option');
        o.value = id;
        o.textContent = en.name + '  (ve ' + D.fmtSpeed(G.engineVe(id)) + ', ' + D.fmt(en.thrust / 1000) + ' kN)';
        if (id === s.engine) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { G.setStageEngine(i, sel.value); refresh(); };
      card.appendChild(sel);

      card.appendChild(stepper('engines ×', s.count, 1, maxE, function (v) { G.setStageField(i, 'count', v); refresh(); }));
      card.appendChild(stepper('fuel tanks', s.tanks, 0, maxT, function (v) { G.setStageField(i, 'tanks', v); refresh(); }));
      box.appendChild(card);
    });

    var add = $('add-stage');
    add.classList.toggle('hidden', design.stages.length >= G.maxStages());
  }

  // [−] n/max [+] [max] — shift-click ±5
  function stepper(label, val, min, max, onset) {
    var w = el('div', 'stepper');
    w.appendChild(el('span', 'steplabel', txt(label)));
    var minus = el('button', 'ghost tiny', '−');
    var num = el('b', '', val + '<span class="stepmax">/' + max + '</span>');
    var plus = el('button', 'ghost tiny', '+');
    var mx = el('button', 'ghost tiny maxbtn', 'max');
    minus.title = 'shift-click: −5';
    plus.title = 'shift-click: +5';
    mx.title = 'Set to the maximum (' + max + ')';
    minus.disabled = val <= min;
    plus.disabled = mx.disabled = val >= max;
    minus.onclick = function (ev) { onset(Math.max(min, val - (ev.shiftKey ? 5 : 1))); };
    plus.onclick = function (ev) { onset(Math.min(max, val + (ev.shiftKey ? 5 : 1))); };
    mx.onclick = function () { onset('max'); };
    w.appendChild(minus); w.appendChild(num); w.appendChild(plus); w.appendChild(mx);
    return w;
  }

  function renderDesignStats() {
    var box = $('design-stats');
    var r = G.resolveDesign();
    var html = '';
    if (r.ascent.length && !r.invalid) {
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
      html += '<div class="hint">Payload ' + r.probe + ' kg · liftoff mass ' + (r.stats.liftoffMass / 1000).toFixed(2) +
        ' t · hardware <b>$' + D.fmt(G.launchCost()) + '</b>/launch' +
        (G.state.research.reuse ? ' (stage 1 recovered)' : '') + '</div>';
      if (r.stats.liftoffTwr < 1.02) {
        html += '<div class="bad">TWR &lt; 1 — this will sit on the pad and burn until it’s light enough.</div>';
      } else if (r.stats.liftoffTwr > 2.6 && G.state.bestAlt < 200e3) {
        html += '<div class="hint">TWR ' + r.stats.liftoffTwr.toFixed(1) +
          ' — thick air punishes speed (drag ∝ v²). Fewer engines or more tanks usually flies higher.</div>';
      }
      if (r.spaceDv > 0) {
        html += '<div class="good">Orbital tug Δv: ' + D.fmtSpeed(r.spaceDv) +
          ' <span class="hint">(counts for ion-friendly missions only)</span></div>';
      }
    } else {
      html = '<div class="bad">' + txt(r.invalid || 'No atmosphere-capable engines.') + '</div>';
    }
    box.innerHTML = html;
  }

  function renderLaunchButton() {
    var b = $('launch-btn');
    var why = G.launchBlocker();
    var cost = G.launchCost();
    b.disabled = !!why;
    b.textContent = G.flight ? 'IN FLIGHT…' : 'LAUNCH 🚀' + (cost ? ' — $' + D.fmt(cost) : '');
    $('launch-why').textContent = G.flight ? '' : why;
    $('launch-why').classList.toggle('hidden', !why || !!G.flight);
  }

  function renderCrew() {
    var st = G.state, box = $('crew-box');
    var ta = G.autoTurnaround();
    box.classList.toggle('hidden', !ta);
    if (!ta) return;
    var y = st.lastYield;
    var html = '<label class="toggle"><input type="checkbox" id="auto-launch"' + (st.autolaunch ? ' checked' : '') +
      '> <b>Ground crew</b> <span class="hint">launches every ' + ta + ' s</span></label>';
    if (y) {
      var n = G.autoNet();
      html += '<div class="hint">Crew job: <b>' + txt(y.name || 'last free flight') + '</b> — ' +
        (y.maxAlt ? D.fmtDist(y.maxAlt) + (y.orbit ? ', orbit' : '') + ' · ' : '') +
        'net <b class="' + (n.funds >= 0 ? 'good' : 'bad') + '">' + (n.funds >= 0 ? '+$' : '−$') + D.fmt(Math.abs(n.funds)) +
        '</b>/launch (≈ $' + D.fmt(Math.max(0, n.funds) / ta) + '/s)</div>' +
        '<label class="toggle hint"><input type="checkbox" id="crew-lock"' + (st.crewLock ? ' checked' : '') +
        '> 📌 pin this job (test flights won’t replace it)</label>';
    } else {
      html += '<div class="hint">Fly a free flight and the crew will keep re-flying it.</div>';
    }
    box.innerHTML = html;
    $('auto-launch').onchange = function () { st.autolaunch = this.checked; refresh(); };
    var lk = $('crew-lock');
    if (lk) lk.onchange = function () { st.crewLock = this.checked; };
  }

  function renderStructureShop() {
    var box = $('structure-shop');
    box.innerHTML = '';
    Object.keys(D.STRUCTURE).forEach(function (key) {
      if (key === 'constellation' && !G.state.gotOrbit) return;
      var spec = D.STRUCTURE[key];
      var owned = G.state.structure[key];
      var cur = key === 'constellation' ? G.satCap() : key === 'tanks' ? G.maxTanks() : spec.start + owned;
      var maxed = G.structureMaxed(key);
      var cost = D.structureCost(spec, owned);
      var row = el('div', 'shoprow');
      var b = el('button', 'shopitem' + (maxed || G.state.funds < cost ? ' locked' : ''));
      var capNote = key === 'tanks' && maxed && G.tankCap() < D.HEAVY_TANKS.heavy3 ? ' — heavy-lift research raises the cap' : '';
      b.innerHTML = '<b>' + txt(spec.name) + '</b> <span>' + txt(spec.desc) + '</span>' +
        '<em>' + (maxed ? 'MAX (' + cur + ')' + capNote : 'now ' + cur + ' — $' + D.fmt(cost)) + '</em>';
      b.disabled = maxed;
      b.onclick = function () { if (G.buyStructure(key)) refresh(); };
      row.appendChild(b);
      var mb = el('button', 'ghost tiny maxbtn', 'max');
      mb.title = 'Buy as many as you can afford';
      mb.disabled = maxed || G.state.funds < cost;
      mb.onclick = function () { var n = G.buyStructureMax(key); if (n) { toast('Bought ' + n + '× ' + spec.name + '.', 'good'); refresh(); } };
      row.appendChild(mb);
      box.appendChild(row);
    });
    // where engines come from now
    var next = D.RESEARCH.filter(function (r) {
      return /^eng/.test(r.id) && !G.state.research[r.id] && G.researchPrereqsMet(r);
    })[0];
    $('engine-hint').innerHTML = next
      ? 'Next engine: <b>' + txt(next.name) + '</b> — in R&amp;D (' + costText(G.researchCost(next)) + ')' +
        (G.researchGate(next) ? ', after you ' + txt(G.researchGate(next)) : '') + '.'
      : '';
  }

  function renderLastFlight() {
    var box = $('last-flight');
    var res = G.lastResult;
    if (!res) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var s = STATUS_LINE[res.status] || ['Flight over', ''];
    var extra = res.mission ? ' · 🛰 departed for ' + txt(G.missionById(res.mission.id).name)
      : res.contract ? ' · ✓ contract' : res.satDeployed ? ' · 🛰 satellite deployed' : '';
    box.innerHTML = '<b>Last flight: ' + txt(s[0]) + extra + '</b>' +
      '<span>' + D.fmtDist(res.maxAlt) + ' · ' + D.fmtSpeed(res.maxSpeed) + ' · ' + D.fmtTime(res.t) +
      ' · payload ' + res.payload + ' kg</span>' +
      '<em>+$' + D.fmt(res.funds) + (res.cost ? ' (hardware −$' + D.fmt(res.cost) + ')' : '') +
      (res.sci >= 1 ? ' · +' + D.fmt(res.sci) + '⚗' : '') +
      (res.budget ? ' · Δv left in orbit ' + D.fmtSpeed(res.budget) : '') + '</em>' +
      (res.missionWhy ? '<span class="bad">' + txt(res.missionWhy) + '</span>' : '');
  }

  // ---- R&D ------------------------------------------------------------------

  function renderResearch() {
    var box = $('research-list');
    box.innerHTML = '';
    var st = G.state;
    // funds -> science, so money stays relevant while research is the wall
    if (st.bestAlt >= 5e3 || st.sci > 0) {
      var n = st.outsourced;
      var oc = D.outsourceCost(n), os = Math.round(D.outsourceSci(n) * G.globalMult());
      var ob = el('button', 'shopitem' + (st.funds < oc ? ' locked' : ''));
      ob.innerHTML = '<b>Outsource a study</b>' +
        '<span>Pay a university to do the science for you. Repeatable; each one costs more.</span>' +
        '<em>−$' + D.fmt(oc) + ' → +' + D.fmt(os) + '⚗</em>';
      ob.onclick = function () { if (G.buyOutsource()) refresh(); };
      box.appendChild(ob);
    }
    var shown = 0;
    D.RESEARCH.forEach(function (r) {
      if (st.research[r.id]) return;
      // hide entries whose research prerequisites are unmet (keeps the tree
      // tidy); altitude/orbit/mission gates show as visible locks with goals
      if (!G.researchPrereqsMet(r)) return;
      var gate = G.researchGate(r);
      // far-future gates stay hidden until you're in the right phase
      if (r.requiresStar && G.phase() < 3) return;
      if (r.requiresMission && !st.gotOrbit) return;
      var c = G.researchCost(r);
      var afford = st.funds >= c.funds && st.sci >= c.sci;
      var b = el('button', 'shopitem' + (gate || !afford ? ' locked' : ''));
      b.innerHTML = '<b>' + (gate ? '🔒 ' : '') + txt(r.name) + '</b> <span>' + txt(r.desc) + '</span>' +
        '<em>' + (gate ? 'to unlock: ' + txt(gate) + ' · ' : '') + costText(c) + '</em>';
      b.disabled = !!gate;
      b.onclick = function () {
        if (G.buyResearch(r.id)) {
          var e = Object.keys(D.ENGINES).filter(function (k) { return D.ENGINES[k].research === r.id; })[0];
          var hint = { stage2: ' Use “+ add stage” in the Rocket tab.',
                       stage3: ' Use “+ add stage” in the Rocket tab.',
                       stage4: ' Use “+ add stage” in the Rocket tab.',
                       guidance: ' Toggle + sliders are in the Rocket tab.',
                       crew1: ' The crew re-flies your latest free flight — see under LAUNCH.',
                       dispatch: ' Tick “auto” on a mission in the Missions tab.',
                       warp1: ' Faster sim speeds are on the warp bar during flights.' }[r.id] ||
                     (e ? ' Pick it in a stage’s engine list.' : '');
          if (e && G.state.design.stages.length === 1 && G.engineAllowed(e, 0)) {
            G.state.design.stages[0].engine = e;
            hint = ' Fitted to Stage 1.';
          }
          toast('Researched: ' + r.name + '.' + hint, 'good');
          refresh();
        }
      };
      box.appendChild(b);
      shown++;
    });
    if (!shown) box.appendChild(el('p', 'hint', 'Nothing left to research right now. Amog salutes you.'));
  }

  // ---- Contracts --------------------------------------------------------------

  function renderContracts() {
    var st = G.state, box = $('contract-list');
    box.innerHTML = '';
    $('contract-next').textContent = st.contracts.length >= D.CONTRACTS.board
      ? 'Board full — finish or decline one to make room.'
      : 'Next offer in ' + clock(st.nextContractAt - st.clock) + '.';
    if (!st.contracts.length) {
      box.appendChild(el('p', 'hint', 'No offers right now. Clients call every minute or so.'));
      return;
    }
    st.contracts.forEach(function (c) {
      var active = st.objective && st.objective.kind === 'contract' && st.objective.id === c.id;
      var card = el('div', 'card' + (active ? ' active' : ''));
      var mult = G.globalMult();
      card.innerHTML = '<b>' + (c.stretch ? '⭐ ' : '') + txt(G.contractText(c)) + '</b>' +
        '<span class="hint">for ' + txt(c.client) + ' · expires in ' + clock(c.expires - st.clock) +
        (c.stretch ? ' · a stretch goal' : '') + '</span>' +
        '<em>+$' + D.fmt(c.funds * mult) + (c.sci ? ' +' + D.fmt(c.sci * mult) + '⚗' : '') + '</em>';
      var row = el('div', 'btnrow');
      var go = el('button', 'tiny', active ? 'selected ✓' : 'Accept → set as objective');
      go.disabled = active;
      go.onclick = function () { G.setObjective({ kind: 'contract', id: c.id }); switchTab('rocket'); };
      var no = el('button', 'ghost tiny', 'Decline');
      no.onclick = function () { G.declineContract(c.id); refresh(); };
      row.appendChild(go); row.appendChild(no);
      card.appendChild(row);
      box.appendChild(card);
    });
  }

  // ---- Missions -------------------------------------------------------------

  function renderMissions() {
    var st = G.state;
    var slots = G.missionSlots();
    $('budget-box').innerHTML =
      '<div class="budget">Mission slots: <b>' + st.missions.length + ' / ' + slots + '</b> in flight' +
      '<div class="hint">Two ways to send a probe: set a mission as the <b>flight objective</b> and fly a rocket to orbit with enough Δv left, ' +
      'or <b>dispatch</b> a proven vehicle (any design that has reached orbit with that payload) without watching.' +
      (st.research.slingshot ? ' <b class="good">Gravity assists available.</b>' : '') +
      (st.research.aerobrake ? ' <b class="good">Aerobraking applied.</b>' : '') + '</div></div>';

    var box = $('active-mission');
    box.innerHTML = '';
    st.missions.forEach(function (am) {
      var m = G.missionById(am.id);
      var elapsed = st.clock - am.t0;
      var f = Math.max(0, Math.min(1, elapsed / am.dur));
      var row = el('div', 'mission-active');
      row.innerHTML = '<b>' + txt(m ? m.name : am.id) + '</b>' + (am.traj === 'assist' ? ' <span class="chip">assist</span>' : '') +
        (am.ion ? ' <span class="chip">ion</span>' : '') +
        ' <span class="hint">' + D.fmtTime(Math.max(0, am.dur - elapsed)) + ' to go</span>' +
        '<div class="bar"><i style="width:' + (f * 100).toFixed(1) + '%"></i></div>';
      box.appendChild(row);
    });

    var list = $('mission-list');
    list.innerHTML = '';
    D.MISSIONS.forEach(function (m) {
      if (!G.missionVisible(m)) return;
      var done = st.missionsDone[m.id] || 0;
      var auto = st.autoMissions[m.id];
      var traj = auto || (G.canAssist(m) ? 'assist' : 'direct');
      if (missionTraj[m.id]) traj = missionTraj[m.id];
      if (traj === 'assist' && !G.canAssist(m)) traj = 'direct';
      var need = G.missionNeed(m, traj);
      var rw = G.missionReward(m);
      var mult = G.globalMult();
      var plan = G.dispatchPlan(m, traj);
      var card = el('div', 'card mission' + (done ? ' done' : ''));
      card.innerHTML = '<b>' + txt(m.name) + (done ? ' ✓' + (done > 1 ? '×' + done : '') : '') + '</b>' +
        '<span>Δv <b>' + D.fmtSpeed(need) + '</b> beyond LEO · payload <b>' + m.payload + ' kg</b> · ~' +
        D.fmtTime(m.time * (traj === 'assist' ? 1.6 : 1)) + ' trip' +
        (m.ionOk ? ' · ion OK' : '') + (m.descent ? ' · 🕹 manual landing (soft = ×1.5)' : '') +
        (m.assistDv && !G.canAssist(m) ? ' · with assists: ' + D.fmtSpeed(m.assistDv) : '') +
        (m.aeroDv && !st.research.aerobrake ? ' · aerobraking would help' : '') + '</span>' +
        (m.window ? '<span>' + windowText(m) + '</span>' : '') +
        (m.note ? '<span class="hint">' + txt(m.note) + '</span>' : '') +
        '<em>' + (rw.first ? 'first: ' : 'repeat: ') + '+$' + D.fmt(rw.funds * mult) + ' +' + D.fmt(rw.sci * mult) + '⚗' +
        (G.missionOps(m) ? ' · ops −$' + D.fmt(G.missionOps(m)) : '') + '</em>';
      var row = el('div', 'btnrow');
      var planB = el('button', 'ghost tiny', 'Plan flight');
      planB.title = 'Set as the flight objective and go to the Rocket tab';
      planB.onclick = function () { G.setObjective({ kind: 'mission', id: m.id, traj: traj }); switchTab('rocket'); };
      row.appendChild(planB);
      var disp = el('button', 'tiny', plan.vehicle ? 'Dispatch — $' + D.fmt(plan.cost) : 'Dispatch');
      disp.disabled = !plan.vehicle || !!plan.why;
      disp.title = plan.vehicle ? 'Re-fly “' + plan.vehicle.name + '” (' + plan.vehicle.payload + ' kg, ' +
        D.fmtSpeed(plan.vehicle.budget) + ' in orbit)' : '';
      disp.onclick = function () {
        var am = G.dispatch(m.id, traj, true);
        if (am) { toast('Dispatched: ' + m.name + ' — ETA ' + D.fmtTime(am.dur), 'good'); refresh(); }
      };
      row.appendChild(disp);
      if (G.canAssist(m)) {
        var tb = el('button', 'ghost tiny', traj === 'assist' ? 'via assist ⇄' : 'direct ⇄');
        tb.title = 'Toggle trajectory: direct (more Δv, faster) or gravity assist (less Δv, 60% longer)';
        tb.onclick = function () {
          missionTraj[m.id] = traj === 'assist' ? 'direct' : 'assist';
          if (st.autoMissions[m.id]) G.setAutoMission(m.id, true, missionTraj[m.id]);
          refresh();
        };
        row.appendChild(tb);
      }
      if (st.research.dispatch) {
        var lab = el('label', 'toggle tiny', '<input type="checkbox"' + (auto ? ' checked' : '') + '> auto');
        lab.title = 'Re-dispatch automatically when a slot is free, the window is open and you can pay';
        lab.querySelector('input').onchange = function () { G.setAutoMission(m.id, this.checked, traj); refresh(); };
        row.appendChild(lab);
      }
      card.appendChild(row);
      if (plan.why) card.appendChild(el('span', 'hint why', txt(plan.why)));
      list.appendChild(card);
    });

    // fleet
    var fl = $('fleet-list');
    fl.innerHTML = '';
    if (!st.vehicles.length) {
      fl.appendChild(el('p', 'hint', 'Nothing yet. Any rocket that reaches orbit is recorded here with its payload and leftover Δv.'));
    }
    st.vehicles.forEach(function (v) {
      var row = el('div', 'fleetrow');
      row.innerHTML = '<span><b>' + txt(v.name) + '</b><br><span class="hint">' + v.payload + ' kg · ' +
        D.fmtSpeed(v.budget) + ' left in orbit' + (v.ionDv ? ' + ' + D.fmtSpeed(v.ionDv) + ' ion' : '') +
        ' · $' + D.fmt(G.designCost(v)) + '/launch</span></span>';
      var load = el('button', 'ghost tiny', 'load');
      load.title = 'Load this design into the builder';
      load.onclick = function () {
        G.state.design = { stages: JSON.parse(JSON.stringify(v.stages)), guidanceOn: v.guidanceOn,
          turnStart: v.turnStart || 1000, turnEnd: v.turnEnd || 30000 };
        G.clampDesign();
        switchTab('rocket');
      };
      var rm = el('button', 'ghost tiny', '✕');
      rm.title = 'Scrap this vehicle';
      rm.onclick = function () { G.removeVehicle(v.key); };
      var btns = el('span', 'btnrow'); btns.appendChild(load); btns.appendChild(rm);
      row.appendChild(btns);
      fl.appendChild(row);
    });
  }
  var missionTraj = {};

  // ---- Manual descent minigame ----------------------------------------------
  // The suicide burn, playable: gravity pulls you down, you have one engine,
  // limited Δv, and the optimal strategy is to brake as late as you dare.

  var descentActive = false;

  function offerDescent(m, uid) {
    G.missionHold = true;
    queueModal(
      '<h2>🕹 MANUAL DESCENT — ' + txt(m.descent.body) + '</h2>' +
      '<p>The transfer stage has done its job. The last few kilometers are yours: ' +
      'gravity pulls at ' + m.descent.g.toFixed(2) + ' m/s², and the most efficient landing ' +
      'is a <b>suicide burn</b> — brake as late as you dare.</p>' +
      '<p class="hint">Touch down under 5 m/s → rewards ×1.5. Under 15 m/s → ×1. ' +
      'Faster than that → the probe becomes a crater (×0.5).</p>' +
      '<button id="descent-fly">Fly it yourself 🕹</button> ' +
      '<button id="descent-skip" class="ghost">Auto-land (×1)</button>', function () {
        $('descent-fly').onclick = function () { runDescent(m, uid); };
        $('descent-skip').onclick = function () { G.missionHold = false; closeModal(); };
      });
  }

  function runDescent(m, uid) {
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
      G.setDescentResult(uid, mult);
      G.missionHold = false;
      openModal('<h2>' + (mult > 1 ? '🏆 ' : mult < 1 ? '💥 ' : '') + 'Touchdown report</h2>' +
        '<p>' + txt(text) + '</p><button id="modal-close">Continue</button>');
    }
  }

  // ---- Stars ----------------------------------------------------------------

  var shipSel = { engine: 'sail', ratio: 20, mode: 'flyby', star: 'heliopause' };

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
      (shipSel.mode === 'colonize' ? ' checked' : '') + '> colonize <span class="hint">(burn half the Δv slowing down; 3× the cost)</span></label></div>';
    html += '<select id="ship-star">';
    D.STARS.forEach(function (s) {
      if (s.intergalactic && !G.colonyCount()) return;
      var visits = st.flybys[s.id] || 0;
      html += '<option value="' + s.id + '"' + (shipSel.star === s.id ? ' selected' : '') + '>' +
        txt(s.name) + ' — ' + (s.ly >= 1000 ? D.fmt(s.ly) : s.ly < 0.1 ? (s.ly * 63241).toFixed(0) + ' AU' : s.ly) +
        (s.ly < 0.1 ? '' : ' ly') +
        (st.colonies[s.id] ? ' (colonized)' : visits ? ' (visited' + (visits > 1 ? ' ×' + visits : '') + ')' : '') + '</option>';
    });
    html += '</select>';

    var cruise = G.shipCruise(shipSel.engine, shipSel.ratio, shipSel.mode);
    var star = G.starById(shipSel.star);
    var cost = G.shipCost(shipSel.engine, shipSel.ratio, shipSel.mode);
    if (star && cruise > 0) {
      var years = star.ly / cruise;
      var gamma = 1 / Math.sqrt(1 - cruise * cruise);
      html += '<div class="total">cruise <b>' + cruise.toFixed(3) + 'c</b> → ' + txt(star.name) + ' in <b>' +
        D.fmtYears(years) + '</b> <span class="hint">(' + D.fmtTime(years / G.warpRate()) + ' real time)</span>' +
        (gamma > 1.05 ? ' <span class="hint">(crew experiences ' + D.fmtYears(years / gamma) + ' — relativity!)</span>' : '') +
        '</div>';
      var rw = G.starReward(star, shipSel.mode);
      html += '<div class="hint">On arrival: ' + (rw.colony ? '<b class="good">COLONY</b> (all income ×2) + ' : '') +
        (rw.funds ? '$' + D.fmt(rw.funds) + ' + ' : '<span class="bad">no funds (already photographed)</span> + ') +
        D.fmt(rw.sci) + '⚗' + (star.note ? ' — ' + txt(star.note) : '') + '</div>';
    }
    var why = G.shipBlocker(shipSel.engine, shipSel.ratio, shipSel.mode, shipSel.star);
    if (why) html += '<div class="bad">' + txt(why) + '</div>';
    html += '<button id="ship-launch"' + (why ? ' disabled' : '') + '>Launch starship — $' + D.fmt(cost) + '</button>';
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
    $('ships-head').textContent = 'In flight (' + st.ships.length + ' / ' + G.shipSlots() + ' shipyard slots)';
    var sl = $('ship-list');
    sl.innerHTML = st.ships.length ? '' : '<p class="hint">No ships in flight.</p>';
    st.ships.forEach(function (s) {
      var star2 = G.starById(s.star);
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
      ? '<p>' + names.map(txt).join(' · ') + '</p><p class="hint">Each colony doubles all income and sends home $' +
        D.fmt(D.COLONY.fundsRate) + '/s and ' + D.fmt(D.COLONY.sciRate) + '⚗/s (before the doubling).</p>'
      : '<p class="hint">None yet. Send a colony ship (it must be able to slow down). Repeat flybys only pay a little science.</p>';
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
      ' · Best speed: ' + D.fmtSpeed(st.bestSpeed) + ' · Played: ' + D.fmtTime(st.timePlayed) +
      ' · Colonies: ' + G.colonyCount();
  }

  // ---- HUD ------------------------------------------------------------------

  var warpSig = '';
  function renderWarpButtons() {
    var opts = G.warpOptions();
    var sig = opts.join(',');
    if (sig === warpSig) return;
    warpSig = sig;
    var box = $('warp-buttons');
    box.innerHTML = '';
    opts.forEach(function (x) {
      var b = el('button', '', x + '×');
      b.dataset.warp = x;
      b.onclick = function () { G.setWarp(x); G.warpTouched = true; };
      box.appendChild(b);
    });
    var next = D.WARPS.filter(function (w) { return w.research && !G.state.research[w.research]; })[0];
    $('warp-more').classList.toggle('hidden', !next);
    if (next) $('warp-more').title = 'Faster sim speeds come from Flight computer research';
  }

  function updateHud() {
    var f = G.flight;
    var flying = !!f;
    $('hud').classList.toggle('hidden', !flying);
    $('warpbar').classList.toggle('hidden', !flying);
    $('idle-hint').classList.toggle('hidden', flying || G.state.totalLaunches > 0);
    if (flying) renderWarpButtons();
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
    var meta = G.flightMeta, obj = '';
    if (meta && meta.objective) {
      if (meta.objective.kind === 'mission') {
        var m = G.missionById(meta.objective.id);
        if (m) obj = '🎯 ' + m.name + ': need ' + D.fmtSpeed(G.missionNeed(m, meta.objective.traj)) + ' left in orbit';
      } else {
        var c = G.state.contracts.filter(function (x) { return x.id === meta.objective.id; })[0];
        if (c) obj = '🎯 ' + G.contractText(c);
      }
    }
    $('hud-obj').textContent = obj;
  }

  // ---- Results --------------------------------------------------------------

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
      (res.cost ? '<tr><td>Hardware</td><td>−$' + D.fmt(res.cost) + '</td></tr>' : '') +
      (res.budget ? '<tr><td>Δv left in orbit</td><td>' + D.fmtSpeed(res.budget) + '</td></tr>' : '') +
      '</table>';
    if (res.satDeployed) html += '<p class="good">🛰 Satellite deployed — passive income increased.</p>';
    res.milestones.forEach(function (m) {
      html += '<div class="milestone"><b>' + txt(m.name) + '</b> — ' + txt(m.note || '') +
        ' <em>+$' + D.fmt(m.funds * G.globalMult()) + (m.sci ? ' +' + D.fmt(m.sci * G.globalMult()) + '⚗' : '') + '</em></div>';
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

  function showMigration() {
    var st = G.state;
    if (!st.migratedFrom || st.migrationShown) return;
    st.migrationShown = true;
    G.save();
    queueModal(
      '<h2>🛠 Amog Space Program 2.0</h2>' +
      '<p>The space program got an overhaul, and your save came along. What changed:</p>' +
      '<ul class="changes">' +
      '<li><b>Research unlocks engines directly</b> — no second purchase. Engines you owned are researched.</li>' +
      '<li><b>Launches cost hardware</b>, and the <b>ground crew</b> re-flies your latest free flight back to back.</li>' +
      '<li><b>Contracts</b>: rotating jobs with their own payloads and targets.</li>' +
      '<li><b>Missions are flown</b>: set one as the flight objective and reach orbit with enough Δv to spare, or dispatch a proven vehicle. ' +
      'Several at once (Deep Space Network), launch windows, gravity assists, aerobraking, auto-dispatch.</li>' +
      '<li><b>Sim speed</b> up to 16× from the start; faster speeds are research.</li>' +
      '<li><b>Interstellar</b>: shipyard slots, precursor targets, and repeat flybys no longer print money.</li>' +
      '</ul>' +
      '<p class="hint">Missions you finished stay finished. Some numbers moved, so your old rocket may need a rethink — that’s the fun part.</p>' +
      '<button id="modal-close">Let’s fly</button>');
  }

  var modalQueue = [];
  function openModal(html, after) {
    $('modal').innerHTML = html;
    $('modal-back').classList.remove('hidden');
    var c = $('modal-close');
    if (c) c.onclick = closeModal;
    if (after) after();
  }
  // async modals (flight results, win screen) wait instead of clobbering
  // whatever dialog the player has open
  function queueModal(html, after) {
    if (!$('modal-back').classList.contains('hidden')) { modalQueue.push([html, after]); return; }
    openModal(html, after);
  }
  function closeModal() {
    if (modalQueue.length) { var q = modalQueue.shift(); openModal(q[0], q[1]); return; }
    $('modal-back').classList.add('hidden');
    refresh();
  }

  function toast(text, kind) {
    var t = el('div', 'toast ' + (kind || ''), txt(text));
    $('toasts').appendChild(t);
    while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
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
    var ledger = Object.keys(G.ledger).map(function (k) {
      return k + ' $' + D.fmt(G.ledger[k].funds) + '/' + D.fmt(G.ledger[k].sci) + '⚗';
    }).join(', ');
    var body = [
      '**What felt off?** (too grindy / too easy / confusing / a bug — anything!)',
      '',
      '…write here…',
      '',
      '---',
      '_Auto-attached game state (edit or delete freely):_',
      '- v' + G.SAVE_VERSION + (st.migratedFrom ? ' (migrated from v' + st.migratedFrom + ')' : '') +
        ' · Phase ' + G.phase() + ' · ' + D.fmtTime(st.timePlayed) + ' played · ' + st.totalLaunches + ' launches',
      '- Best altitude ' + D.fmtDist(st.bestAlt) + ' · best speed ' + D.fmtSpeed(st.bestSpeed) +
        ' · $' + D.fmt(st.funds) + ' · ' + D.fmt(st.sci) + '⚗ · sats ' + st.sats + '/' + G.satCap(),
      '- Caps: ' + G.maxTanks() + ' tanks, ' + G.maxEngines() + ' engines, ' + G.maxStages() + ' stages, ' +
        G.maxWarp() + '× sim · income $' + D.fmt(G.incomeRates().funds) + '/s',
      '- Research (' + research.length + '): ' + (research.join(', ') || 'none'),
      '- Missions: ' + (missions.join(', ') || 'none') + ' · fleet ' + st.vehicles.length + ' vehicles',
      '- Colonies: ' + (Object.keys(st.colonies).join(', ') || 'none'),
      '- Design: ' + design + ' · guidance ' + (st.design.guidanceOn
        ? 'on (' + D.fmtDist(st.design.turnStart) + '→' + D.fmtDist(st.design.turnEnd) + ')' : 'off'),
      '- This session: ' + (ledger || 'nothing yet')
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
    var sciHidden = st.sci < 1 && !Object.keys(st.research).some(function (k) {
      var r = G.researchById(k); return r && r.cost && r.cost.sci;
    }) && st.bestAlt < 5e3;
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

    $('tab-rnd').classList.toggle('hidden', st.totalLaunches < 1);
    $('tab-contracts').classList.toggle('hidden', !st.contracts.length && st.contractSeq < 1);
    $('tab-contracts').textContent = 'Jobs' + (st.contracts.length ? ' (' + st.contracts.length + ')' : '');
    $('tab-missions').classList.toggle('hidden', !st.gotOrbit);
    $('tab-missions').textContent = 'Missions' + (st.missions.length ? ' (' + st.missions.length + ')' : '');
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
    renderLaunchButton();

    if (currentTab === 'rocket') {
      renderObjective(); renderStages(); renderDesignStats(); renderCrew();
      renderStructureShop(); renderLastFlight();
    } else if (currentTab === 'rnd') renderResearch();
    else if (currentTab === 'contracts') renderContracts();
    else if (currentTab === 'missions') renderMissions();
    else if (currentTab === 'stars') renderStars();
    else if (currentTab === 'log') renderLog();
  }

  // ---- Init -----------------------------------------------------------------

  function abortFlight() {
    var f = G.flight;
    if (!f) return;
    // abort = stop NOW, score only what has actually been flown
    if (f.status === 'flying') f.status = 'aborted';
    G.endFlight();
  }

  function stepWarp(dir) {
    var o = G.warpOptions(), i = o.indexOf(G.warp);
    if (i < 0) i = 0;
    i = Math.max(0, Math.min(o.length - 1, i + dir));
    G.setWarp(o[i]); G.warpTouched = true;
  }

  function init() {
    document.querySelectorAll('#tabs .tab').forEach(function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });
    $('launch-btn').onclick = function () {
      if (G.launch(true)) refresh();
    };
    $('add-stage').onclick = function () {
      if (G.addStage()) refresh();
    };
    $('guidance-on').onchange = function () {
      G.state.design.guidanceOn = $('guidance-on').checked;
      refresh();
    };
    // keyboard: Space/Enter = launch (or dismiss modal), E = abort, , . = warp
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
        abortFlight();
      } else if (ev.key === '.' || ev.key === '>') {
        if (G.flight) stepWarp(1);
      } else if (ev.key === ',' || ev.key === '<') {
        if (G.flight) stepWarp(-1);
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
    $('end-flight').onclick = abortFlight;
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
        if (G.importSave($('save-text').value)) { closeModal(); toast('Save imported.', 'good'); showMigration(); }
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
      if (res.contract) toast('Contract complete: ' + G.contractText(res.contract), 'good');
      if (res.mission) {
        var mm = G.missionById(res.mission.id);
        toast('🛰 ' + (mm ? mm.name : 'Mission') + ' — probe departed! ETA ' + D.fmtTime(res.mission.dur), 'good');
      }
      if (res.missionWhy) toast(res.missionWhy + ' The payload stays in orbit' + (res.satDeployed ? ' as a satellite.' : '.'), 'warn');
      refresh();
    });
    G.on('missionStart', function (e) {
      if (e.active.manual && e.mission.descent) offerDescent(e.mission, e.active.uid);
    });
    G.on('change', function () { if (!document.hidden) refresh(); });
    G.on('log', function () { if (currentTab === 'log') renderLog(); });
    G.on('won', showWin);
    G.on('missionDone', function (e) { toast((e.first ? 'MISSION COMPLETE: ' : 'Repeat mission done: ') + e.mission.name, 'good'); });
    G.on('contract', function (c) { if (G.state.contracts.length === 1 && G.state.contractSeq <= 1) toast('New job offer! See the Jobs tab.', 'good'); });

    refresh();
    showMigration();
  }

  root.ASP.ui = { init: init, refresh: refresh, updateHud: updateHud, toast: toast, showWin: showWin, announce: announce };
})(typeof window !== 'undefined' ? window : globalThis);
