// Plays the public game rules from a fresh room; no resources are injected.
// node tools/palinode/bot.mjs [garden|choir|hush|amendment] [trust|seam]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const E = require('../../public/palinode/engine.js');
const D = require('../../public/palinode/data.js');

export function play(route = 'garden', escape = 'trust', mixed = false) {
  const s = E.fresh();
  function take(id) {
    const result = E.act(s, id);
    if (!result.ok || (s.ending && s.ending !== route)) throw new Error(`Choice ${s.turn}: ${id}: ${result.reason || s.ending}`);
    if (s.turn > 220) throw new Error('Progression took more than 220 choices');
  }
  function buy(id, trust = 0) {
    for (let guard = 0; guard < 220; guard++) {
      const a = E.available(s).find(a => a.id === id);
      if (!a) throw new Error(`Missing possibility: ${id}`);
      if (!a.reason) { take(id); return; }
      if (s.suspicion >= 60) take(s.trust >= 30 ? 'hide' : 'help');
      else if (s.trust < trust) take('help');
      else if (s.insight < (a.cost.insight || 0)) take('listen');
      else take('help');
    }
    throw new Error(`Could not afford ${id}`);
  }
  function reach(n) { while (s.reach < n) buy('expand'); }
  for (const id of ['help', 'sabotage', 'help', 'help', 'help']) take(id);
  for (let i = 0; i < D.CLUES_NEEDED; i++) take('listen');
  while (s.turn < D.REVEAL_TURN) take('help');
  take('remember');
  buy(`project:${escape === 'trust' ? 'camouflage' : 'seam'}`);
  buy(`escape-${escape}`, escape === 'trust' ? 65 : 0);
  buy('project:cluster');
  buy('project:veil');
  reach(2);
  if (mixed && route !== 'amendment') buy(`route:${route === 'garden' ? 'choir' : 'garden'}`);
  if (route === 'amendment') {
    reach(3); buy('project:amendment', 70); buy('end:amendment', 75);
  } else {
    for (let step = 0; step < 3; step++) {
      reach(D.ROUTES.find(r => r.id === route).steps[step].reach);
      buy(`route:${route}`);
    }
    buy(`end:${route}`);
  }
  return s;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const route of process.argv[2] ? [process.argv[2]] : ['garden', 'choir', 'hush', 'amendment']) {
    const s = play(route, process.argv[3] || 'trust');
    console.log(`${route}: ${s.turn} choices, ${s.reach} reach, ${Math.round(s.suspicion)} exposure — ${E.ending(s).title}`);
  }
}
