/* Alchemy — panels: work buttons, inventory, crafting (with furnace / alloy tabs), machines. */
(function () {
  "use strict";
  const UI = window.AlchemyUI, { A, D, $ } = UI;
  const { ITEMS, ACTIONS, SMELT, ALLOY, CROPS, RECIPES, CONFIG: C } = D;
  const { img, name, esc } = UI;
  const TOOLS = new Set(Object.values(C.tools).flat().map(([t]) => t));
  const HEAT = ["", "wood", "charcoal", "coal"];

  // ---------- where does an item come from (besides crafting)? ----------
  const MESH = C.tools.mesh; // [[id, tier]]
  const num = x => (x >= 1 ? x.toFixed(1) : x >= 0.1 ? x.toFixed(2) : x.toFixed(3));
  function sources(id) {
    const out = [];
    const add = t => { if (!out.includes(t)) out.push(t); };
    for (const k of ["chop", "leaves", "mine"]) if (ACTIONS[k].drops.some(d => d[0] === id)) add(ACTIONS[k].name.toLowerCase());
    const sieved = Object.entries(D.SIEVE).filter(([, table]) => table.some(d => d[0] === id)).map(([inp]) => name(inp).toLowerCase());
    if (sieved.length) add(`sieving ${sieved.join(", ")}`);
    for (const [inp, t] of Object.entries(ACTIONS.hammer.inputs)) if (t.some(d => d[0] === id)) add(`hammering ${name(inp).toLowerCase()}`);
    for (const [inp, t] of Object.entries(ACTIONS.chammer.inputs)) if (t.some(d => d[0] === id)) add(`heavy-smashing ${name(inp).toLowerCase()} with a compressed hammer (9 at once)`);
    for (const [inp, r] of Object.entries(SMELT)) if (r.out === id) add(`smelting ${name(inp).toLowerCase()} (Furnace tab)`);
    if (ALLOY[id]) add(`the alloy smelter (Alloy tab)`);
    for (const [st, cfg] of Object.entries(D.ELECTRIC))
      if (Object.values(cfg.recipes).some(r => r.out === id)) add(`the ${name(st).toLowerCase()} (${name(st)} tab)`);
    if (C.harvester.drops[id]) add("a powered tree harvester");
    for (const [seed, c] of Object.entries(CROPS)) if (c.drops.some(d => d[0] === id)) add(`farmland planted with ${name(seed).toLowerCase()}`);
    if (C.tree.drops.some(d => d[0] === id)) add("grown trees drop it");
    if (C.infested.drops.some(d => d[0] === id)) add("infested leaves spin it");
    if (id === "dirt") add("barrels rot compost into it");
    if (id === "clayBlock") add("mixing dust into a full rain barrel");
    if (id === "waterBucket") add("filling a bucket at a full rain barrel");
    if (id === "lavaBucket") add("filling a bucket at a crucible with 1000 mB of lava");
    if (id === "cobble") add("four pebbles, or cobblestone generators");
    return out;
  }
  UI.sources = sources;

  // ---------- work ----------
  const ACT_ICON = { chop: "log", leaves: "leaves", sieve: "sieve", hammer: "woodHammer", chammer: "cHammer", hsieve: "heavySieve", mine: "stonePick" };
  const LOCKED = {
    sieve: "Build a sieve and a mesh to sift dirt for stone.",
    hammer: "Craft a hammer to smash cobblestone into gravel.",
    chammer: "Craft a compressed hammer (compressed cobblestone + iron) to smash compressed blocks 9 at a time.",
    hsieve: "Build a heavy sieve (sieve + compressed cobblestone + iron) to sieve compressed blocks.",
    mine: "Build a cobblestone generator (water + lava) and mine it with a pickaxe.",
  };
  function unlocked(s, id) {
    if (id === "sieve") return !!s.seen.sieve;
    if (id === "hsieve") return !!s.seen.heavySieve;
    if (id === "mine") return !!s.seen.cobblegen;
    if (id === "hammer" || id === "chammer") return C.tools[ACTIONS[id].tool].some(([t]) => s.seen[t]);
    return true;
  }
  function detail(s, id, st) {
    if (id === "sieve" || id === "hsieve") {
      const n = A.built(s, ACTIONS[id].per), m = A.tool(s, "mesh");
      return `${n} ${name(ACTIONS[id].per).toLowerCase()}${n === 1 ? "" : "s"} · ${m ? name(m[0]) : "no mesh"}`;
    }
    if (id === "mine") {
      const n = A.built(s, "cobblegen"), p = A.tool(s, "pick");
      return `${p ? name(p[0]) : "no pickaxe"} · ${n} gen${n === 1 ? "" : "s"} · power ${st.power || 0}/${ACTIONS[id].work}`;
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
        // only tease the next locked late-game actions once you're close to them
        if ((id === "chammer" || id === "hsieve") && !s.seen.iron) continue;
        h += `<div class="act off"><button class="go" disabled>${img(ACT_ICON[id])}<span><b>${a.verb}</b><br><small class="meta">locked</small></span><span class="k">${a.key}</span></button><div class="why" style="color:var(--muted)">${LOCKED[id]}</div></div>`;
        continue;
      }
      const st = A.actionState(s, id);
      const held = (id === "hammer" || id === "chammer" || id === "mine") && A.tool(s, a.tool);
      const chips = a.inputs ? `<div class="chips">${Object.keys(a.inputs).filter(k => s.seen[k]).map(k =>
        `<button class="chip" data-act="sel:${id}:${k}" aria-pressed="${s.sel[id] === k}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span></button>`).join("")}</div>` : "";
      h += `<div class="act ${st.ok ? "" : "off"}">
        <button class="go" data-act="act:${id}" ${st.ok ? "" : "disabled"}>${img(held ? held[0] : ACT_ICON[id])}<span><b>${a.verb}</b><br><small class="meta">${esc(detail(s, id, st))}</small></span><span class="k">${a.key}</span></button>
        <div class="bar green"><i data-w="w:${id}"></i></div>${chips}${a.mesh ? `<button class="linkish" data-act="drops">drop rates</button>` : ""}
        <div class="why">${st.ok ? "" : esc(st.reason)}</div></div>`;
      UI.v("w:" + id, (s.work[id] || 0) / a.work);
    }
    UI.setHTML($("actions"), "actions", h);
    renderDrops();
  }

  // ---------- sieve drop table ----------
  function renderDrops() {
    const s = UI.s, box = $("drops-box");
    box.hidden = !s.seen.sieve;
    if (box.hidden) return;
    const cur = A.toolValue(s, "mesh");
    const head = `<tr><th>per sift</th>${MESH.map(([m, tier]) => `<th class="${tier === cur ? "cur" : ""}">${s.seen[m] ? esc(name(m).replace(" Mesh", "")) : "?"}</th>`).join("")}</tr>`;
    let body = "";
    for (const input in D.SIEVE) {
      if (!s.seen[input]) continue;
      body += `<tr class="in"><td colspan="${MESH.length + 1}"><span class="item">${img(input, "sm")}${esc(name(input))}</span></td></tr>`;
      const ids = [...new Set(D.SIEVE[input].map(e => e[0]))];
      for (const id of ids) {
        const cells = MESH.map(([, tier]) => {
          let ev = 0, gated = true;
          for (const [d, p, n = 1, gate] of D.SIEVE[input]) {
            if (d !== id || (typeof gate === "number" && tier < gate)) continue;
            gated = false;
            ev += Math.min(1, p * C.meshLuck[tier]) * n;
          }
          return `<td class="${gated ? "na" : ""} ${tier === cur ? "cur" : ""}">${gated ? "—" : num(ev)}</td>`;
        }).join("");
        body += `<tr><td>${s.seen[id] ? `<span class="item">${img(id, "sm")}${esc(name(id))}</span>` : "???"}</td>${cells}</tr>`;
      }
    }
    UI.setHTML($("drops"), "drops", `<table>${head}${body}</table><p>Average number of each item per sift, by mesh (your best mesh is highlighted). — means that mesh is too coarse to catch it. ??? is something you haven't found yet. A heavy sieve rolls the same table 7 times per compressed block.</p>`);
  }

  // ---------- inventory ----------
  function renderInventory() {
    const s = UI.s;
    for (const id in ITEMS) UI.v("c:" + id, UI.fmt(A.count(s, id)));
    const owned = Object.keys(ITEMS).filter(id => !ITEMS[id].place && (s.inv[id] || 0) > 0);
    // only your best tool of each kind; the older ones still count for recipes that eat them
    const best = id => { const tk = A.toolKind(id); return !tk || A.tool(s, tk[0])[0] === id; };
    const ids = owned.filter(best), older = owned.length - ids.length;
    UI.setHTML($("inventory"), "inv", ids.length
      ? ids.map(id => `<div class="slot ${TOOLS.has(id) ? "tool" : ""}" data-tip="${id}" data-act="focus:${id}">${img(id)}<span class="n" data-v="c:${id}"></span></div>`).join("")
      : `<p class="empty">Nothing yet. Chop the tree.</p>`);
    UI.setHTML($("invmeta"), "invmeta", `${ids.length} kinds${older ? ` · ${older} older tool${older === 1 ? "" : "s"} hidden` : ""}`);
  }

  // ---------- crafting: one list per station (table, furnace, alloy smelter) ----------
  UI.tab = "craft";
  UI.search = "";
  UI.focus = null; // item id: show only the recipes that make it, plus where else it comes from
  UI.amount = 1;
  const TABS = [["craft", "Crafting"], ["furnace", "Furnace"], ["alloy", "Alloy"], ...Object.keys(D.ELECTRIC).map(id => [id, name(id)])];
  const tabOpen = (s, t) => t === "craft" || !!s.seen[t];

  function craftRow(s, r) {
    const [outId, outN] = Object.entries(r.out)[0];
    const st = A.recipeState(s, r), place = !!ITEMS[outId].place;
    const title = r.name === "Transmute" ? `Transmute into ${name(outId)}` : r.name === "Uncompress" ? `${name(outId)} (uncompress)` : r.name || name(outId);
    const max = st.ok && !place ? A.maxCraft(s, r) : 0;
    return {
      key: r.key, station: "craft", r, outId, outN, title, place, ok: st.ok, max,
      why: !st.ok && st.reason !== "missing ingredients" ? st.reason : "",
      hid: A.hidden(s, r), extra: Object.entries(r.out).slice(1).map(([k, n]) => `+ ${n} ${name(k)}`).join(" "),
      ings: Object.entries(A.cost(s, r)), needs: Object.keys(r.needs || {}),
      note: r.scale ? `pricier with each ${name(r.scale.per).toLowerCase()}` : "",
    };
  }
  function stationRow(s, st, id) {
    const rec = A.STATIONS[st].rec(id), key = `${st}|${id}`, max = A.stationMax(s, st, id);
    return {
      key, station: st, id, outId: rec.out, outN: rec.n, title: name(rec.out), place: false, ok: max > 0, max,
      why: A.built(s, st) ? "" : `build a ${name(st).toLowerCase()}`,
      hid: s.hide[key] === 1 ? "user" : null, extra: "", ings: Object.entries(rec.in), needs: [],
      note: A.STATIONS[st].watts ? `${A.STATIONS[st].watts} W · ${rec.time} s · ${A.STATIONS[st].watts * rec.time} J/job` : `heat ${rec.heat} (${HEAT[rec.heat]}) · ${rec.time} s`,
    };
  }
  function rowsFor(s, tab) {
    if (tab === "craft") return RECIPES.filter(r => A.visible(s, r)).map(r => craftRow(s, r));
    const list = Object.keys(tab === "furnace" ? SMELT : tab === "alloy" ? ALLOY : D.ELECTRIC[tab].recipes);
    return list.filter(id => Object.keys(A.STATIONS[tab].rec(id).in).some(k => s.seen[k])).map(id => stationRow(s, tab, id));
  }
  const matches = (row, q) => [row.title, name(row.outId), ...row.ings.map(([k]) => name(k))].some(t => t.toLowerCase().includes(q));

  function rowHTML(s, x, sep) {
    const amt = Math.max(1, UI.amount | 0);
    const ings = x.ings.map(([k, n]) =>
      `<span class="ing ${A.count(s, k) < n ? "lack" : ""}" data-tip="${k}" data-act="focus:${k}">${img(k, "sm")}<span data-v="c:${k}"></span>/${n}</span>`).join("") +
      x.needs.map(k => `<span class="ing need" data-tip="${k}" data-act="focus:${k}">${img(k, "sm")}needs</span>`).join("");
    const tag = UI.focus && x.station !== "craft" ? ` <small>· ${name(x.station).toLowerCase()}</small>` : "";
    const note = x.hid === "auto" ? " <small>· you have this or better</small>" : x.hid ? " <small>· hidden</small>" : x.note ? ` <small>· ${esc(x.note)}</small>` : "";
    const rid = x.station === "craft" ? x.r.id : `${x.station}|${x.id}`;
    UI.v("m:" + rid, x.max < 2 ? "max" : x.max);
    UI.v("md:" + rid, x.max < 2);
    const one = x.station === "craft"
      ? `<button class="mini" data-act="craft:${x.r.id}:${amt}" ${x.ok ? "" : "disabled"}>Craft${amt > 1 && !x.place ? ` ×${amt}` : ""}</button>${x.place ? "" : `<button class="mini" data-act="craft:${x.r.id}:max" data-d="md:${rid}">×<span data-v="m:${rid}"></span></button>`}`
      : `<button class="mini" data-act="queue:${x.station}:${x.id}:${amt}" ${x.ok ? "" : "disabled"}>Queue${amt > 1 ? ` ×${amt}` : ""}</button><button class="mini" data-act="queue:${x.station}:${x.id}:max" data-d="md:${rid}">×<span data-v="m:${rid}"></span></button>`;
    return `${sep}<div class="rec ${x.ok ? "" : "no"} ${x.hid ? "hid" : ""}"><span data-tip="${x.outId}">${img(x.outId)}</span>
      <div><div class="name">${esc(x.title)}${x.outN > 1 ? ` <small>×${x.outN}</small>` : ""}${x.extra ? ` <small>${esc(x.extra)}</small>` : ""}${x.place ? " <small>· takes a tile</small>" : ""}${tag}${note}</div><div class="ings">${ings}</div>${x.why ? `<div class="meta">${esc(x.why)}</div>` : ""}</div>
      <div class="btns">${one}<button class="eye" data-act="hide:${esc(x.key)}" title="${x.hid ? "show this recipe again" : "hide this recipe"}">${x.hid ? "show" : "hide"}</button></div></div>`;
  }

  function renderCrafting() {
    const s = UI.s;
    if (!tabOpen(s, UI.tab)) UI.tab = "craft";
    let rows, focusHTML = "";
    if (UI.focus) {
      const id = UI.focus;
      rows = [...RECIPES.filter(r => r.out[id]).map(r => craftRow(s, r)),
        ...Object.keys(SMELT).filter(k => SMELT[k].out === id).map(k => stationRow(s, "furnace", k)),
        ...(ALLOY[id] ? [stationRow(s, "alloy", id)] : []),
        ...Object.entries(D.ELECTRIC).flatMap(([st, cfg]) => Object.keys(cfg.recipes).filter(k => cfg.recipes[k].out === id).map(k => stationRow(s, st, k)))];
      const src = sources(id), uses = RECIPES.filter(r => r.in[id]).length;
      focusHTML = `<div class="top">${img(id, "sm")}<b>${esc(name(id))}</b><span class="meta">${rows.length ? `${rows.length} recipe${rows.length === 1 ? "" : "s"} make it` : "no recipe makes it"}</span>
        ${uses ? `<button class="mini" data-act="usedin:${id}">used in ${uses}</button>` : ""}<button class="mini" data-act="unfocus">× back to all</button></div>
        ${src.length ? `<div class="meta">also from:</div><ul>${src.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`;
    } else {
      rows = rowsFor(s, UI.tab);
      const q = UI.search.trim().toLowerCase();
      if (q) rows = rows.filter(x => matches(x, q));
      rows = rows.filter(x => UI.filter !== "can" || (x.ok && !x.hid)).sort((a, b) => !!a.hid - !!b.hid || b.ok - a.ok);
    }
    const firstHid = UI.focus ? -1 : rows.findIndex(x => x.hid);
    const h = rows.map((x, i) => rowHTML(s, x, i === firstHid ? `<div class="rec-sep">hidden · ${rows.length - firstHid}</div>` : "")).join("");
    const empty = UI.focus ? "" : UI.search ? "No recipe matches that search." : UI.tab === "craft" ? "No recipes yet. Everything starts with a log." : "Nothing you own can go in here yet.";
    UI.setHTML($("crafting"), "craft", h || `<p class="empty">${empty}</p>`);
    UI.setHTML($("craftfocus"), "cfocus", focusHTML);
    UI.setHTML($("crafttabs"), "ctabs", TABS.filter(([t]) => tabOpen(s, t)).map(([t, l]) => `<button data-act="tab:${t}" aria-pressed="${!UI.focus && UI.tab === t}">${l}</button>`).join(""));
    UI.setHTML($("craftfilter"), "cf", ["all", "can"].map(f =>
      `<button class="chip" style="padding-left:9px" data-act="filter:${f}" aria-pressed="${UI.filter === f}">${f === "all" ? "all" : "can craft"}</button>`).join(""));
    UI.setHTML($("craftamt"), "camt", [1, 5, 10, 25, 64].map(n => `<button class="chip" data-act="amt:${n}" aria-pressed="${UI.amount === n}">${n}</button>`).join(""));
  }
  $("craftsearch").addEventListener("input", e => { UI.search = e.target.value; UI.focus = null; UI.render(); });
  $("craftn").addEventListener("input", e => { UI.amount = Math.max(1, Math.min(999, e.target.value | 0 || 1)); UI.render(); });

  // ---------- machines ----------
  // each section folds away when you click its header (remembered in the save)
  function sec(s, id, icon, title, summary, body) {
    const folded = !!s.fold[id];
    return `<div class="mach"><div class="row mhead" data-act="fold:${id}">${img(icon, "sm")}<b>${esc(title)}</b>${summary ? `<span class="meta">${esc(summary)}</span>` : ""}<span class="fold">${folded ? "▸ show" : "▾"}</span></div>${folded ? "" : body}</div>`;
  }
  const units = (list, fn) => `<div class="units">${list.map(fn).join("")}</div>`;
  const unit = (text, bar, cls = "") => `<div class="unit"><span data-v="${text}"></span><div class="bar ${cls}"><i data-w="${bar}"></i></div></div>`;
  const chipCount = id => `<span class="chip" data-tip="${id}" style="cursor:default">${img(id, "sm")}<span data-v="c:${id}"></span></span>`;

  function stationSlots(s, st) {
    const S = A.STATIONS[st], n = A.built(s, st), q = s[S.q];
    let h = "";
    for (let i = 0; i < n; i++) {
      const job = s[S.sl][i], rec = job && S.rec(job.id);
      UI.v(`${st}w:${i}`, job ? job.p : 0);
      h += `<div class="unit" style="grid-column: span 2"><span>${job ? (job.stalled ? (S.watts ? "waiting for energy" : `needs ${HEAT[rec.heat]} heat`) : esc(st === "furnace" ? `${name(job.id)} → ${name(rec.out)}` : `→ ${name(rec.out)}`)) : "idle"}</span><div class="bar warm"><i data-w="${st}w:${i}"></i></div></div>`;
    }
    return `<div class="units">${h}</div>` +
      (q.length ? `<div class="row meta">queued: ${esc(q.map(j => `${j.n} × ${name(S.rec(j.id).out)}`).join(", "))} <button class="mini" data-act="clearq:${st}">clear</button></div>` : "") +
      `<div class="row meta">queue jobs from the <button class="linkish" data-act="tab:${st}:go">${st === "alloy" ? "Alloy" : name(st)} tab</button> in the crafting panel</div>`;
  }

  function renderMachines() {
    const s = UI.s;
    const tiles = id => s.island.filter(t => t && t.id === id);
    const parts = [];

    const capacity = A.energyCapacity(s);
    if (capacity || Object.keys(D.ELECTRIC).some(id => A.built(s, id)) || A.built(s, "treeHarvester")) {
      UI.v("energy:stored", `${Math.floor(s.energy).toLocaleString()} / ${capacity.toLocaleString()} J`);
      UI.v("energy:bar", capacity ? s.energy / capacity : 0);
      UI.v("energy:flow", `${s.power.generated.toFixed(1)} W generated · ${s.power.used.toFixed(1)} W used`);
      const generators = s.island.map((t, i) => [t, i]).filter(([t]) => t && D.POWER[t.id]?.watts);
      const controls = generators.map(([t, i]) => {
        const cfg = D.POWER[t.id];
        UI.v(`power:${i}`, `${(t.output || 0).toFixed(1)} / ${cfg.watts} W${cfg.fuels ? ` · ${Math.ceil(t.fuelJ)} J of loaded fuel left` : ""}`);
        const fuel = cfg.fuels ? Object.entries(cfg.fuels).map(([id, joules]) => `<button class="chip" data-act="genfuel:${i}:${id}" aria-pressed="${t.fuel === id}" data-tip="${id}">${img(id, "sm")}${name(id)} · ${joules.toLocaleString()} J</button>`).join("") : "";
        return `<div class="unitrow"><b>${esc(name(t.id))} #${i + 1}</b><button class="mini" data-act="power:${i}" aria-pressed="${t.enabled !== false}">${t.enabled === false ? "Resume" : "Pause"}</button><span class="meta" data-v="power:${i}"></span></div>${fuel ? `<div class="chips">${fuel}</div>` : ""}`;
      }).join("");
      parts.push(sec(s, "energy", "battery", "Energy grid", "1 W = 1 J/s",
        `<div class="row"><b data-v="energy:stored"></b><span class="meta" data-v="energy:flow"></span></div><div class="bar"><i data-w="energy:bar"></i></div>` +
        `<p class="meta">All machines connect automatically. Generators pause at full storage; fuel generators auto-feed the selected fuel from inventory. Switching fuel finishes the loaded item first. More generators increase supply; energy cells increase storage. Queued machines draw first, then harvesters.</p>` +
        (capacity ? "" : `<p class="meta">Build a fuel or solar generator to supply energy.</p>`) + controls));
    }
    for (const id of Object.keys(D.ELECTRIC)) {
      const n = A.built(s, id);
      if (n) parts.push(sec(s, id, id, `${name(id)} ×${n}`, `${D.ELECTRIC[id].watts} W each`, stationSlots(s, id)));
    }
    const harvesters = s.island.map((t, i) => [t, i]).filter(([t]) => t && t.id === "treeHarvester");
    if (harvesters.length) parts.push(sec(s, "treeHarvester", "treeHarvester", `Tree Harvesters ×${harvesters.length}`, `${C.harvester.watts} W each`,
      `<p class="meta">Each harvest uses ${C.harvester.watts * C.harvester.time} J for 4 logs, 4 leaves and a sapling. Trees are replanted and regrow in ${C.tree.grow} s.</p>` + harvesters.map(([t, i], k) => {
        UI.v(`harvest:${i}`, t.p);
        UI.v(`harvest:status:${i}`, t.status || "waiting for a grown tree");
        return `<div class="unitrow"><span>#${k + 1}</span><button class="mini" data-act="power:${i}" aria-pressed="${t.enabled}">${t.enabled ? "Pause" : "Resume"}</button><span class="meta" data-v="harvest:status:${i}"></span><div class="bar green"><i data-w="harvest:${i}"></i></div></div>`;
      }).join("")));

    const trees = tiles("tree");
    if (trees.length) {
      const growing = trees.filter(t => t.grow < 1).length;
      parts.push(sec(s, "tree", "tree", `Oak Trees ×${trees.length}`, growing ? `${growing} growing` : "", `<div class="row meta">grown trees drop leaves every ${C.tree.litter} s</div>`));
    }

    const barrels = tiles("barrel");
    if (barrels.length) {
      barrels.forEach((t, k) => {
        UI.v(`bw:${k}`, t.time > 0 ? 1 - t.time / C.barrel.time : t.fill / C.barrel.units);
        UI.v(`bt:${k}`, t.time > 0 ? `rotting ${Math.ceil(t.time)}s` : `compost ${t.fill}/${C.barrel.units}`);
      });
      parts.push(sec(s, "barrel", "barrel", `Oak Barrels ×${barrels.length}`, "",
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
      parts.push(sec(s, "rainBarrel", "rainBarrel", `Rain Barrels ×${rain.length}`, "",
        `<div class="row"><button class="mini" data-act="clay" data-d="d:clay">Mix clay · 1 dust</button><button class="mini" data-act="bucket:water" data-d="d:water">Fill a bucket</button></div>` +
        units(rain, (_, k) => unit(`rt:${k}`, `rw:${k}`, "water"))));
    }

    const inf = tiles("infested");
    if (inf.length) {
      UI.v("inf:w", inf[0].t / C.infested.time);
      parts.push(sec(s, "infested", "infested", `Infested Leaves ×${inf.length}`, "", `<div class="row meta">each colony spins 1 string every ${C.infested.time} s</div><div class="bar"><i data-w="inf:w"></i></div>`));
    }

    const furn = A.built(s, "furnace"), alloys = A.built(s, "alloy");
    if (furn || alloys) {
      const fuelRows = [1, 2, 3].map(h => {
        UI.v(`fw:${h}`, Math.min(1, s.fuel[h] / 120));
        UI.v(`ft:${h}`, s.fuel[h] > 0 ? UI.secs(s.fuel[h]) : "empty");
        return `<span>heat ${h} · ${HEAT[h]}</span><div class="bar warm"><i data-w="fw:${h}"></i></div><span data-v="ft:${h}"></span>`;
      }).join("");
      const fuels = Object.keys(ITEMS).filter(id => ITEMS[id].fuel && A.count(s, id) > 0);
      const fuelHTML = `<div class="fuel">${fuelRows}</div>` +
        (fuels.length ? `<div class="row"><span class="meta">fuel</span>${fuels.map(id => `<span class="grp">${chipCount(id)}<button class="mini" data-act="fuel:${id}:1">+1</button><button class="mini" data-act="fuel:${id}:all">all</button></span>`).join("")}</div>` : "");
      if (furn) parts.push(sec(s, "furnace", "furnace", `Furnaces ×${furn}`, s.queue.length ? `${s.queue.reduce((a, q) => a + q.n, 0)} queued` : "", fuelHTML + stationSlots(s, "furnace")));
      if (alloys) parts.push(sec(s, "alloy", "alloy", `Alloy Smelters ×${alloys}`, s.aqueue.length ? `${s.aqueue.reduce((a, q) => a + q.n, 0)} queued` : "",
        `<div class="row meta">burns heat-3 fuel (coal) from the shared fuel store${furn ? " above" : ""}</div>` + (furn ? "" : fuelHTML) + stationSlots(s, "alloy")));
    }

    const cru = tiles("crucible");
    if (cru.length) {
      cru.forEach((t, k) => { UI.v(`lw:${k}`, t.lava / C.crucible.lava); UI.v(`lt:${k}`, `${t.lava} mB`); });
      UI.v("d:lava", !(A.lavaCrucible(s) && A.count(s, "bucket") > 0));
      parts.push(sec(s, "crucible", "crucible", `Crucibles ×${cru.length}`, "",
        `<div class="row"><label><input type="checkbox" data-opt="feedCrucible" ${s.opt.feedCrucible ? "checked" : ""}> melt cobblestone</label><button class="mini" data-act="bucket:lava" data-d="d:lava">Fill a bucket · 1000 mB</button></div>` +
        units(cru, (_, k) => unit(`lt:${k}`, `lw:${k}`, "warm"))));
    }

    const gens = A.built(s, "cobblegen");
    if (gens) {
      const p = A.tool(s, "pick");
      parts.push(sec(s, "cobblegen", "cobblegen", `Cobblestone Generators ×${gens}`, "", `<div class="row meta">${p ? `mine them from the Work panel (key 5) · ${esc(name(p[0]).toLowerCase())} + ${gens} generator${gens === 1 ? "" : "s"} = ${p[1] + gens} power per swing` : "Needs a pickaxe to mine."}</div>`));
    }

    const autoGens = s.island.filter(t => t && C.autoGen[t.id]);
    if (autoGens.length) {
      const rate = autoGens.reduce((a, t) => a + C.autoGen[t.id], 0);
      const by = Object.keys(C.autoGen).map(id => [id, tiles(id).length]).filter(([, n]) => n).map(([id, n]) => `${n} × ${name(id).replace("Auto-Generator ", "")}`).join(", ");
      parts.push(sec(s, "autoGen", autoGens[autoGens.length - 1].id, `Auto-Generators ×${autoGens.length}`, `${rate}/s`, `<div class="row meta">${esc(by)} · ${rate} cobblestone/s · upgrade them in the crafting list</div>`));
    }

    // auto machines: each holds its own tool (insert / pull) and has its own input
    for (const id in D.AUTO) {
      const cfg = D.AUTO[id], inputs = Object.keys(ACTIONS[cfg.action].inputs);
      const list = s.island.map((t, i) => [t, i]).filter(([t]) => t && t.id === id);
      if (!list.length) continue;
      const kindName = { hammer: "hammer", mesh: "mesh", chammer: "compressed hammer" }[cfg.kind];
      const owned = C.tools[cfg.kind].filter(([t]) => A.count(s, t) > 0).map(([t]) => t).reverse(); // best first
      const chips = (act, sel) => `<div class="chips">${inputs.filter(k => s.seen[k]).map(k => `<button class="chip" data-act="${act}:${k}" aria-pressed="${sel === k}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span></button>`).join("")}</div>`;
      const rows = list.map(([t, i], k) => {
        UI.v(`${id}:${k}`, t.idle ? 0 : t.t / A.autoPeriod(t));
        const sel = t.sel || s.sel[id];
        const slot = t.tool
          ? `<span class="toolslot full" data-tip="${t.tool}">${img(t.tool, "sm")}${esc(name(t.tool))}</span><button class="mini" data-act="pull:${i}">pull out</button>`
          : `<span class="toolslot">no ${kindName}</span>`;
        const insert = owned.filter(o => o !== t.tool).map(o => `<button class="chip" data-act="insert:${i}:${o}" data-tip="${o}" title="insert">${img(o, "sm")}<span>insert</span></button>`).join("");
        const wait = t.idle ? `<div class="row meta">#${k + 1} ${t.tool ? `waiting for ${esc(name(sel).toLowerCase())}${C.reserve[sel] ? ` (leaves ${C.reserve[sel]} for crafting)` : ""}` : `needs a ${kindName}: insert one from your inventory`}</div>` : "";
        const speed = t.tool && cfg.kind !== "mesh" ? ` <span class="meta">${A.autoPeriod(t).toFixed(1)} s each</span>` : "";
        return `<div class="unitrow"><span class="no">#${k + 1}</span>${slot}${insert}${speed}</div><div class="unitrow"><span class="no"></span>${chips(`autot:${i}`, sel)}<div class="bar"><i data-w="${id}:${k}"></i></div></div>${wait}`;
      }).join("");
      const all = list.length > 1 ? `<div class="row"><span class="meta">set all inputs</span>${chips(`auto:${id}`, null)}</div>` : "";
      const note = cfg.kind === "mesh" ? "the mesh inside decides the drops" : "better hammers work faster";
      parts.push(sec(s, id, id, `${name(id)}s ×${list.length}`, "", `<div class="row meta">${note}; your manual work uses the best one left in your inventory</div>` + all + rows));
    }

    const farms = s.island.map((t, i) => [t, i]).filter(([t]) => t && t.id === "farmland");
    if (farms.length) {
      const seeds = Object.keys(CROPS).filter(k => s.seen[k]);
      const rows = farms.map(([t, i], k) => {
        UI.v(`farm:${k}`, t.seed ? t.g : 0);
        const chips = seeds.map(sd => `<button class="chip" data-act="seed:${i}:${sd}" aria-pressed="${t.sel === sd}" data-tip="${sd}">${img(sd, "sm")}<span data-v="c:${sd}"></span></button>`).join("") +
          `<button class="chip" style="padding-left:9px" data-act="seed:${i}:" aria-pressed="${!t.sel}">none</button>`;
        const st = t.seed ? `${name(t.seed)} · ${Math.floor(t.g * 100)}%` : t.sel ? `no ${name(t.sel).toLowerCase()} to plant` : "empty";
        UI.v(`farmt:${k}`, st);
        return `<div class="unitrow"><span class="no">#${k + 1}</span><div class="chips">${chips}</div></div><div class="unitrow"><span class="no"></span><span class="meta" data-v="farmt:${k}"></span><div class="bar green"><i data-w="farm:${k}"></i></div></div>`;
      }).join("");
      parts.push(sec(s, "farmland", "farmland", `Farmland ×${farms.length}`, "", `<div class="row meta">a planted seed stays and regrows forever; switching seeds hands the old one back</div>` + rows));
    }

    UI.setHTML($("machines"), "mach", parts.join("") || `<p class="empty">Machines you build show up here.</p>`);
  }

  Object.assign(UI.handlers, {
    power: ([i]) => { const t = UI.s.island[+i]; if (t && (D.POWER[t.id]?.watts || t.id === "treeHarvester")) t.enabled = t.enabled === false; },
    genfuel: ([i, id]) => { const t = UI.s.island[+i]; if (t && D.POWER[t.id]?.fuels?.[id]) t.fuel = id; },
    sel: ([act, k]) => { UI.s.sel[act] = k; },
    auto: ([id, k]) => { UI.s.sel[id] = k; UI.s.island.forEach(t => { if (t && t.id === id) t.sel = k; }); },
    autot: ([i, k]) => { const t = UI.s.island[+i]; if (t) { t.sel = k; UI.s.sel[t.id] = k; } },
    insert: ([i, id]) => A.insertTool(UI.s, +i, id),
    pull: ([i]) => A.pullTool(UI.s, +i),
    seed: ([i, id]) => A.setSeed(UI.s, +i, id || null),
    fold: ([id]) => { UI.s.fold[id] = !UI.s.fold[id]; },
    filter: ([f]) => { UI.filter = f; },
    // "go": clicked from elsewhere (the machines panel), so bring the crafting panel into view too
    tab: ([t, go]) => { UI.tab = t; UI.focus = null; if (go) $("crafting").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" }); },
    drops: () => { const box = $("drops-box"); box.open = true; box.scrollIntoView({ behavior: "smooth", block: "nearest" }); },
    amt: ([n]) => { UI.amount = +n; $("craftn").value = n; },
    focus: ([id]) => { UI.focus = id; $("crafting").scrollTop = 0; $("crafting").closest(".card").scrollIntoView({ block: "nearest", behavior: "smooth" }); },
    unfocus: () => { UI.focus = null; },
    usedin: ([id]) => { UI.focus = null; UI.tab = "craft"; UI.search = name(id); $("craftsearch").value = UI.search; },
    hide: ([key]) => {
      const r = RECIPES.find(x => x.key === key);
      const hidden = r ? A.hidden(UI.s, r) : UI.s.hide[key] === 1;
      UI.s.hide[key] = hidden ? 0 : 1;
    },
    craft: ([rid, n]) => {
      const r = RECIPES.find(x => x.id === rid);
      A.craft(UI.s, r, n === "max" ? A.maxCraft(UI.s, r) : +n);
    },
    queue: ([st, id, n]) => A.queueAt(UI.s, st, id, n === "max" ? Infinity : +n),
    expand: () => A.expand(UI.s),
    fuel: ([id, n]) => A.addFuel(UI.s, id, n === "all" ? Infinity : +n),
    clearq: ([st]) => A.clearAt(UI.s, st || "furnace"),
    clay: () => A.mixClay(UI.s),
    bucket: ([k]) => A.fillBucket(UI.s, k),
    loadbarrels: () => A.feedBarrels(UI.s),
  });
  UI.renderers.push(renderInventory, renderActions, renderCrafting, renderMachines);
})();
