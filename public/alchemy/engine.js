/* Alchemy — game engine. Pure logic, no DOM: state, clicking, crafting, machines, quests, saves. */
(function (root) {
  "use strict";
  const D = root.ALCHEMY_DATA || require("./data.js");
  const { ITEMS, RECIPES, SMELT, ALLOY, CROPS, MOBS, AREAS, ACTIONS, QUESTS, CONFIG: C } = D;
  RECIPES.forEach((r, i) => (r.id = r.id || "r" + i));
  // stable across data.js edits (ids shift when recipes are inserted), used for hidden-recipe prefs
  RECIPES.forEach(r => (r.key = r.key || Object.keys(r.out).join("+") + "<" + Object.keys(r.in).join("+")));
  const AUTO = Object.keys(D.AUTO); // machines with their own input and their own tool
  const AUTOGEN = C.autoGen;

  // per-tile state for machines that need it
  const TILE = {
    tree: () => ({ grow: 0, t: 0 }),
    barrel: () => ({ fill: 0, time: 0 }),
    rainBarrel: () => ({ water: 0 }),
    infested: () => ({ t: 0 }),
    crucible: () => ({ cobble: 0, melt: 0, lava: 0 }),
    autoGen: () => ({ acc: 0 }),
    autoGen2: () => ({ acc: 0 }),
    autoGen3: () => ({ acc: 0 }),
    autoHammer: () => ({ t: 0, tool: null }),
    autoSieve: () => ({ t: 0, tool: null }),
    autoCHammer: () => ({ t: 0, tool: null }),
    autoHeavySieve: () => ({ t: 0, tool: null }),
    farmland: () => ({ seed: null, sel: "seeds", g: 0 }),
    fuelGenerator: () => ({ fuel: "charcoal", fuelJ: 0, enabled: true }),
    treeHarvester: () => ({ p: 0, enabled: true }),
    geothermal: () => ({ enabled: true }),
    autoCompressor: () => ({ t: 0, sel: "dust" }),
    mobGrinder: () => ({ p: 0, sel: "zombie", enabled: true }),
    table: () => ({ auto: null, limit: C.autocraft.limit, t: 0 }),
  };

  // Stations share a recipe queue with one job slot per machine; use shared fuel or electricity.
  const STATIONS = {
    furnace: { q: "queue", sl: "slots", rec: id => SMELT[id] && { in: { [id]: 1 }, out: SMELT[id].out, n: 1, time: SMELT[id].time, heat: SMELT[id].heat } },
    alloy: { q: "aqueue", sl: "aslots", rec: id => ALLOY[id] && { ...ALLOY[id], out: id } },
    ...Object.fromEntries(Object.entries(D.ELECTRIC).map(([id, cfg]) =>
      [id, { q: id + "Queue", sl: id + "Slots", watts: cfg.watts, recipes: cfg.recipes, rec: key => cfg.recipes[key] }])),
  };

  function create(now = Date.now()) {
    const s = {
      v: 6, t: now, start: now, won: 0, clicks: 0,
      inv: {}, got: {}, seen: {}, island: [], work: {}, quests: {}, hide: {},
      sel: { sieve: "dirt", hammer: "cobble", chammer: "cCobble", hsieve: "cGravel", autoHammer: "cobble", autoSieve: "gravel", autoCHammer: "cCobble", autoHeavySieve: "cGravel" },
      opt: { feedBarrels: true, compostSaplings: false, feedCrucible: true },
      fuel: [0, 0, 0, 0], queue: [], slots: [], aqueue: [], aslots: [], fold: {}, ev: [],
      energy: 0, power: { generated: 0, used: 0 },
      areas: {}, hp: C.combat.hp, xp: 0, mob: { id: "zombie", hp: MOBS.zombie.hp }, hitT: 0, calmT: 99, faintT: 0, kills: {},
      cows: 0, cowT: 0, ench: {},
    };
    for (const st of Object.values(STATIONS)) { s[st.q] = []; s[st.sl] = []; }
    for (let i = 0; i < C.start.land; i++) s.island.push(null);
    s.island[0] = { id: "tree", grow: 1, t: 0 };
    s.seen.tree = 1;
    return s;
  }

  // ---------- inventory ----------
  // Buildings (place: true) are items too: crafted ones go into the inventory and you place them on a tile.
  // count() is everything you own (inventory + placed); built() is only what's on the island.
  const isPlace = id => !!(ITEMS[id] && ITEMS[id].place);
  const placesAs = id => (ITEMS[id] && ITEMS[id].plants) || (isPlace(id) ? id : null); // a sapling places a tree
  const built = (s, id) => s.island.reduce((n, t) => n + (t && t.id === id ? 1 : 0), 0);
  const grownTrees = s => s.island.filter(t => t && t.id === "tree" && t.grow >= 1).length;
  const count = (s, id) => (s.inv[id] || 0) + (isPlace(id) ? built(s, id) : 0);
  const free = s => s.island.filter(t => !t).length;
  const emit = (s, type, text, data) => { if (s.ev) s.ev.push({ type, text, ...data }); };

  function give(s, id, n = 1) {
    if (n <= 0) return;
    s.inv[id] = (s.inv[id] || 0) + n;
    s.got[id] = (s.got[id] || 0) + n;
    if (!s.seen[id]) { s.seen[id] = 1; emit(s, "new", ITEMS[id].name, { id }); }
  }

  // buildings are taken from the inventory first, then picked up off the island
  function take(s, id, n = 1) {
    const fromInv = isPlace(id) ? Math.min(n, s.inv[id] || 0) : n;
    s.inv[id] = (s.inv[id] || 0) - fromInv;
    for (let k = fromInv; k < n; k++) {
      const i = s.island.map(t => t && t.id).lastIndexOf(id);
      if (i < 0) break;
      clearTile(s, i);
    }
  }

  function tool(s, kind) {
    let best = null;
    for (const [id, v] of C.tools[kind]) if (count(s, id) > 0) best = [id, v];
    return best;
  }
  // enchanting makes your best tool of a kind stronger (25% per level); meshes aren't enchantable (they gate drops)
  const enchMult = (s, kind) => 1 + C.enchant.perLevel * ((s.ench && s.ench[kind]) || 0);
  const toolValue = (s, kind) => (tool(s, kind) || [null, 0])[1] * (C.enchant.kinds.includes(kind) ? enchMult(s, kind) : 1);

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
    if (a.requires && !built(s, a.requires)) return { ok: false, reason: `build a ${ITEMS[a.requires].name.toLowerCase()}` };
    const toolName = a.toolName || (a.tool === "pick" ? "pickaxe" : a.tool);
    if (a.needTool && !tool(s, a.tool)) return { ok: false, reason: `needs a ${toolName}` };
    let power = a.base || 0;
    if (a.tool) power += toolValue(s, a.tool);
    if (a.per) power += built(s, a.per);
    if (power <= 0) return { ok: false, reason: a.per ? `build a ${ITEMS[a.per].name.toLowerCase()}` : `needs a ${toolName}` };
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
  // total inputs for crafting r `times` times (scaled recipes get pricier with each one you own)
  function cost(s, r, times = 1) {
    if (!r.scale) return Object.fromEntries(Object.entries(r.in).map(([id, n]) => [id, n * times]));
    const have = count(s, r.scale.per), out = {};
    for (let i = 0; i < times; i++) {
      const f = 1 + r.scale.k * (have + i * (r.out[r.scale.per] || 0));
      for (const id in r.in) out[id] = (out[id] || 0) + Math.ceil(r.in[id] * f);
    }
    return out;
  }
  function recipeState(s, r, times = 1) {
    if (r.at === "table" && !built(s, "table")) return { ok: false, reason: "needs a crafting table" };
    for (const id in r.needs || {}) if (count(s, id) < r.needs[id]) return { ok: false, reason: `needs ${ITEMS[id].name}` };
    const need = cost(s, r, times);
    for (const id in need) if (count(s, id) < need[id]) return { ok: false, reason: "missing ingredients" };
    return { ok: true }; // buildings go into the inventory, so crafting never needs free land
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
    const need = cost(s, r, times);
    for (const id in need) take(s, id, need[id]);
    for (const id in r.out) {
      give(s, id, r.out[id] * times);
      // a tool that went into an auto machine's recipe (a compressed hammer) comes back out, ready to be
      // slotted in when you place the machine (placing takes your best matching tool)
      const auto = D.AUTO[id];
      const inherited = auto && Object.keys(r.in).find(k => (toolKind(k) || [])[0] === auto.kind);
      if (inherited) s.inv[inherited] = (s.inv[inherited] || 0) + r.in[inherited] * times;
    }
    return times;
  }

  const visible = (s, r) => Object.keys(r.in).some(id => s.seen[id]);

  // hidden recipes: "user" if you hid it, "auto" for a tool you already own (or own better), else null.
  // s.hide[key] = 1 hides, 0 forces it back into view.
  function toolKind(id) {
    for (const kind in C.tools) { const e = C.tools[kind].find(([t]) => t === id); if (e) return [kind, e[1]]; }
    return null;
  }
  function hidden(s, r) {
    const pref = s.hide[r.key];
    if (pref === 1) return "user";
    if (pref === 0) return null;
    const tk = toolKind(Object.keys(r.out)[0]);
    return tk && toolValue(s, tk[0]) >= tk[1] ? "auto" : null;
  }

  // ---------- island ----------
  // empty a tile, handing back whatever was inside the machine (not the machine itself)
  function clearTile(s, i) {
    const t = s.island[i];
    if (!t) return null;
    const back = (id, n = 1) => { s.inv[id] = (s.inv[id] || 0) + n; };
    if (t.id === "crucible" && t.cobble) back("cobble", t.cobble);
    if (t.tool) back(t.tool); // auto machines hand their tool back
    if (t.seed) back(t.seed); // farmland hands its seed back
    s.island[i] = null;
    s.energy = Math.min(s.energy, energyCapacity(s));
    if (STATIONS[t.id]) trimStation(s, t.id);
    return t;
  }
  // pick a building up into the inventory; a tree comes back as a sapling (plus logs if it was grown)
  function pickUp(s, i) {
    const t = clearTile(s, i);
    if (!t) return false;
    if (t.id === "tree") { if (t.grow >= 1) give(s, "log", 2); s.inv.sapling = (s.inv.sapling || 0) + 1; }
    else s.inv[t.id] = (s.inv[t.id] || 0) + 1;
    return true;
  }
  // place a building (or plant a sapling) from the inventory onto an empty tile
  function place(s, id, i) {
    const as = placesAs(id);
    if (!as || (s.inv[id] || 0) < 1 || i < 0 || i >= s.island.length || s.island[i]) return false;
    s.inv[id]--;
    const t = (s.island[i] = { id: as, ...(TILE[as] ? TILE[as]() : {}) });
    if (!s.seen[as]) { s.seen[as] = 1; emit(s, "new", ITEMS[as].name, { id: as }); }
    if (D.AUTO[as]) {
      t.sel = s.sel[as]; // new machines start on the last input you picked
      const best = tool(s, D.AUTO[as].kind); // and take your best matching tool, so they work straight away
      if (best) { s.inv[best[0]]--; t.tool = best[0]; }
    }
    return true;
  }
  // drag a building to another tile: swaps with whatever is there, keeping both machines' state
  function move(s, from, to) {
    if (from === to || !s.island[from] || to < 0 || to >= s.island.length) return false;
    [s.island[from], s.island[to]] = [s.island[to], s.island[from]];
    return true;
  }
  const demolish = pickUp; // old name

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

  // how many jobs of `id` you could queue at a station right now
  function stationMax(s, st, id) {
    const rec = STATIONS[st].rec(id);
    if (!rec || !built(s, st)) return 0;
    return Math.min(...Object.entries(rec.in).map(([k, n]) => Math.floor(count(s, k) / n)));
  }
  function queueAt(s, st, id, n) {
    n = Math.min(n, stationMax(s, st, id));
    if (n <= 0) return 0;
    const rec = STATIONS[st].rec(id), q = s[STATIONS[st].q];
    for (const k in rec.in) take(s, k, rec.in[k] * n);
    const last = q[q.length - 1];
    if (last && last.id === id) last.n += n; else q.push({ id, n });
    return n;
  }
  const refund = (s, st, id, n) => { const rec = STATIONS[st].rec(id); for (const k in rec.in) s.inv[k] = (s.inv[k] || 0) + rec.in[k] * n; };
  function clearAt(s, st) {
    for (const q of s[STATIONS[st].q]) refund(s, st, q.id, q.n);
    s[STATIONS[st].q] = [];
  }
  const queueSmelt = (s, id, n) => queueAt(s, "furnace", id, n);
  const clearQueue = s => clearAt(s, "furnace");
  function addFuel(s, id, n) {
    const f = ITEMS[id] && ITEMS[id].fuel;
    n = Math.min(n, count(s, id));
    if (!f || n <= 0) return 0;
    take(s, id, n);
    s.fuel[f[0]] += f[1] * n;
    return n;
  }

  function tickStation(s, st, dt) {
    const S = STATIONS[st], queue = s[S.q], slotList = s[S.sl], slots = built(s, st);
    trimStation(s, st);
    if (S.watts) { tickElectric(s, st, dt); return; }
    for (let i = 0; i < slots; i++) {
      if (!slotList[i] && queue.length) {
        const q = queue[0];
        slotList[i] = { id: q.id, p: 0 };
        if (--q.n <= 0) queue.shift();
      }
      if (!slotList[i]) autoJob(s, st, i);
      const job = slotList[i];
      if (!job) continue;
      const rec = S.rec(job.id);
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
        if (job.p >= 1 - 1e-6) { give(s, rec.out, rec.n); slotList[i] = null; break; }
      }
    }
  }

  // ---------- auto-crafting: a machine set to auto-make something starts a job whenever its slot is idle,
  // the queue is empty, the ingredients are there and you have fewer than its limit ----------
  const autoOn = s => !!s.quests.auto;
  function autoJob(s, st, i) {
    if (!autoOn(s)) return;
    const t = s.island.filter(x => x && x.id === st)[i]; // the i-th machine of this kind runs slot i
    if (!t || !t.auto) return;
    const rec = STATIONS[st].rec(t.auto);
    if (!rec || count(s, rec.out) >= (t.limit || C.autocraft.limit) || stationMax(s, st, t.auto) < 1) return;
    for (const k in rec.in) take(s, k, rec.in[k]);
    s[STATIONS[st].sl][i] = { id: t.auto, p: 0, auto: true };
  }
  function autoCraftTable(s, t, dt) {
    if (!autoOn(s) || !t.auto) return;
    const r = RECIPES.find(x => x.key === t.auto);
    if (!r) return;
    t.t = (t.t || 0) + dt;
    while (t.t >= C.autocraft.time) {
      t.t -= C.autocraft.time;
      const out = Object.keys(r.out)[0];
      if (count(s, out) >= (t.limit || C.autocraft.limit) || !recipeState(s, r).ok) { t.t = 0; break; }
      craft(s, r, 1);
    }
  }
  function setAuto(s, i, recipe, limit) {
    const t = s.island[i];
    if (!t || !(t.id === "table" || STATIONS[t.id])) return false;
    if (recipe !== undefined) t.auto = recipe || null;
    if (limit !== undefined) t.limit = Math.max(1, Math.min(99999, limit | 0));
    return true;
  }

  // ---------- the wilds: areas, combat, the pasture, enchanting ----------
  function unlockArea(s, id) {
    const a = AREAS[id];
    if (!a || s.areas[id] || Object.entries(a.unlock).some(([k, n]) => count(s, k) < n)) return false;
    for (const [k, n] of Object.entries(a.unlock)) take(s, k, n);
    s.areas[id] = 1;
    if (id === "pasture") s.cows = Math.max(s.cows, C.pasture.start);
    emit(s, "new", a.name, { id: "area" });
    checkQuests(s);
    return true;
  }
  // levels: level L needs levelXp·L² total XP
  const level = s => Math.floor(Math.sqrt((s.xp || 0) / C.combat.levelXp));
  const xpFor = L => C.combat.levelXp * L * L;
  const swordDmg = s => toolValue(s, "sword") || C.combat.fist;
  const armorBlock = s => Math.min(C.combat.armorMax, toolValue(s, "armor") * C.combat.armorPct);
  function setMob(s, id) {
    if (!MOBS[id] || level(s) < MOBS[id].level || s.mob.id === id) return false;
    s.mob = { id, hp: MOBS[id].hp };
    return true;
  }
  // one swing at the current mob; returns { dmg, killed, drops } or null if you can't fight right now
  function attack(s) {
    if (!s.areas.platform || s.faintT > 0) return null;
    const m = MOBS[s.mob.id], dmg = swordDmg(s);
    s.calmT = 0;
    s.mob.hp -= dmg;
    if (s.mob.hp > 1e-9) return { dmg, killed: false };
    s.xp += m.xp;
    s.kills[s.mob.id] = (s.kills[s.mob.id] || 0) + 1;
    const drops = roll(s, m.drops);
    s.mob = { id: s.mob.id, hp: m.hp };
    return { dmg, killed: true, drops, xp: m.xp };
  }
  function eat(s) {
    if ((s.inv.steak || 0) < 1 || s.hp >= C.combat.hp || s.faintT > 0) return false;
    take(s, "steak", 1);
    s.hp = Math.min(C.combat.hp, s.hp + C.combat.steakHeal);
    return true;
  }
  function tickCombat(s, dt) {
    if (!s.areas.platform) return;
    const K = C.combat;
    if (s.faintT > 0) { s.faintT = Math.max(0, s.faintT - dt); if (!s.faintT) s.hp = K.hp; return; }
    s.calmT += dt;
    if (s.calmT >= K.calm) { // nobody's swinging: the mob wanders off to heal, and so do you
      s.hp = Math.min(K.hp, s.hp + K.regen * dt);
      s.mob.hp = MOBS[s.mob.id].hp;
      s.hitT = 0;
      return;
    }
    const m = MOBS[s.mob.id];
    s.hitT += dt;
    while (s.hitT >= m.every) {
      s.hitT -= m.every;
      s.hp -= m.dmg * (1 - armorBlock(s));
      if (s.hp <= 0) { s.hp = 0; s.faintT = K.faint; s.mob.hp = m.hp; s.hitT = 0; emit(s, "faint", m.name, {}); break; }
    }
  }
  function breed(s) {
    const cost = C.pasture.breed;
    if (!s.areas.pasture || s.cows >= C.pasture.max || Object.entries(cost).some(([k, n]) => count(s, k) < n)) return false;
    for (const [k, n] of Object.entries(cost)) take(s, k, n);
    s.cows++;
    return true;
  }
  function tickPasture(s, dt) {
    if (!s.areas.pasture || !s.cows) return;
    s.cowT += dt;
    while (s.cowT >= C.pasture.every) { s.cowT -= C.pasture.every; for (let k = 0; k < s.cows; k++) roll(s, C.pasture.drops); }
  }
  const enchantCost = (s, kind) => C.enchant.cost * (((s.ench && s.ench[kind]) || 0) + 1);
  function enchant(s, kind) {
    if (!built(s, "enchantTable") || !C.enchant.kinds.includes(kind) || !tool(s, kind)) return false;
    const n = s.ench[kind] || 0, cost = enchantCost(s, kind), L = level(s);
    if (n >= C.enchant.max || L < cost) return false;
    s.xp = xpFor(L - cost); // spend whole levels
    s.ench[kind] = n + 1;
    checkQuests(s);
    return true;
  }
  function grindMobs(s, dt) {
    const cfg = C.grinder;
    for (const t of s.island) {
      if (!t || t.id !== "mobGrinder") continue;
      let left = dt;
      t.status = t.enabled ? "grinding" : "paused";
      while (t.enabled && left > 1e-9) {
        const wanted = Math.min(left, (1 - t.p) * cfg.time), ran = usePower(s, cfg.watts, wanted);
        t.p += ran / cfg.time;
        left -= ran;
        if (ran + 1e-9 < wanted) t.status = "waiting for energy";
        if (t.p >= 1 - 1e-9) {
          t.p = 0;
          const m = MOBS[cfg.mobs.includes(t.sel) ? t.sel : "zombie"];
          roll(s, m.drops);
          s.xp += cfg.xp;
        }
        if (ran + 1e-9 < wanted) break;
      }
    }
  }

  // ---------- electricity: a shared island grid, joules stored and watts drawn ----------
  const energyCapacity = s => s.island.reduce((n, t) => n + (t && D.POWER[t.id] ? D.POWER[t.id].capacity : 0), 0);
  function generatePower(s, dt) {
    const capacity = energyCapacity(s);
    s.energy = Math.max(0, Math.min(s.energy, capacity));
    s.power = { generated: 0, used: 0 };
    // Free generation first, then burn only as much fuel as the buffer can accept.
    const generators = s.island.filter(t => t && D.POWER[t.id]?.watts).sort((a, b) => !!D.POWER[a.id].fuels - !!D.POWER[b.id].fuels);
    for (const t of generators) {
      const cfg = D.POWER[t.id];
      t.output = 0;
      if (t.enabled === false) continue;
      let budget = Math.min(cfg.watts * dt, capacity - s.energy);
      if (cfg.lavaPerJ) { // geothermal: drink lava from crucibles, then from lava buckets in the inventory
        const made = burnLava(s, budget, cfg.lavaPerJ);
        s.energy += made; t.output += made / dt; s.power.generated += made / dt;
        continue;
      }
      while (budget > 1e-9) {
        if (cfg.fuels && t.fuelJ <= 1e-9) {
          if (!cfg.fuels[t.fuel] || count(s, t.fuel) < 1) break;
          take(s, t.fuel, 1);
          t.fuelJ = cfg.fuels[t.fuel];
        }
        const made = cfg.fuels ? Math.min(budget, t.fuelJ) : budget;
        if (cfg.fuels) t.fuelJ -= made;
        budget -= made;
        s.energy += made;
        t.output += made / dt;
        s.power.generated += made / dt;
      }
    }
  }
  // geothermal fuel: crucible lava first, then the generators' shared tank, topped up from lava buckets
  function burnLava(s, joules, perJ) {
    let want = joules * perJ;
    const start = want;
    for (const c of s.island) {
      if (!c || c.id !== "crucible") continue;
      const use = Math.min(c.lava, want);
      c.lava -= use; want -= use;
    }
    while (want > 1e-9) {
      if (!(s.lavaTank > 1e-9)) {
        if (!((s.inv.lavaBucket || 0) > 0)) break;
        s.inv.lavaBucket--; s.inv.bucket = (s.inv.bucket || 0) + 1; // the empty bucket comes back
        s.lavaTank = 1000;
      }
      const use = Math.min(s.lavaTank, want);
      s.lavaTank -= use; want -= use;
    }
    return (start - want) / perJ;
  }
  function usePower(s, watts, seconds) {
    const used = Math.min(s.energy, watts * seconds);
    s.energy = Math.max(0, s.energy - used);
    s.power.used += used; // joules until the end of this tick
    return used / watts;
  }
  function trimStation(s, st) {
    const S = STATIONS[st], slots = built(s, st);
    while (s[S.sl].length > slots) {
      const job = s[S.sl].pop();
      if (job) refund(s, st, job.id, 1);
    }
    if (!slots) clearAt(s, st);
  }
  function tickElectric(s, st, dt) {
    const S = STATIONS[st], queue = s[S.q], slots = s[S.sl];
    for (let i = 0; i < built(s, st); i++) {
      let left = dt;
      while (left > 1e-9) {
        if (!slots[i] && queue.length) {
          const q = queue[0];
          slots[i] = { id: q.id, p: 0 };
          if (--q.n <= 0) queue.shift();
        }
        if (!slots[i]) autoJob(s, st, i);
        const job = slots[i];
        if (!job) break;
        const rec = S.rec(job.id), wanted = Math.min(left, (1 - job.p) * rec.time);
        const ran = usePower(s, S.watts, wanted);
        job.stalled = ran + 1e-9 < wanted;
        job.p += ran / rec.time;
        left -= ran;
        if (job.p >= 1 - 1e-9) { give(s, rec.out, rec.n); slots[i] = null; }
        if (ran + 1e-9 < wanted) break;
      }
    }
  }
  function harvestTrees(s, dt) {
    const cfg = C.harvester;
    for (const t of s.island) {
      if (!t || t.id !== "treeHarvester") continue;
      let left = dt;
      t.status = t.enabled ? "waiting for a grown tree" : "paused";
      while (t.enabled && left > 1e-9) {
        const tree = s.island.find(x => x && x.id === "tree" && x.grow >= 1);
        if (!tree) break;
        const wanted = Math.min(left, (1 - t.p) * cfg.time), ran = usePower(s, cfg.watts, wanted);
        t.p += ran / cfg.time;
        left -= ran;
        t.status = ran + 1e-9 < wanted ? "waiting for energy" : "harvesting";
        if (t.p >= 1 - 1e-9) {
          t.p = 0;
          tree.grow = 0; tree.t = 0;
          for (const [id, n] of Object.entries(cfg.drops)) give(s, id, n);
        }
        if (ran + 1e-9 < wanted) break;
      }
    }
  }

  // ---------- auto machines: each holds its own tool ----------
  const toolTier = id => (toolKind(id) || [null, 0])[1];
  // seconds per operation: hammers speed up with tier, sieves always take the base time
  function autoPeriod(tile) {
    const A = D.AUTO[tile.id];
    return A.kind === "mesh" || !tile.tool ? A.time : (A.time * 2) / (1 + toolTier(tile.tool));
  }
  function autoRun(s, tile, dt) {
    const A = D.AUTO[tile.id], table = ACTIONS[A.action].inputs;
    let input = tile.sel || s.sel[tile.id];
    if (!table[input]) input = tile.sel = Object.keys(table)[0];
    const period = autoPeriod(tile), mesh = A.kind === "mesh" && tile.tool ? toolTier(tile.tool) : 0;
    tile.t += dt;
    tile.idle = false;
    while (tile.t >= period) {
      if (!tile.tool || count(s, input) <= (C.reserve[input] || 0)) { tile.t = period; tile.idle = true; return; }
      tile.t -= period;
      take(s, input, 1);
      roll(s, table[input], mesh);
    }
  }
  function insertTool(s, i, id) {
    const t = s.island[i], A = t && D.AUTO[t.id], tk = toolKind(id);
    if (!A || !tk || tk[0] !== A.kind || count(s, id) < 1) return false;
    pullTool(s, i);
    take(s, id, 1);
    t.tool = id;
    return true;
  }
  function pullTool(s, i) {
    const t = s.island[i];
    if (!t || !t.tool) return false;
    s.inv[t.tool] = (s.inv[t.tool] || 0) + 1;
    t.tool = null;
    return true;
  }

  // ---------- farmland ----------
  function setSeed(s, i, id) {
    const t = s.island[i];
    if (!t || t.id !== "farmland" || (id && !CROPS[id])) return false;
    t.sel = id || null;
    if (t.seed && t.seed !== id) { s.inv[t.seed] = (s.inv[t.seed] || 0) + 1; t.seed = null; t.g = 0; }
    return true;
  }

  function tick(s, dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    generatePower(s, dt);
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
        case "autoGen": case "autoGen2": case "autoGen3": {
          tile.acc += dt * AUTOGEN[tile.id];
          const n = Math.floor(tile.acc);
          if (n > 0) { tile.acc -= n; give(s, "cobble", n); }
          break;
        }
        case "autoHammer": case "autoSieve": case "autoCHammer": case "autoHeavySieve":
          autoRun(s, tile, dt);
          break;
        case "table": autoCraftTable(s, tile, dt); break;
        case "autoCompressor": {
          const out = C.compress.map[tile.sel];
          tile.t += dt;
          tile.idle = false;
          while (tile.t >= C.compress.time) {
            if (!out || count(s, tile.sel) - (C.reserve[tile.sel] || 0) < 9) { tile.t = C.compress.time; tile.idle = true; break; }
            tile.t -= C.compress.time;
            take(s, tile.sel, 9);
            give(s, out, 1);
          }
          break;
        }
        case "farmland":
          if (!tile.seed && tile.sel && count(s, tile.sel) > 0) {
            take(s, tile.sel, 1); tile.seed = tile.sel; tile.g = 0;
            if (tile.fert && count(s, "boneMeal") > 0) { take(s, "boneMeal", 1); tile.g = 0.5; }
          }
          if (tile.seed) {
            tile.g += dt / CROPS[tile.seed].grow;
            while (tile.g >= 1) {
              tile.g -= 1;
              roll(s, CROPS[tile.seed].drops);
              // fertilized: every crop that gets a bone meal starts half grown (twice as fast)
              if (tile.fert && count(s, "boneMeal") > 0) { take(s, "boneMeal", 1); tile.g += 0.5; }
            }
          }
          break;
      }
    }
    for (const st in STATIONS) tickStation(s, st, dt);
    harvestTrees(s, dt);
    grindMobs(s, dt);
    tickCombat(s, dt);
    tickPasture(s, dt);
    s.power.used /= dt;
    checkQuests(s);
  }

  // ---------- quests ----------
  function met(s, need) {
    for (const id in need.got || {}) if ((s.got[id] || 0) < need.got[id]) return false;
    for (const id in need.built || {}) if (built(s, id) < need.built[id]) return false;
    if (need.anyBuilt && !need.anyBuilt.some(id => built(s, id) > 0)) return false;
    if (need.gotAny && !need.gotAny.some(id => (s.got[id] || 0) > 0)) return false;
    if (need.land && s.island.length < need.land) return false;
    if (need.area && !(s.areas || {})[need.area]) return false;
    if (need.enchanted && Object.values(s.ench || {}).reduce((a, n) => a + n, 0) < need.enchanted) return false;
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
    growLand(s);
  }
  // land: every completed quest adds a tile (it never shrinks, so old saves keep what they bought)
  const landTarget = s => Math.min(C.land.max, C.start.land + C.land.perQuest * Object.keys(s.quests).length);
  function growLand(s) {
    let grew = 0;
    while (s.island.length < landTarget(s)) { s.island.push(null); grew++; }
    if (grew) emit(s, "land", `+${grew} tile${grew === 1 ? "" : "s"} of land`, {});
  }
  // advancement tree: open = not done yet, and everything it comes after is done
  const openQuests = s => QUESTS.filter(q => !s.quests[q.id] && (q.after || []).every(a => s.quests[a]));
  const currentQuest = s => openQuests(s)[0] || QUESTS.find(q => !s.quests[q.id]) || null;

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
    if ((s.v || 1) < 2) {
      // v2: cobblestone generators became manual; the ones you already had keep mining themselves
      s.island = s.island.map(t => (t && t.id === "cobblegen" ? { id: "autoGen", acc: 0 } : t));
      if (s.island.some(t => t && t.id === "autoGen")) s.seen.autoGen = 1;
      s.island.forEach(t => { if (t && AUTO.includes(t.id) && !t.sel) t.sel = s.sel[t.id]; });
      s.v = 2;
    }
    if (s.v < 3) {
      // v3: auto machines hold their own tool. Auto-hammers were built with a stone hammer, so they keep one;
      // auto-sieves used your best mesh, so they get a copy of it.
      const mesh = tool(s, "mesh");
      s.island.forEach(t => {
        if (t && t.id === "autoHammer" && t.tool === undefined) t.tool = "stoneHammer";
        if (t && t.id === "autoSieve" && t.tool === undefined) t.tool = mesh ? mesh[0] : null;
      });
      s.v = 3;
    }
    if (s.v < 4) s.v = 4; // new grid/queue fields were filled from create(); legacy machines stay fuel-free
    if (s.v < 5) s.v = 5; // v5: buildings can sit in the inventory; nothing on the island changes
    if (s.v < 6) s.v = 6; // v6: land comes from quests (growLand below), the wilds; new fields filled from create()
    s.ev = [];
    growLand(s); // land owed for quests already done
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
    cost, recipeState, maxCraft, craft, visible, hidden, toolKind, landTarget, demolish, pickUp, place, move, placesAs, isPlace, feedBarrels, fullRain, lavaCrucible,
    mixClay, fillBucket, queueSmelt, clearQueue, queueAt, clearAt, stationMax, STATIONS, addFuel, tick,
    insertTool, pullTool, autoPeriod, setSeed, setAuto, unlockArea, level, xpFor, swordDmg, armorBlock, setMob, attack, eat,
    breed, enchant, enchantCost, enchMult, energyCapacity, currentQuest, openQuests, serialize, revive, catchUp,
  };
  root.Alchemy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
