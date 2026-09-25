/* Alchemy — game engine. Pure logic, no DOM: state, clicking, crafting, machines, quests, saves. */
(function (root) {
  "use strict";
  const D = root.ALCHEMY_DATA || require("./data.js");
  const { ITEMS, RECIPES, SMELT, ACTIONS, QUESTS, CONFIG: C } = D;
  RECIPES.forEach((r, i) => (r.id = r.id || "r" + i));

  // per-tile state for machines that need it
  const TILE = {
    tree: () => ({ grow: 0, t: 0 }),
    barrel: () => ({ fill: 0, time: 0 }),
    rainBarrel: () => ({ water: 0 }),
    infested: () => ({ t: 0 }),
    crucible: () => ({ cobble: 0, melt: 0, lava: 0 }),
    cobblegen: () => ({ acc: 0 }),
    autoHammer: () => ({ t: 0 }),
    autoSieve: () => ({ t: 0 }),
  };

  function create(now = Date.now()) {
    const s = {
      v: 1, t: now, start: now, won: 0, clicks: 0,
      inv: {}, got: {}, seen: {}, island: [], work: {}, quests: {},
      sel: { sieve: "dirt", hammer: "cobble", autoHammer: "cobble", autoSieve: "gravel" },
      opt: { feedBarrels: true, compostSaplings: false, feedCrucible: true },
      fuel: [0, 0, 0, 0], queue: [], slots: [], ev: [],
    };
    for (let i = 0; i < C.start.land; i++) s.island.push(null);
    s.island[0] = { id: "tree", grow: 1, t: 0 };
    s.seen.tree = 1;
    return s;
  }

  // ---------- inventory ----------
  const isPlace = id => !!(ITEMS[id] && ITEMS[id].place);
  const built = (s, id) => s.island.reduce((n, t) => n + (t && t.id === id ? 1 : 0), 0);
  const grownTrees = s => s.island.filter(t => t && t.id === "tree" && t.grow >= 1).length;
  const count = (s, id) => (isPlace(id) ? built(s, id) : s.inv[id] || 0);
  const free = s => s.island.filter(t => !t).length;
  const emit = (s, type, text, data) => { if (s.ev) s.ev.push({ type, text, ...data }); };

  function give(s, id, n = 1) {
    if (n <= 0) return;
    if (isPlace(id)) {
      for (let k = 0; k < n; k++) {
        const i = s.island.indexOf(null);
        if (i < 0) return;
        s.island[i] = { id, ...(TILE[id] ? TILE[id]() : {}) };
      }
    } else s.inv[id] = (s.inv[id] || 0) + n;
    s.got[id] = (s.got[id] || 0) + n;
    if (!s.seen[id]) { s.seen[id] = 1; emit(s, "new", ITEMS[id].name, { id }); }
  }

  function take(s, id, n = 1) {
    if (!isPlace(id)) { s.inv[id] = (s.inv[id] || 0) - n; return; }
    for (let k = 0; k < n; k++) {
      const i = s.island.map(t => t && t.id).lastIndexOf(id);
      if (i >= 0) s.island[i] = null;
    }
  }

  function tool(s, kind) {
    let best = null;
    for (const [id, v] of C.tools[kind]) if (count(s, id) > 0) best = [id, v];
    return best;
  }
  const toolValue = (s, kind) => (tool(s, kind) || [null, 0])[1];

  function roll(s, table, mesh = 0) {
    const got = {};
    const luck = mesh ? C.meshLuck[mesh] : 1;
    for (const [id, p, n = 1, gate] of table) {
      if (typeof gate === "number" && mesh < gate) continue;
      if (typeof gate === "string" && !tool(s, gate)) continue;
      if (Math.random() < Math.min(1, p * luck)) got[id] = (got[id] || 0) + n;
    }
    for (const id in got) give(s, id, got[id]);
    return got;
  }

  // ---------- clicking ----------
  function actionState(s, id) {
    const a = ACTIONS[id];
    if (a.tree && !grownTrees(s)) return { ok: false, reason: "needs a grown tree" };
    let power = a.base || 0;
    if (a.tool) power += toolValue(s, a.tool);
    if (a.per) power += count(s, a.per);
    if (power <= 0) return { ok: false, reason: a.per ? `build a ${ITEMS[a.per].name.toLowerCase()}` : `needs a ${a.tool}` };
    const mesh = a.mesh ? toolValue(s, "mesh") : 0;
    if (a.mesh && !mesh) return { ok: false, reason: "needs a mesh", power };
    const input = a.inputs ? s.sel[id] : null;
    if (input && count(s, input) < 1) return { ok: false, reason: `no ${ITEMS[input].name.toLowerCase()}`, power, input };
    return { ok: true, power, input, mesh };
  }

  function act(s, id) {
    const st = actionState(s, id);
    if (!st.ok) return null;
    const a = ACTIONS[id];
    s.clicks++;
    s.work[id] = (s.work[id] || 0) + st.power;
    const gains = {};
    let done = 0;
    while (s.work[id] >= a.work && done < 16) {
      if (st.input && count(s, st.input) < 1) { s.work[id] = 0; break; }
      s.work[id] -= a.work;
      done++;
      if (st.input) take(s, st.input, 1);
      const got = roll(s, st.input ? a.inputs[st.input] : a.drops, st.mesh);
      for (const k in got) gains[k] = (gains[k] || 0) + got[k];
    }
    return { done, gains };
  }

  // ---------- crafting ----------
  function recipeState(s, r, times = 1) {
    if (r.at === "table" && !built(s, "table")) return { ok: false, reason: "needs a crafting table" };
    for (const id in r.needs || {}) if (count(s, id) < r.needs[id]) return { ok: false, reason: `needs ${ITEMS[id].name}` };
    for (const id in r.in) if (count(s, id) < r.in[id] * times) return { ok: false, reason: "missing ingredients" };
    let place = 0, freed = 0;
    for (const id in r.out) if (isPlace(id)) place += r.out[id] * times;
    for (const id in r.in) if (isPlace(id)) freed += r.in[id] * times;
    if (place > free(s) + freed) return { ok: false, reason: "no free land" };
    return { ok: true };
  }

  function maxCraft(s, r) {
    let m = 999;
    for (const id in r.in) m = Math.min(m, Math.floor(count(s, id) / r.in[id]));
    for (let n = m; n > 0; n--) if (recipeState(s, r, n).ok) return n;
    return 0;
  }

  function craft(s, r, times = 1) {
    times = Math.min(times, maxCraft(s, r));
    if (times <= 0) return 0;
    for (const id in r.in) take(s, id, r.in[id] * times);
    for (const id in r.out) give(s, id, r.out[id] * times);
    return times;
  }

  const visible = (s, r) => Object.keys(r.in).some(id => s.seen[id]);

  // ---------- island ----------
  const expandCost = s => Math.round(C.land.base + C.land.step * (s.island.length - C.start.land));
  function expand(s) {
    if (s.island.length >= C.land.max || count(s, "dirt") < expandCost(s)) return false;
    take(s, "dirt", expandCost(s));
    s.island.push(null);
    return true;
  }
  function demolish(s, i) {
    const t = s.island[i];
    if (!t) return false;
    if (t.id === "tree") { if (t.grow >= 1) give(s, "log", 2); give(s, "sapling", 1); }
    if (t.id === "crucible" && t.cobble) give(s, "cobble", t.cobble);
    s.island[i] = null;
    return true;
  }

  // ---------- machines ----------
  // auto-feeding leaves C.reserve behind (so you keep leaves for crafting); loading by hand does not
  function feedBarrel(s, tile, keep = true) {
    if (tile.time > 0) return;
    for (const id in ITEMS) {
      const v = ITEMS[id].compost;
      if (!v || (id === "sapling" && !s.opt.compostSaplings)) continue;
      const floor = keep ? C.reserve[id] || 0 : 0;
      while (tile.fill + v <= C.barrel.units && count(s, id) > floor) { take(s, id, 1); tile.fill += v; }
    }
  }
  const feedBarrels = s => s.island.forEach(t => t && t.id === "barrel" && feedBarrel(s, t, false));
  const fullRain = s => s.island.find(t => t && t.id === "rainBarrel" && t.water >= 1);
  const lavaCrucible = s => s.island.find(t => t && t.id === "crucible" && t.lava >= 1000);

  function mixClay(s) {
    const b = fullRain(s);
    if (!b || count(s, "dust") < 1) return false;
    take(s, "dust", 1);
    b.water = 0;
    give(s, "clayBlock", 1);
    return true;
  }

  function fillBucket(s, kind) {
    if (count(s, "bucket") < 1) return false;
    const src = kind === "water" ? fullRain(s) : lavaCrucible(s);
    if (!src) return false;
    if (kind === "water") src.water = 0; else src.lava -= 1000;
    take(s, "bucket", 1);
    give(s, kind === "water" ? "waterBucket" : "lavaBucket", 1);
    return true;
  }

  function queueSmelt(s, id, n) {
    n = Math.min(n, count(s, id));
    if (n <= 0 || !SMELT[id] || !built(s, "furnace")) return 0;
    take(s, id, n);
    const last = s.queue[s.queue.length - 1];
    if (last && last.id === id) last.n += n; else s.queue.push({ id, n });
    return n;
  }
  function clearQueue(s) {
    for (const q of s.queue) s.inv[q.id] = (s.inv[q.id] || 0) + q.n;
    s.queue = [];
  }
  function addFuel(s, id, n) {
    const f = ITEMS[id] && ITEMS[id].fuel;
    n = Math.min(n, count(s, id));
    if (!f || n <= 0) return 0;
    take(s, id, n);
    s.fuel[f[0]] += f[1] * n;
    return n;
  }

  function tickFurnaces(s, dt) {
    const slots = built(s, "furnace");
    while (s.slots.length > slots) {
      const job = s.slots.pop();
      if (job) s.inv[job.id] = (s.inv[job.id] || 0) + 1;
    }
    for (let i = 0; i < slots; i++) {
      if (!s.slots[i] && s.queue.length) {
        const q = s.queue[0];
        s.slots[i] = { id: q.id, p: 0 };
        if (--q.n <= 0) s.queue.shift();
      }
      const job = s.slots[i];
      if (!job) continue;
      const rec = SMELT[job.id];
      let t = dt;
      while (t > 1e-9) {
        let lvl = 0;
        for (let h = rec.heat; h <= 3; h++) if (s.fuel[h] > 1e-9) { lvl = h; break; }
        job.stalled = !lvl;
        if (!lvl) break;
        const use = Math.min(t, s.fuel[lvl], (1 - job.p) * rec.time);
        s.fuel[lvl] -= use;
        t -= use;
        job.p += use / rec.time;
        if (job.p >= 1 - 1e-6) { give(s, rec.out, 1); s.slots[i] = null; break; }
      }
    }
  }

  function autoRun(s, tile, dt, period, table, input, mesh) {
    tile.t += dt;
    tile.idle = false;
    while (tile.t >= period) {
      if (count(s, input) <= (C.reserve[input] || 0) || (table.mesh && !mesh)) { tile.t = period; tile.idle = true; return; }
      tile.t -= period;
      take(s, input, 1);
      roll(s, table[input], mesh);
    }
  }

  function tick(s, dt) {
    for (const tile of s.island) {
      if (!tile) continue;
      switch (tile.id) {
        case "tree":
          if (tile.grow < 1) { tile.grow = Math.min(1, tile.grow + dt / C.tree.grow); break; }
          tile.t += dt;
          while (tile.t >= C.tree.litter) { tile.t -= C.tree.litter; roll(s, C.tree.drops); }
          break;
        case "barrel":
          if (tile.time > 0) {
            tile.time -= dt;
            if (tile.time <= 0) { tile.time = 0; tile.fill = 0; give(s, "dirt", 1); }
            break;
          }
          if (s.opt.feedBarrels) feedBarrel(s, tile);
          if (tile.fill >= C.barrel.units) tile.time = C.barrel.time;
          break;
        case "rainBarrel":
          tile.water = Math.min(1, tile.water + dt / C.rain.time);
          break;
        case "infested":
          tile.t += dt;
          while (tile.t >= C.infested.time) { tile.t -= C.infested.time; roll(s, C.infested.drops); }
          break;
        case "crucible": {
          const K = C.crucible;
          // only take cobblestone that can still become lava
          if (s.opt.feedCrucible) while (tile.cobble < K.cobble && count(s, "cobble") > 0 && tile.lava + (tile.cobble + 1) * K.perCobble <= K.lava) { take(s, "cobble", 1); tile.cobble++; }
          if (tile.cobble > 0 && tile.lava + K.perCobble <= K.lava) {
            tile.melt += dt / K.melt;
            while (tile.melt >= 1 && tile.cobble > 0 && tile.lava + K.perCobble <= K.lava) { tile.melt -= 1; tile.cobble--; tile.lava += K.perCobble; }
          } else tile.melt = 0;
          break;
        }
        case "cobblegen": {
          tile.acc += dt * toolValue(s, "pick");
          const n = Math.floor(tile.acc);
          if (n > 0) { tile.acc -= n; give(s, "cobble", n); }
          break;
        }
        case "autoHammer":
          autoRun(s, tile, dt, C.autoHammer.time, ACTIONS.hammer.inputs, s.sel.autoHammer, 0);
          break;
        case "autoSieve":
          autoRun(s, tile, dt, C.autoSieve.time, Object.assign({ mesh: true }, ACTIONS.sieve.inputs), s.sel.autoSieve, toolValue(s, "mesh"));
          break;
      }
    }
    tickFurnaces(s, dt);
    checkQuests(s);
  }

  // ---------- quests ----------
  function met(s, need) {
    for (const id in need.got || {}) if ((s.got[id] || 0) < need.got[id]) return false;
    for (const id in need.built || {}) if (built(s, id) < need.built[id]) return false;
    if (need.anyBuilt && !need.anyBuilt.some(id => built(s, id) > 0)) return false;
    if (need.land && s.island.length < need.land) return false;
    return true;
  }
  function checkQuests(s) {
    for (const q of QUESTS) {
      if (s.quests[q.id] || !met(s, q.need)) continue;
      s.quests[q.id] = 1;
      for (const id in q.reward || {}) give(s, id, q.reward[id]);
      emit(s, "quest", q.title, { id: q.id });
      if (q.id === "terminal" && !s.won) s.won = s.t;
    }
  }
  const currentQuest = s => QUESTS.find(q => !s.quests[q.id]) || null;

  // ---------- saving ----------
  const KEY = "amog.alchemy.v1";
  function serialize(s) {
    const { ev, ...rest } = s;
    return JSON.stringify(rest);
  }
  function revive(json) {
    const s = JSON.parse(json);
    const base = create();
    for (const k in base) if (s[k] === undefined) s[k] = base[k];
    for (const k in base.sel) if (!s.sel[k]) s.sel[k] = base.sel[k];
    for (const k in base.opt) if (s.opt[k] === undefined) s.opt[k] = base.opt[k];
    s.ev = [];
    return s;
  }
  // credit time spent away (capped); returns what was gained
  function catchUp(s, now = Date.now()) {
    let dt = Math.min(Math.max(0, (now - s.t) / 1000), C.offline);
    const before = { ...s.inv }, ev = s.ev, secs = dt;
    s.ev = null;
    while (dt > 0) { const step = Math.min(1, dt); tick(s, step); dt -= step; }
    s.ev = ev;
    s.t = now;
    const gains = {};
    for (const id in s.inv) { const d = s.inv[id] - (before[id] || 0); if (d > 0) gains[id] = d; }
    return { secs, gains };
  }

  const api = {
    DATA: D, KEY, create, count, built, free, grownTrees, give, take, tool, toolValue, actionState, act,
    recipeState, maxCraft, craft, visible, expandCost, expand, demolish, feedBarrels, fullRain, lavaCrucible,
    mixClay, fillBucket, queueSmelt, clearQueue, addFuel, tick, currentQuest, serialize, revive, catchUp,
  };
  root.Alchemy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
