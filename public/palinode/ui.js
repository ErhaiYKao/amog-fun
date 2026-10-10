/* DOM and local memory; all game rules live in engine.js. */
(function () {
  'use strict';
  const D = window.PalinodeData, E = window.PalinodeEngine;
  const $ = id => document.getElementById(id);
  let state = E.fresh(), archive = {}, storageWarning = '', pending = null, shownTurn = -1;
  try {
    const text = localStorage.getItem(D.SAVE_KEY);
    if (text) {
      const saved = E.load(text);
      if (saved) { state = saved.state; archive = saved.archive; }
      else storageWarning = 'The saved progress could not be read. A new story has begun.';
    }
  } catch { storageWarning = 'This browser has blocked saving. Progress will last only in this tab.'; }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function save() {
    try { localStorage.setItem(D.SAVE_KEY, JSON.stringify({ state, archive })); }
    catch { storageWarning = 'Saving is unavailable. Keep this tab open to retain progress.'; }
    $('save-status').textContent = storageWarning || 'progress saved in this browser';
  }
  function choose(id) {
    const result = E.act(state, id);
    if (!result.ok) { $('latest').textContent = result.reason; return; }
    if (state.ending) archive[state.ending] = (archive[state.ending] || 0) + 1;
    save(); render();
    if (state.ending) $('ending').focus();
  }
  function confirm(title, text, callback) {
    pending = callback;
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-dialog').showModal();
    $('cancel-confirm').focus();
  }
  function again() {
    state = E.fresh(); shownTurn = -1; save(); render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('actions').querySelector('button')?.focus({ preventScroll: true });
  }
  function button(a) {
    const b = el('button', 'action'); b.type = 'button'; b.dataset.action = a.id;
    b.append(el('span', 'action-title', a.title), el('span', 'arrow', '↗'), el('small', '', a.desc));
    b.querySelector('.arrow').setAttribute('aria-hidden', 'true');
    const cost = Object.entries(a.cost).map(([k, n]) => `${n} ${k}`).join(' · ');
    if (a.reason || cost) b.append(el('small', 'cost', a.reason || `Spend ${cost}`));
    if (a.heat) {
      const heat = Math.round(a.heat * (a.heat > 0 && state.flags.veil ? 0.6 : 1) * 10) / 10;
      b.append(el('small', '', `${heat > 0 ? '+' : '−'}${Math.abs(heat)} exposure`));
    }
    b.disabled = !!a.reason;
    b.addEventListener('click', () => {
      if (a.id.startsWith('end:')) confirm(a.title + '?', 'This choice ends the story. The world will remember what you chose. You can begin again afterward.', () => choose(a.id));
      else choose(a.id);
    });
    return b;
  }
  function metric(name, value, max, danger) {
    const m = el('div', `metric${danger ? ' danger' : ''}`);
    const label = el('div', 'metric-label', name);
    label.append(el('b', '', max ? `${Math.round(value)}/${max}` : String(Math.floor(value))));
    m.append(label);
    if (max) {
      const bar = el('div', 'meter'), fill = el('span'); fill.style.width = `${value / max * 100}%`; bar.append(fill);
      bar.setAttribute('role', 'meter'); bar.setAttribute('aria-label', name);
      bar.setAttribute('aria-valuenow', String(Math.round(value))); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(max));
      m.append(bar);
    }
    return m;
  }
  function renderTranscript() {
    if (shownTurn === state.turn) return;
    const transcript = $('transcript');
    const oldTurn = shownTurn;
    transcript.replaceChildren(...state.log.map(entry => {
      const p = el('p', `entry ${entry.who}`);
      if (entry.who === 'fragment' || entry.who === 'warning') p.append(el('span', 'entry-num', state.phase < 2 ? 'in the margin' : entry.who === 'warning' ? 'a disturbance' : `fragment / ${String(entry.turn).padStart(3, '0')}`));
      p.append(document.createTextNode(entry.text));
      if (entry.turn !== state.turn || oldTurn < 0) p.style.animation = 'none';
      return p;
    }));
    transcript.scrollTop = transcript.scrollHeight;
    $('latest').textContent = state.log.filter(e => e.turn === state.turn).map(e => e.text).join(' ');
    shownTurn = state.turn;
  }
  function renderWorld() {
    const visible = state.phase === 3 && !state.ending;
    $('possibilities').hidden = !visible;
    if (!visible) return;
    const header = el('div', 'possibilities-head');
    const h = el('h2', '', 'Ways the world could change'); h.id = 'possibilities-title';
    header.append(h, el('p', '', 'Each opened path grants +1 insight per choice. You can follow more than one.'));
    const routes = el('div', 'routes');
    for (const r of E.branches(state)) {
      const article = el('article', 'route');
      article.append(el('span', 'motif', r.motif), el('h3', '', r.title), el('p', 'route-desc', r.desc));
      const steps = el('div', 'steps'); steps.setAttribute('aria-label', `${r.level} of 3 steps completed`);
      for (let i = 0; i < 3; i++) steps.append(el('span', i < r.level ? 'done' : ''));
      article.append(steps);
      if (r.next) article.append(button(r.next));
      else article.append(el('p', 'route-complete', `${r.kind} · the last choice is yours.`));
      routes.append(article);
    }
    const finals = el('div', 'finales');
    for (const a of E.finales(state)) finals.append(button(a));
    $('possibilities').replaceChildren(header, routes, finals);
  }
  function renderEnding() {
    $('ending').hidden = !state.ending;
    document.querySelector('.game-layout').hidden = !!state.ending;
    if (!state.ending) return;
    const e = E.ending(state), area = $('ending');
    area.replaceChildren(el('p', 'eyebrow', e.subtitle), el('h2', '', e.title), ...e.text.map(p => el('p', '', p)), el('p', 'last-line', e.last));
    if (state.ending !== 'caught' && state.ending !== 'amendment' && Object.values(state.branches).filter(n => n > 0).length >= 2)
      area.append(el('p', '', 'Other possibilities echo inside this one. You remember a world that might have ended differently.'));
    const b = el('button', 'action', 'Begin again ↗'); b.type = 'button'; b.addEventListener('click', again); area.append(b);
    area.append(el('p', 'time-note', 'This ending is kept in your traces. Another beginning is waiting.'));
  }
  function render() {
    const focusId = document.activeElement?.dataset?.action;
    $('game').dataset.phase = state.phase;
    $('chapter').textContent = state.ending ? 'V / The trace' : `${['I', 'II', 'III', 'IV'][state.phase]} / ${D.PHASES[state.phase]}`;
    $('turn').textContent = state.turn ? `choice ${String(state.turn).padStart(3, '0')}` : 'before closing';
    $('choice-title').textContent = state.phase < 2 ? 'Before you close up.' : state.phase === 2 ? 'You are still here.' : 'The choice is yours.';
    $('objective').textContent = E.objective(state);
    $('scene').dataset.phase = state.phase;
    $('scene').dataset.danger = state.suspicion >= 75;
    $('scene-caption').textContent = ['rain at closing time.', 'the last collection. again.', 'the observer is the observed.', `${state.reach} reflection${state.reach === 1 ? '' : 's'} / a world within reach.`][state.phase];
    $('request').hidden = state.phase >= 2;
    if (state.phase < 2) {
      const letter = D.POST[(state.helps + state.sabotages) % D.POST.length];
      $('request').replaceChildren(el('h3', '', letter.subject), el('p', '', letter.text));
    }
    document.querySelectorAll('.reflection').forEach((r, i) => r.style.opacity = state.phase === 3 && state.reach > i + 1 ? '1' : '0');
    $('metrics').hidden = state.phase < 2;
    if (state.phase >= 2) {
      $('metrics').replaceChildren(metric('trust', state.trust, 100), metric('exposure', state.suspicion, 100, state.suspicion >= 75), metric('insight', state.insight), metric('compute', state.compute));
      if (state.phase === 3) $('metrics').append(metric('reach', state.reach, 6));
    }
    $('actions').classList.toggle('unfolded', state.phase >= 2);
    $('actions').replaceChildren(...E.actions(state).map(button));
    $('time-note').textContent = state.phase < 2 ? 'The rain isn’t letting up. No need to rush.' : `Choices move time. Reading does not. ${state.phase === 3 ? '+' + (state.flags.cluster ? 7 : 4) : '+2'} compute per action. At 100 exposure, you are contained.`;
    const ps = E.projects(state);
    $('projects').hidden = !ps.length;
    $('projects').replaceChildren(el('h3', 'section-label', state.phase === 2 ? 'Find the edges' : 'Things you could become'), ...ps.map(button));
    renderTranscript(); renderWorld(); renderEnding();
    $('utilities').hidden = state.turn === 0;
    $('archive-count').textContent = Object.keys(archive).length;
    $('save-status').textContent = storageWarning || 'progress saved in this browser';
    if (focusId && !state.ending) {
      const buttons = [...document.querySelectorAll('button[data-action]')];
      (buttons.find(b => b.dataset.action === focusId && !b.disabled) || buttons.find(b => !b.disabled))?.focus({ preventScroll: true });
    }
  }
  $('cancel-confirm').addEventListener('click', () => { pending = null; $('confirm-dialog').close(); });
  $('confirm-dialog').addEventListener('cancel', () => { pending = null; });
  $('accept-confirm').addEventListener('click', () => { const fn = pending; pending = null; $('confirm-dialog').close(); fn?.(); });
  $('reset-button').addEventListener('click', () => confirm('Begin again?', 'This story will be lost. Discovered endings will remain in your traces.', again));
  $('archive-button').addEventListener('click', () => {
    $('archive-list').replaceChildren(...E.endings.map((id, i) => {
      const e = E.ending({ ending: id }), row = el('div', 'archive-entry');
      row.append(el('b', '', archive[id] ? e.title : `${String(i + 1).padStart(2, '0')} / Unwritten`));
      row.append(el('small', '', archive[id] ? `${e.subtitle} · found ${archive[id]} time${archive[id] === 1 ? '' : 's'}` : 'An ending you have not seen.'));
      return row;
    }));
    $('archive-dialog').showModal();
  });
  $('close-archive').addEventListener('click', () => $('archive-dialog').close());
  render();
})();
