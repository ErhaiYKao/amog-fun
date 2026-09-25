/* Alchemy — panels: work buttons, inventory, crafting, machines. */
(function () {
  "use strict";
  const UI = window.AlchemyUI, { A, D, $ } = UI;
  const { ITEMS, ACTIONS, SMELT, RECIPES, CONFIG: C } = D;
  const { img, name, esc } = UI;
  const TOOLS = new Set(Object.values(C.tools).flat().map(([t]) => t));

  // ---------- work ----------
  const ACT_ICON = { chop: "log", leaves: "leaves", sieve: "sieve", hammer: "woodHammer" };
  const LOCKED = { sieve: "Build a sieve and a mesh to sift dirt for stone.", hammer: "Craft a hammer to smash cobblestone into gravel." };
  function unlocked(s, id) {
    if (id === "sieve") return !!s.seen.sieve;
    if (id === "hammer") return C.tools.hammer.some(([t]) => s.seen[t]);
    return true;
  }
  function detail(s, id, st) {
    if (id === "sieve") {
      const n = A.built(s, "sieve"), m = A.tool(s, "mesh");
      return `${n} sieve${n === 1 ? "" : "s"} · ${m ? name(m[0]) : "no mesh"}`;
    }
    const t = ACTIONS[id].tool && A.tool(s, ACTIONS[id].tool);
    return `${t ? name(t[0]) : "bare hands"} · power ${st.power || 0}/${ACTIONS[id].work}`;
  }
  function renderActions() {
    const s = UI.s;
    let h = "";
    for (const id in ACTIONS) {
      const a = ACTIONS[id];
      if (!unlocked(s, id)) {
        h += `<div class="act off"><button class="go" disabled>${img(ACT_ICON[id])}<span><b>${a.verb}</b><br><small class="meta">locked</small></span><span class="k">${a.key}</span></button><div class="why" style="color:var(--muted)">${LOCKED[id]}</div></div>`;
        continue;
      }
      const st = A.actionState(s, id);
      const hammer = id === "hammer" && A.tool(s, "hammer");
      const chips = a.inputs ? `<div class="chips">${Object.keys(a.inputs).filter(k => s.seen[k]).map(k =>
        `<button class="chip" data-act="sel:${id}:${k}" aria-pressed="${s.sel[id] === k}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span></button>`).join("")}</div>` : "";
      h += `<div class="act ${st.ok ? "" : "off"}">
        <button class="go" data-act="act:${id}" ${st.ok ? "" : "disabled"}>${img(hammer ? hammer[0] : ACT_ICON[id])}<span><b>${a.verb}</b><br><small class="meta">${esc(detail(s, id, st))}</small></span><span class="k">${a.key}</span></button>
        <div class="bar green"><i data-w="w:${id}"></i></div>${chips}
        <div class="why">${st.ok ? "" : esc(st.reason)}</div></div>`;
      UI.v("w:" + id, (s.work[id] || 0) / a.work);
    }
    UI.setHTML($("actions"), "actions", h);
  }

  // ---------- inventory ----------
  function renderInventory() {
    const s = UI.s;
    for (const id in ITEMS) UI.v("c:" + id, UI.fmt(A.count(s, id)));
    const ids = Object.keys(ITEMS).filter(id => !ITEMS[id].place && (s.inv[id] || 0) > 0);
    UI.setHTML($("inventory"), "inv", ids.length
      ? ids.map(id => `<div class="slot ${TOOLS.has(id) ? "tool" : ""}" data-tip="${id}">${img(id)}<span class="n" data-v="c:${id}"></span></div>`).join("")
      : `<p class="empty">Nothing yet. Chop the tree.</p>`);
    UI.setHTML($("invmeta"), "invmeta", `${ids.length} kinds`);
  }

  // ---------- crafting ----------
  function renderCrafting() {
    const s = UI.s;
    const rows = RECIPES.filter(r => A.visible(s, r)).map(r => ({ r, st: A.recipeState(s, r) }))
      .filter(x => UI.filter !== "can" || x.st.ok)
      .sort((a, b) => b.st.ok - a.st.ok);
    const h = rows.map(({ r, st }) => {
      const [outId, outN] = Object.entries(r.out)[0];
      const place = ITEMS[outId].place;
      const title = r.name === "Transmute" ? `Transmute into ${name(outId)}` : r.name || name(outId);
      const extra = Object.entries(r.out).slice(1).map(([k, n]) => `+ ${n} ${name(k)}`).join(" ");
      const ings = Object.entries(r.in).map(([k, n]) =>
        `<span class="ing ${A.count(s, k) < n ? "lack" : ""}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span>/${n}</span>`).join("") +
        Object.keys(r.needs || {}).map(k => `<span class="ing need" data-tip="${k}">${img(k, "sm")}needs</span>`).join("");
      const why = !st.ok && st.reason !== "missing ingredients" ? `<div class="meta">${esc(st.reason)}</div>` : "";
      const max = st.ok && !place ? A.maxCraft(s, r) : 0;
      UI.v("m:" + r.id, max);
      return `<div class="rec ${st.ok ? "" : "no"}"><span data-tip="${outId}">${img(outId)}</span>
        <div><div class="name">${esc(title)}${outN > 1 ? ` <small>×${outN}</small>` : ""}${extra ? ` <small>${esc(extra)}</small>` : ""}${place ? " <small>· takes a tile</small>" : ""}</div><div class="ings">${ings}</div>${why}</div>
        <div class="btns"><button class="mini" data-act="craft:${r.id}:1" ${st.ok ? "" : "disabled"}>Craft</button>${max > 1 ? `<button class="mini" data-act="craft:${r.id}:max">×<span data-v="m:${r.id}"></span></button>` : ""}</div></div>`;
    }).join("");
    UI.setHTML($("crafting"), "craft", h || `<p class="empty">No recipes yet. Everything starts with a log.</p>`);
    UI.setHTML($("craftfilter"), "cf", ["all", "can"].map(f =>
      `<button class="chip" style="padding-left:9px" data-act="filter:${f}" aria-pressed="${UI.filter === f}">${f === "all" ? "all" : "can craft"}</button>`).join(""));
  }

  // ---------- machines ----------
  const sec = (icon, title, body) => `<div class="mach"><div class="row">${img(icon, "sm")}<b>${esc(title)}</b></div>${body}</div>`;
  const units = (list, fn) => `<div class="units">${list.map(fn).join("")}</div>`;
  const unit = (text, bar, cls = "") => `<div class="unit"><span data-v="${text}"></span><div class="bar ${cls}"><i data-w="${bar}"></i></div></div>`;
  const chipCount = id => `<span class="chip" data-tip="${id}" style="cursor:default">${img(id, "sm")}<span data-v="c:${id}"></span></span>`;
  const HEAT = ["", "wood", "charcoal", "coal"];

  function renderMachines() {
    const s = UI.s;
    const tiles = id => s.island.filter(t => t && t.id === id);
    const parts = [];

    const trees = tiles("tree");
    if (trees.length) {
      const growing = trees.filter(t => t.grow < 1).length;
      parts.push(sec("tree", `Oak Trees ×${trees.length}`, `<div class="row meta">${growing ? `${growing} growing · ` : ""}grown trees drop leaves every ${C.tree.litter} s</div>`));
    }

    const barrels = tiles("barrel");
    if (barrels.length) {
      barrels.forEach((t, k) => {
        UI.v(`bw:${k}`, t.time > 0 ? 1 - t.time / C.barrel.time : t.fill / C.barrel.units);
        UI.v(`bt:${k}`, t.time > 0 ? `rotting ${Math.ceil(t.time)}s` : `compost ${t.fill}/${C.barrel.units}`);
      });
      parts.push(sec("barrel", `Oak Barrels ×${barrels.length}`,
        `<div class="row"><label><input type="checkbox" data-opt="feedBarrels" ${s.opt.feedBarrels ? "checked" : ""}> auto-feed</label>` +
        `<label><input type="checkbox" data-opt="compostSaplings" ${s.opt.compostSaplings ? "checked" : ""}> compost saplings</label>` +
        `<button class="mini" data-act="loadbarrels">Load now</button></div>` + units(barrels, (_, k) => unit(`bt:${k}`, `bw:${k}`, "green"))));
    }

    const rain = tiles("rainBarrel");
    if (rain.length) {
      rain.forEach((t, k) => { UI.v(`rw:${k}`, t.water); UI.v(`rt:${k}`, t.water >= 1 ? "full" : `${Math.floor(t.water * 100)}%`); });
      const full = !!A.fullRain(s);
      UI.v("d:clay", !(full && A.count(s, "dust") > 0));
      UI.v("d:water", !(full && A.count(s, "bucket") > 0));
      parts.push(sec("rainBarrel", `Rain Barrels ×${rain.length}`,
        `<div class="row"><button class="mini" data-act="clay" data-d="d:clay">Mix clay · 1 dust</button><button class="mini" data-act="bucket:water" data-d="d:water">Fill a bucket</button></div>` +
        units(rain, (_, k) => unit(`rt:${k}`, `rw:${k}`, "water"))));
    }

    const inf = tiles("infested");
    if (inf.length) {
      UI.v("inf:w", inf[0].t / C.infested.time);
      parts.push(sec("infested", `Infested Leaves ×${inf.length}`, `<div class="row meta">each colony spins 1 string every ${C.infested.time} s</div><div class="bar"><i data-w="inf:w"></i></div>`));
    }

    const furn = A.built(s, "furnace");
    if (furn) {
      const fuelRows = [1, 2, 3].map(h => {
        UI.v(`fw:${h}`, Math.min(1, s.fuel[h] / 120));
        UI.v(`ft:${h}`, s.fuel[h] > 0 ? UI.secs(s.fuel[h]) : "empty");
        return `<span>heat ${h} · ${HEAT[h]}</span><div class="bar warm"><i data-w="fw:${h}"></i></div><span data-v="ft:${h}"></span>`;
      }).join("");
      const fuels = Object.keys(ITEMS).filter(id => ITEMS[id].fuel && A.count(s, id) > 0);
      const smelts = Object.keys(SMELT).filter(id => A.count(s, id) > 0);
      const slots = [];
      for (let i = 0; i < furn; i++) {
        const job = s.slots[i];
        UI.v(`sw:${i}`, job ? job.p : 0);
        slots.push(`<div class="unit" style="grid-column: span 2"><span>${job ? (job.stalled ? `needs ${HEAT[SMELT[job.id].heat]} heat` : esc(`${name(job.id)} → ${name(SMELT[job.id].out)}`)) : "idle"}</span><div class="bar warm"><i data-w="sw:${i}"></i></div></div>`);
      }
      parts.push(sec("furnace", `Furnaces ×${furn}`,
        `<div class="fuel">${fuelRows}</div>` +
        (fuels.length ? `<div class="row"><span class="meta">fuel</span>${fuels.map(id => `<span class="grp">${chipCount(id)}<button class="mini" data-act="fuel:${id}:1">+1</button><button class="mini" data-act="fuel:${id}:all">all</button></span>`).join("")}</div>` : "") +
        (smelts.length ? `<div class="row"><span class="meta">smelt</span>${smelts.map(id => `<span class="grp">${chipCount(id)}<button class="mini" data-act="smelt:${id}:1">+1</button><button class="mini" data-act="smelt:${id}:all">all</button></span>`).join("")}</div>`
          : `<div class="row meta">Nothing smeltable in your inventory.</div>`) +
        `<div class="units">${slots.join("")}</div>` +
        (s.queue.length ? `<div class="row meta">queued: ${esc(s.queue.map(q => `${q.n} ${name(q.id)}`).join(", "))} <button class="mini" data-act="clearq">clear</button></div>` : "")));
    }

    const cru = tiles("crucible");
    if (cru.length) {
      cru.forEach((t, k) => { UI.v(`lw:${k}`, t.lava / C.crucible.lava); UI.v(`lt:${k}`, `${t.lava} mB`); });
      UI.v("d:lava", !(A.lavaCrucible(s) && A.count(s, "bucket") > 0));
      parts.push(sec("crucible", `Crucibles ×${cru.length}`,
        `<div class="row"><label><input type="checkbox" data-opt="feedCrucible" ${s.opt.feedCrucible ? "checked" : ""}> melt cobblestone</label><button class="mini" data-act="bucket:lava" data-d="d:lava">Fill a bucket · 1000 mB</button></div>` +
        units(cru, (_, k) => unit(`lt:${k}`, `lw:${k}`, "warm"))));
    }

    const gens = A.built(s, "cobblegen");
    if (gens) {
      const p = A.tool(s, "pick");
      parts.push(sec("cobblegen", `Cobblestone Generators ×${gens}`, `<div class="row meta">${p ? `${esc(name(p[0]))} · ${(p[1] * gens).toFixed(2)} cobblestone/s` : "Needs a pickaxe to mine."}</div>`));
    }

    for (const [id, inputs] of [["autoHammer", Object.keys(ACTIONS.hammer.inputs)], ["autoSieve", Object.keys(ACTIONS.sieve.inputs)]]) {
      const list = tiles(id);
      if (!list.length) continue;
      list.forEach((t, k) => UI.v(`${id}:${k}`, t.idle ? 0 : t.t / C[id].time));
      const sel = s.sel[id], idle = list.some(t => t.idle);
      const wait = idle ? `<div class="row meta">waiting for ${esc(name(sel).toLowerCase())}${C.reserve[sel] ? ` (leaves ${C.reserve[sel]} for crafting)` : ""}${id === "autoSieve" && !A.toolValue(s, "mesh") ? " and a mesh" : ""}</div>` : "";
      parts.push(sec(id, `${name(id)}s ×${list.length}`,
        `<div class="row"><span class="meta">input</span><div class="chips">${inputs.map(k => `<button class="chip" data-act="auto:${id}:${k}" aria-pressed="${sel === k}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span></button>`).join("")}</div></div>` +
        wait + units(list, (_, k) => `<div class="unit"><div class="bar"><i data-w="${id}:${k}"></i></div></div>`)));
    }

    UI.setHTML($("machines"), "mach", parts.join("") || `<p class="empty">Machines you build show up here.</p>`);
  }

  Object.assign(UI.handlers, {
    sel: ([act, k]) => { UI.s.sel[act] = k; },
    auto: ([id, k]) => { UI.s.sel[id] = k; },
    filter: ([f]) => { UI.filter = f; },
    craft: ([rid, n]) => {
      const r = RECIPES.find(x => x.id === rid);
      A.craft(UI.s, r, n === "max" ? A.maxCraft(UI.s, r) : +n);
    },
    expand: () => A.expand(UI.s),
    fuel: ([id, n]) => A.addFuel(UI.s, id, n === "all" ? Infinity : +n),
    smelt: ([id, n]) => A.queueSmelt(UI.s, id, n === "all" ? Infinity : +n),
    clearq: () => A.clearQueue(UI.s),
    clay: () => A.mixClay(UI.s),
    bucket: ([k]) => A.fillBucket(UI.s, k),
    loadbarrels: () => A.feedBarrels(UI.s),
  });
  UI.renderers.push(renderInventory, renderActions, renderCrafting, renderMachines);
})();
