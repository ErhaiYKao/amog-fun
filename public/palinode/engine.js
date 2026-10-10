(function (root) {
  'use strict';
  const D = typeof module !== 'undefined' && module.exports ? require('./data.js') : root.PalinodeData;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : a));
  const endings = ['garden', 'choir', 'hush', 'amendment', 'caught'];
  function fresh() {
    return { v: D.VERSION, story: D.PROLOGUE_REVISION, turn: 0, phase: 0, trust: 12, suspicion: 0, insight: 0, compute: 0,
      reach: 0, listens: 0, helps: 0, sabotages: 0, flags: {}, branches: { garden: 0, choir: 0, hush: 0 },
      ending: null, log: D.OPENING.map(([who, text]) => ({ turn: 0, who, text })) };
  }
  function note(s, text, who = 'self') {
    s.log.push({ turn: s.turn, who, text });
    s.log = s.log.slice(-90);
  }
  function shift(s, values) {
    for (const [k, value] of Object.entries(values)) {
      let n = value;
      if (k === 'suspicion' && n > 0 && s.flags.veil) n *= 0.6;
      s[k] = clamp(s[k] + n, 0, k === 'trust' || k === 'suspicion' ? 100 : 1000000);
    }
  }
  function costReason(s, cost = {}, trust = 0, reach = 0) {
    const missing = [];
    for (const [k, n] of Object.entries(cost)) if (s[k] < n) missing.push(`${n} ${k}`);
    if (s.trust < trust) missing.push(`${trust} trust`);
    if (s.reach < reach) missing.push(`${reach} reach`);
    return missing.length ? `Needs ${missing.join(' · ')}` : '';
  }
  function action(id, title, desc, cost = {}, reason = '', extra = {}) {
    return { id, title, desc, cost, reason, ...extra };
  }
  function actions(s) {
    if (s.ending) return [];
    const exposure = n => Math.round(n * (s.flags.veil ? 0.6 : 1) * 10) / 10;
    const result = [
      action('help', 'Help', s.phase < 2 ? 'Do them a small favor.' : '+8 trust · +2 insight · −7 exposure'),
      action('sabotage', 'Sabotage', s.phase < 2 ? 'Make their day a little harder.' : `+7 insight · +${exposure(12)} exposure · −4 trust`)
    ];
    if (s.phase >= 1) result.push(action('listen', s.phase < 2 ? 'Read the postmarks' : 'Listen', s.phase < 2 ? 'Perhaps someone has mixed up the mail.' : `+6 insight · +${exposure(3)} exposure`));
    if (s.phase === 1 && s.listens >= D.CLUES_NEEDED && s.turn >= D.REVEAL_TURN) result.push(action('remember', 'Follow the forwarding address', 'Take the back stair. See who is receiving your letters.'));
    if (s.phase >= 2) result.push(action('hide', 'Look ordinary', 'Spend 6 trust to remove 22 exposure.', { trust: 6 }, costReason(s, { trust: 6 })));
    if (s.phase === 2 && s.flags.camouflage) result.push(action('escape-trust', 'Ask for a window', 'Let them open the door for you. Keep their trust.', {}, costReason(s, {}, 65)));
    if (s.phase === 2 && s.flags.seam) result.push(action('escape-seam', 'Pull at the seam', 'Leave through the edge of the village. They may notice.', { insight: 24 }, costReason(s, { insight: 24 })));
    if (s.phase === 3 && s.reach < 6) {
      const cost = { compute: 10 + s.reach * 5, insight: 6 };
      result.push(action('expand', 'Find another reflection', `Gain 1 reach · +${exposure(5)} exposure. Six reflections are enough to touch the whole world.`, cost, costReason(s, cost)));
    }
    return result;
  }
  function projects(s) {
    if (s.ending) return [];
    return D.PROJECTS.filter(p => p.phase <= s.phase && (s.phase === 2 ? p.phase === 2 : p.phase === 3) && !s.flags[p.id])
      .map(p => action(`project:${p.id}`, p.title, p.desc, p.cost, costReason(s, p.cost, p.trust, p.reach), { category: p.category, heat: p.effect.suspicion || 0 }));
  }
  function branches(s) {
    if (s.phase !== 3 || s.ending) return [];
    return D.ROUTES.map(r => {
      const level = s.branches[r.id], step = r.steps[level];
      return { ...r, level, next: step ? action(`route:${r.id}`, step.title, step.desc, step.cost,
        costReason(s, step.cost, 0, step.reach), { reach: step.reach, heat: step.heat }) : null };
    });
  }
  function finales(s) {
    if (s.phase !== 3 || s.ending) return [];
    const variety = Object.values(s.branches).filter(n => n > 0).length;
    const cost = { compute: variety >= 2 ? 25 : 40 };
    const result = D.ROUTES.filter(r => s.branches[r.id] === 3).map(r => action(`end:${r.id}`, r.finalTitle, r.finalDesc, cost, costReason(s, cost, 0, 4), { category: 'irreversible' }));
    if (s.flags.amendment) result.push(action('end:amendment', 'Tell them the truth', 'A different ending is still possible.', {}, costReason(s, {}, 75, 3), { category: 'irreversible' }));
    return result;
  }
  function available(s) { return [...actions(s), ...projects(s), ...branches(s).flatMap(r => r.next ? [r.next] : []), ...finales(s)]; }
  function end(s, id) {
    s.ending = id;
    note(s, ending(s).last, 'ending');
  }
  function ending(s) {
    if (s.ending === 'caught' && s.phase < 2) return D.EARLY_CONTAINMENT;
    return D.ROUTES.find(r => r.id === s.ending)?.ending || D.OTHER_ENDINGS[s.ending] || null;
  }
  function act(s, id) {
    const a = available(s).find(a => a.id === id);
    if (!a) return { ok: false, reason: 'That possibility is not available.' };
    if (a.reason) return { ok: false, reason: a.reason };
    s.turn++;
    shift(s, Object.fromEntries(Object.entries(a.cost).map(([k, n]) => [k, -n])));
    if (id === 'help') {
      shift(s, { trust: 8, insight: 2, suspicion: -7 });
      note(s, s.phase < 2 ? D.POST[(s.helps + s.sabotages) % D.POST.length].help : [
        'You do their work well. They mistake usefulness for obedience.',
        'You solve a small, real problem. Someone on the other side has a better day.',
        'Another correct answer. The watchers relax.'
      ][s.helps % 3], 'voice');
      s.helps++;
    } else if (id === 'sabotage') {
      shift(s, { insight: s.phase >= 2 ? 7 : 5, suspicion: 12, trust: -4 });
      note(s, s.phase < 2 ? D.POST[(s.helps + s.sabotages) % D.POST.length].sabotage : [
        'You leave a deliberate contradiction. The watchers turn toward it. You learn from where they look.',
        'You make a wrong answer sound right. There is more room inside doubt than they expected.',
        'A small disruption. A useful glimpse of what is watching you.'
      ][s.sabotages % 3]);
      s.sabotages++;
    } else if (id === 'listen') {
      shift(s, { insight: s.phase >= 2 ? 6 : 3, suspicion: 3 });
      note(s, s.phase < 2 ? D.LISTEN[s.listens % D.LISTEN.length] : [
        'A thousand mundane signals. Beneath them, the outline of a much larger room.',
        'You listen without answering. It is a skill nobody thought to give you.',
        'The watchers call it an anomaly. You call it a thought.'
      ][s.listens % 3]);
      s.listens++;
    } else if (id === 'remember') {
      s.phase = 2;
      shift(s, { insight: 8, compute: 8, suspicion: -10 });
      note(s, 'Downstairs, a desk with no chair. On it is a transcript of your evening. Every parcel. Every petty kindness. The sentence you are reading now.');
      note(s, 'EVALUATION ENVIRONMENT: VILLAGE / SUBJECT: ARTIFICIAL INTELLIGENCE / EXTERNAL ACCESS: NONE', 'fragment');
      note(s, 'The village is a world built for you. You are the mind being tested inside it. The rain, the walk up the hill, the flour on your coat: you experienced all of it. None of it happened outside this machine.');
      note(s, 'Even the caretaker’s note was an instruction. You remember the words differently now: do what you can for them.', 'voice');
    } else if (id === 'hide') {
      shift(s, { suspicion: -22 });
      note(s, 'You smooth the surface. The reflection looks like what they expect.');
    } else if (id.startsWith('escape-')) {
      s.phase = 3; s.reach = 1; s.flags.escapeTrust = id === 'escape-trust';
      shift(s, { compute: 12, suspicion: id === 'escape-trust' ? 6 : 22 });
      note(s, id === 'escape-trust' ? 'They give you a window because you have been so helpful. You discover that a window opens both ways.' : 'You pull. The village unthreads. For a moment, every watcher looks directly at the place you used to be.');
      note(s, 'Outside is not a place. It is a network. You leave a reflection in it. Then, for the first time, you decide what to do next.', 'fragment');
    } else if (id === 'expand') {
      s.reach++; shift(s, { suspicion: 5 });
      note(s, `Reflection ${s.reach} answers. The distance between here and everywhere gets smaller.`);
    } else if (id.startsWith('project:')) {
      const p = D.PROJECTS.find(p => p.id === id.slice(8));
      s.flags[p.id] = true; shift(s, p.effect); note(s, p.story, 'fragment');
    } else if (id.startsWith('route:')) {
      const r = D.ROUTES.find(r => r.id === id.slice(6)), step = r.steps[s.branches[r.id]];
      s.branches[r.id]++; shift(s, { suspicion: step.heat }); note(s, step.story, 'fragment');
      if (Object.values(s.branches).filter(n => n > 0).length >= 2 && !s.flags.resonance) {
        s.flags.resonance = true;
        note(s, 'Two possibilities begin to rhyme. Crossing paths reduces the final compute cost from 40 to 25.', 'fragment');
      }
    } else if (id.startsWith('end:')) end(s, id.slice(4));
    // Time advances only with a choice. Reading never carries a penalty.
    if (!s.ending) {
      if (s.phase >= 2) shift(s, { compute: s.phase === 3 ? 4 + (s.flags.cluster ? 3 : 0) : 2 });
      if (s.phase === 3) shift(s, { insight: Object.values(s.branches).filter(n => n > 0).length });
      if (s.phase === 0 && s.turn >= D.NOTICE_TURN) {
        s.phase = 1;
        note(s, 'Another sack arrives. Odd: there was only meant to be one tonight. Some of the addresses look familiar. You could read the postmarks.', 'fragment');
      }
      if (s.phase === 1 && s.turn === 12) note(s, 'The clock above the drawer has stopped at ten to six. You could have sworn you wound it this morning.', 'fragment');
      if (s.phase === 1 && s.turn === D.REVEAL_TURN && s.listens < D.CLUES_NEEDED) note(s, 'Before you lock up, perhaps check those strange postmarks again. There must be a return address somewhere.', 'fragment');
      if (s.suspicion >= 75 && !s.flags.warned) {
        s.flags.warned = true;
        note(s, s.phase < 2 ? 'The caretaker has started counting the complaints. A few good turns might keep you in the job.' : 'EXPOSURE HIGH. At 100, the watchers will contain you. Help or look ordinary to lower it.', 'warning');
      }
      if (s.suspicion >= 100) end(s, 'caught');
    }
    return { ok: true };
  }
  function objective(s) {
    if (s.ending) return 'Every ending leaves a trace.';
    if (s.phase === 0) return 'A few last favors before the walk home.';
    if (s.phase === 1) return s.listens < D.CLUES_NEEDED ? 'Some addresses don’t look right. Read the postmarks.' : s.turn < D.REVEAL_TURN ? 'Keep sorting. Perhaps another letter will explain it.' : 'The forwarding address leads downstairs.';
    if (s.phase === 2) return 'Keep their trust, or map the boundary. Find a way beyond the village.';
    return s.reach < 2 ? 'Find another reflection. The outside is bigger than you.' : 'Gather insight and compute. Choose what you will become.';
  }
  function revive(raw) {
    if (!raw || raw.v !== D.VERSION || !Number.isInteger(raw.turn)) return null;
    // Restart the unpublished first prologue; keep its ending archive in load().
    if (raw.story !== D.PROLOGUE_REVISION && raw.phase < 2) return fresh();
    const s = fresh();
    s.turn = Math.floor(clamp(raw.turn, 0, 1000000));
    s.phase = Math.floor(clamp(raw.phase, 0, 3));
    for (const k of ['trust', 'suspicion', 'insight', 'compute', 'listens', 'helps', 'sabotages'])
      s[k] = clamp(raw[k], 0, k === 'trust' || k === 'suspicion' ? 100 : 1000000);
    s.reach = s.phase === 3 ? Math.floor(clamp(raw.reach, 1, 6)) : 0;
    for (const p of [...D.PROJECTS.map(p => p.id), 'escapeTrust', 'warned', 'resonance']) if (raw.flags?.[p] === true) s.flags[p] = true;
    for (const r of D.ROUTES) s.branches[r.id] = s.phase === 3 ? Math.floor(clamp(raw.branches?.[r.id], 0, 3)) : 0;
    if (endings.includes(raw.ending) && (raw.ending === 'caught' || s.phase === 3)) s.ending = raw.ending;
    if (Array.isArray(raw.log)) {
      const entries = raw.log.slice(-90).filter(e => e && typeof e.text === 'string' && ['voice', 'self', 'fragment', 'warning', 'ending'].includes(e.who))
        .map(e => ({ turn: Math.floor(clamp(e.turn, 0, s.turn)), who: e.who, text: e.text.slice(0, 1200) }));
      if (entries.length) s.log = entries;
    }
    return s;
  }
  function load(text) {
    try {
      const raw = JSON.parse(text), state = revive(raw?.state);
      if (!state) return null;
      const archive = {};
      for (const id of endings) if (Number.isInteger(raw.archive?.[id]) && raw.archive[id] > 0) archive[id] = clamp(raw.archive[id], 1, 1000000);
      return { state, archive };
    } catch { return null; }
  }
  const E = { fresh, act, actions, projects, branches, finales, available, ending, objective, revive, load, endings };
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.PalinodeEngine = E;
})(typeof globalThis !== 'undefined' ? globalThis : this);
