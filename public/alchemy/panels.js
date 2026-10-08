/* Alchemy — panels: work buttons, inventory (buildings first), crafting with one universal search,
 * and the machine panel that opens when you click a building on the island. */
(function () {
  "use strict";
  const UI = window.AlchemyUI, { A, D, $ } = UI;
  const { ITEMS, ACTIONS, SMELT, ALLOY, CROPS, RECIPES, CONFIG: C } = D;
  const { img, name, esc } = UI;
  const TOOLS = new Set(Object.values(C.tools).flat().map(([t]) => t));
  const HEAT = ["", "wood", "charcoal", "coal"];

  // ---------- where does an item come from (besides crafting)? shown when you click an item, not on hover ----------
  const MESH = C.tools.mesh; // [[id, tier]]
  const num = x => (x >= 1 ? x.toFixed(1) : x >= 0.1 ? x.toFixed(2) : x.toFixed(3));
  function sources(id) {
    const out = [];
    const add = t => { if (!out.includes(t)) out.push(t); };
    const DOING = { chop: "chopping trees (Work panel)", leaves: "shaking the leaves (Work panel)", mine: "mining a cobblestone generator with a pickaxe" };
    for (const k in DOING) if (ACTIONS[k].drops.some(d => d[0] === id)) add(DOING[k]);
    for (const [inp, table] of Object.entries(D.SIEVE)) {
      const e = table.filter(d => d[0] === id);
      if (!e.length) continue;
      const gate = Math.min(...e.map(d => (typeof d[3] === "number" ? d[3] : 1)));
      const tier = Math.max(gate, A.toolValue(UI.s, "mesh") || 1); // with your mesh, or the first one that catches it
      const ev = e.reduce((a, [, p, n = 1, g]) => a + (typeof g === "number" && tier < g ? 0 : Math.min(1, p * C.meshLuck[tier]) * n), 0);
      add(`sieving ${name(inp).toLowerCase()}: ${num(ev)} per sieve with a ${name(MESH[tier - 1][0]).toLowerCase()}${gate > 1 ? ` (needs a ${name(MESH[gate - 1][0]).toLowerCase()} or better)` : ""}`);
    }
    for (const [inp, t] of Object.entries(ACTIONS.hammer.inputs)) if (t.some(d => d[0] === id)) add(`hammering ${name(inp).toLowerCase()}`);
    for (const [inp, t] of Object.entries(ACTIONS.chammer.inputs)) if (t.some(d => d[0] === id)) add(`heavy-smashing ${name(inp).toLowerCase()} with a compressed hammer (9 at once)`);
    for (const [inp, r] of Object.entries(SMELT)) if (r.out === id) add(`smelting ${name(inp).toLowerCase()} in a furnace`);
    if (ALLOY[id]) add("an alloy smelter");
    for (const [st, cfg] of Object.entries(D.ELECTRIC))
      if (Object.values(cfg.recipes).some(r => r.out === id)) add(`a powered ${name(st).toLowerCase()}`);
    if (C.harvester.drops[id]) add("a powered tree harvester");
    for (const [seed, c] of Object.entries(CROPS)) if (c.drops.some(d => d[0] === id)) add(`growing ${name(seed).toLowerCase()} on farmland`);
    if (C.tree.drops.some(d => d[0] === id)) add("falling from grown trees now and then");
    if (C.infested.drops.some(d => d[0] === id)) add("infested leaves, which spin it on their own");
    if (id === "dirt") add("rotting compost in a barrel");
    if (id === "clayBlock") add("mixing dust into a full rain barrel");
    if (id === "waterBucket") add("filling a bucket at a full rain barrel");
    if (id === "lavaBucket") add("filling a bucket at a crucible holding 1000 mB of lava");
    if (id === "cobble") add("auto-generators, which mine it on their own");
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
    for (const id in ITEMS) { UI.v("c:" + id, UI.fmt(A.count(s, id))); UI.v("i:" + id, UI.fmt(s.inv[id] || 0)); }
    // buildings (and saplings) first: drag one onto the island, or click it and then click an empty tile
    const blds = Object.keys(ITEMS).filter(id => A.placesAs(id) && (s.inv[id] || 0) > 0);
    $("buildings-box").hidden = !blds.length;
    UI.setHTML($("buildings"), "blds", blds.map(id =>
      `<div class="slot bld ${UI.placing === id ? "on" : ""}" draggable="true" data-bld="${id}" data-tip="${id}" data-act="placing:${id}">${img(id)}<span class="n" data-v="i:${id}"></span></div>`).join(""));
    const owned = Object.keys(ITEMS).filter(id => !A.placesAs(id) && (s.inv[id] || 0) > 0);
    // only your best tool of each kind; the older ones still count for recipes that eat them
    const best = id => { const tk = A.toolKind(id); return !tk || A.tool(s, tk[0])[0] === id; };
    const ids = owned.filter(best), older = owned.length - ids.length;
    UI.setHTML($("inventory"), "inv", ids.length
      ? ids.map(id => `<div class="slot ${TOOLS.has(id) ? "tool" : ""}" data-tip="${id}" data-act="focus:${id}">${img(id)}<span class="n" data-v="c:${id}"></span></div>`).join("")
      : `<p class="empty">Nothing yet. Chop the tree.</p>`);
    UI.setHTML($("invmeta"), "invmeta", `${ids.length + blds.length} kinds${older ? ` · ${older} older tool${older === 1 ? "" : "s"} hidden` : ""}`);
  }

  // ---------- crafting: table recipes, plus every machine's recipes when you search ----------
  UI.search = "";
  UI.focus = null; // item id: show only the recipes that make it, plus where else it comes from
  UI.amount = 1;
  const STATION_IDS = ["furnace", "alloy", ...Object.keys(D.ELECTRIC)];

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
      why: A.built(s, st) ? "" : `place a ${name(st).toLowerCase()} on the island`,
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
    const tag = x.station !== "craft" && !x.inMachine ? ` <small>· in a ${name(x.station).toLowerCase()}</small>` : "";
    const note = x.hid === "auto" ? " <small>· you have this or better</small>" : x.hid ? " <small>· hidden</small>" : x.note ? ` <small>· ${esc(x.note)}</small>` : "";
    const rid = x.station === "craft" ? x.r.id : `${x.station}|${x.id}`;
    UI.v("m:" + rid, x.max < 2 ? "max" : x.max);
    UI.v("md:" + rid, x.max < 2);
    const one = x.station === "craft"
      ? `<button class="mini" data-act="craft:${x.r.id}:${amt}" ${x.ok ? "" : "disabled"}>Craft${amt > 1 && !x.place ? ` ×${amt}` : ""}</button>${x.place ? "" : `<button class="mini" data-act="craft:${x.r.id}:max" data-d="md:${rid}">×<span data-v="m:${rid}"></span></button>`}`
      : `<button class="mini" data-act="queue:${x.station}:${x.id}:${amt}" ${x.ok ? "" : "disabled"}>Queue${amt > 1 ? ` ×${amt}` : ""}</button><button class="mini" data-act="queue:${x.station}:${x.id}:max" data-d="md:${rid}">×<span data-v="m:${rid}"></span></button>`;
    return `${sep}<div class="rec ${x.ok ? "" : "no"} ${x.hid ? "hid" : ""}"><span data-tip="${x.outId}">${img(x.outId)}</span>
      <div><div class="name">${esc(x.title)}${x.outN > 1 ? ` <small>×${x.outN}</small>` : ""}${x.extra ? ` <small>${esc(x.extra)}</small>` : ""}${x.place ? " <small>· building</small>" : ""}${tag}${note}</div><div class="ings">${ings}</div>${x.why ? `<div class="meta">${esc(x.why)}</div>` : ""}</div>
      <div class="btns">${one}<button class="eye" data-act="hide:${esc(x.key)}" title="${x.hid ? "show this recipe again" : "hide this recipe"}">${x.hid ? "show" : "hide"}</button></div></div>`;
  }

  function renderCrafting() {
    const s = UI.s;
    let rows, focusHTML = "";
    if (UI.focus) {
      const id = UI.focus;
      rows = [...RECIPES.filter(r => r.out[id]).map(r => craftRow(s, r)),
        ...Object.keys(SMELT).filter(k => SMELT[k].out === id).map(k => stationRow(s, "furnace", k)),
        ...(ALLOY[id] ? [stationRow(s, "alloy", id)] : []),
        ...Object.entries(D.ELECTRIC).flatMap(([st, cfg]) => Object.keys(cfg.recipes).filter(k => cfg.recipes[k].out === id).map(k => stationRow(s, st, k)))];
      const src = sources(id), uses = RECIPES.filter(r => r.in[id]).length;
      focusHTML = `<div class="top">${img(id, "sm")}<b>${esc(name(id))}</b><span class="meta">${rows.length ? `${rows.length} recipe${rows.length === 1 ? " makes" : "s make"} it` : "no recipe makes it"}</span>
        ${uses ? `<button class="mini" data-act="usedin:${id}">used in ${uses}</button>` : ""}<button class="mini" data-act="unfocus">× back to all</button></div>
        ${desc(id)}${src.length ? `<div class="meta">other ways to get it:</div><ul>${src.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`;
    } else {
      // the search covers every recipe: crafting table and all the machines you've found
      const q = UI.search.trim().toLowerCase();
      rows = rowsFor(s, "craft");
      if (q) rows = [...rows, ...STATION_IDS.filter(st => s.seen[st]).flatMap(st => rowsFor(s, st))].filter(x => matches(x, q));
      rows = rows.filter(x => UI.filter !== "can" || (x.ok && !x.hid)).sort((a, b) => !!a.hid - !!b.hid || b.ok - a.ok);
    }
    const firstHid = UI.focus ? -1 : rows.findIndex(x => x.hid);
    const h = rows.map((x, i) => rowHTML(s, x, i === firstHid ? `<div class="rec-sep">hidden · ${rows.length - firstHid}</div>` : "")).join("");
    const empty = UI.focus ? "" : UI.search ? "No recipe matches that search." : "No recipes yet. Everything starts with a log.";
    UI.setHTML($("crafting"), "craft", h || `<p class="empty">${empty}</p>`);
    UI.setHTML($("craftfocus"), "cfocus", focusHTML);
    UI.setHTML($("craftfilter"), "cf", ["all", "can"].map(f =>
      `<button class="chip" style="padding-left:9px" data-act="filter:${f}" aria-pressed="${UI.filter === f}">${f === "all" ? "all" : "can craft"}</button>`).join(""));
    UI.setHTML($("craftamt"), "camt", [1, 5, 10, 25, 64].map(n => `<button class="chip" data-act="amt:${n}" aria-pressed="${UI.amount === n}">${n}</button>`).join(""));
  }
  $("craftsearch").addEventListener("input", e => { UI.search = e.target.value; UI.focus = null; UI.render(); });
  $("craftn").addEventListener("input", e => { UI.amount = Math.max(1, Math.min(999, e.target.value | 0 || 1)); UI.render(); });

  // ---------- the machine panel: click a building on the island to open it ----------
  const unit = (text, bar, cls = "") => `<div class="unit"><span data-v="${text}"></span><div class="bar ${cls}"><i data-w="${bar}"></i></div></div>`;
  const chipCount = id => `<span class="chip" data-tip="${id}" style="cursor:default">${img(id, "sm")}<span data-v="c:${id}"></span></span>`;

  function stationHTML(s, st) {
    const S = A.STATIONS[st], n = A.built(s, st), q = s[S.q];
    let slots = "";
    for (let i = 0; i < n; i++) {
      const job = s[S.sl][i], rec = job && S.rec(job.id);
      UI.v(`${st}w:${i}`, job ? job.p : 0);
      slots += `<div class="unit" style="grid-column: span 2"><span>${job ? (job.stalled ? (S.watts ? "waiting for energy" : `needs ${HEAT[rec.heat]} heat`) : esc(st === "furnace" ? `${name(job.id)} → ${name(rec.out)}` : `→ ${name(rec.out)}`)) : "idle"}</span><div class="bar warm"><i data-w="${st}w:${i}"></i></div></div>`;
    }
    const rows = rowsFor(s, st).map(x => ({ ...x, inMachine: true })).sort((a, b) => !!a.hid - !!b.hid || b.ok - a.ok);
    return `<p class="meta">${n > 1 ? `all ${n} of them share one queue, one job each at a time` : "one job at a time"}</p><div class="units">${slots}</div>` +
      (q.length ? `<div class="row meta">queued: ${esc(q.map(j => `${j.n} × ${name(S.rec(j.id).out)}`).join(", "))} <button class="mini" data-act="clearq:${st}">clear</button></div>` : "") +
      `<h3>Recipes</h3><div class="recipes">${rows.map(x => rowHTML(s, x, "")).join("") || `<p class="empty">Nothing you have can go in here yet.</p>`}</div>`;
  }
  function fuelHTML(s) {
    const rows = [1, 2, 3].map(h => {
      UI.v(`fw:${h}`, Math.min(1, s.fuel[h] / 120));
      UI.v(`ft:${h}`, s.fuel[h] > 0 ? UI.secs(s.fuel[h]) : "empty");
      return `<span>heat ${h} · ${HEAT[h]}</span><div class="bar warm"><i data-w="fw:${h}"></i></div><span data-v="ft:${h}"></span>`;
    }).join("");
    const fuels = Object.keys(ITEMS).filter(id => ITEMS[id].fuel && A.count(s, id) > 0);
    return `<h3>Fuel (shared by furnaces and alloy smelters)</h3><div class="fuel">${rows}</div>` +
      (fuels.length ? `<div class="row">${fuels.map(id => `<span class="grp">${chipCount(id)}<button class="mini" data-act="fuel:${id}:1">+1</button><button class="mini" data-act="fuel:${id}:all">all</button></span>`).join("")}</div>` : `<p class="meta">Nothing burnable in your inventory.</p>`);
  }
  function gridHTML(s) {
    const capacity = A.energyCapacity(s);
    UI.v("energy:stored", `${Math.floor(s.energy).toLocaleString()} / ${capacity.toLocaleString()} J`);
    UI.v("energy:bar", capacity ? s.energy / capacity : 0);
    UI.v("energy:flow", `${s.power.generated.toFixed(1)} W generated · ${s.power.used.toFixed(1)} W used`);
    return `<h3>Energy grid</h3><div class="row"><b data-v="energy:stored"></b><span class="meta" data-v="energy:flow"></span></div><div class="bar"><i data-w="energy:bar"></i></div>` +
      `<p class="meta">Every powered building connects automatically. Generators pause at full storage; queued machines draw first, then harvesters.${capacity ? "" : " Place a fuel or solar generator to supply energy."}</p>`;
  }

  function machineBody(s, t, i) {
    const id = t.id;
    if (A.STATIONS[id]) return (D.ELECTRIC[id] ? gridHTML(s) : fuelHTML(s)) + stationHTML(s, id);
    if (D.AUTO[id]) {
      const cfg = D.AUTO[id], inputs = Object.keys(ACTIONS[cfg.action].inputs);
      const kindName = { hammer: "hammer", mesh: "mesh", chammer: "compressed hammer" }[cfg.kind];
      const owned = C.tools[cfg.kind].filter(([o]) => (s.inv[o] || 0) > 0).map(([o]) => o).reverse(); // best first
      const sel = t.sel || s.sel[id];
      UI.v(`m${i}:bar`, t.idle ? 0 : t.t / A.autoPeriod(t));
      const slot = t.tool
        ? `<span class="toolslot full" data-tip="${t.tool}">${img(t.tool, "sm")}${esc(name(t.tool))}</span><button class="mini" data-act="pull:${i}">pull out</button>`
        : `<span class="toolslot">no ${kindName}</span>`;
      const insert = owned.filter(o => o !== t.tool).map(o => `<button class="chip" data-act="insert:${i}:${o}" data-tip="${o}">${img(o, "sm")}<span>insert</span></button>`).join("");
      const chips = (act, cur) => inputs.filter(k => s.seen[k]).map(k => `<button class="chip" data-act="${act}:${k}" aria-pressed="${cur === k}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span></button>`).join("");
      const others = A.built(s, id) > 1 ? `<div class="row"><span class="meta">set all ${A.built(s, id)}</span><div class="chips">${chips(`auto:${id}`, null)}</div></div>` : "";
      const speed = t.tool && cfg.kind !== "mesh" ? ` <span class="meta">${A.autoPeriod(t).toFixed(1)} s each</span>` : "";
      const wait = t.idle ? `<p class="meta">${t.tool ? `waiting for ${esc(name(sel).toLowerCase())}${C.reserve[sel] ? ` (it leaves ${C.reserve[sel]} for crafting)` : ""}` : `needs a ${kindName}: insert one from your inventory`}</p>` : "";
      return `<div class="unitrow">${slot}${insert}${speed}</div><div class="unitrow"><span class="meta">input</span><div class="chips">${chips(`autot:${i}`, sel)}</div><div class="bar"><i data-w="m${i}:bar"></i></div></div>${wait}${others}` +
        `<p class="meta">${cfg.kind === "mesh" ? "The mesh inside decides the drops." : "Better hammers work faster."} Manual work uses the best one left in your inventory.</p>`;
    }
    if (D.POWER[id]) {
      const cfg = D.POWER[id];
      let ctl = "";
      if (cfg.watts) {
        UI.v(`m${i}:power`, `${(t.output || 0).toFixed(1)} / ${cfg.watts} W${cfg.fuels ? ` · ${Math.ceil(t.fuelJ)} J of loaded fuel left` : ""}`);
        const fuel = cfg.fuels ? Object.entries(cfg.fuels).map(([f, joules]) => `<button class="chip" data-act="genfuel:${i}:${f}" aria-pressed="${t.fuel === f}" data-tip="${f}">${img(f, "sm")}${name(f)} · ${joules.toLocaleString()} J</button>`).join("") : "";
        ctl = `<div class="unitrow"><button class="mini" data-act="power:${i}" aria-pressed="${t.enabled !== false}">${t.enabled === false ? "Resume" : "Pause"}</button><span class="meta" data-v="m${i}:power"></span></div>${fuel ? `<div class="chips">${fuel}</div><p class="meta">It feeds the selected fuel from your inventory only when the grid has room; switching finishes the loaded item first.</p>` : ""}`;
      }
      return ctl + gridHTML(s);
    }
    switch (id) {
      case "treeHarvester":
        UI.v(`m${i}:bar`, t.p);
        UI.v(`m${i}:st`, t.status || "waiting for a grown tree");
        return `<div class="unitrow"><button class="mini" data-act="power:${i}" aria-pressed="${t.enabled}">${t.enabled ? "Pause" : "Resume"}</button><span class="meta" data-v="m${i}:st"></span><div class="bar green"><i data-w="m${i}:bar"></i></div></div>` +
          `<p class="meta">Each harvest uses ${C.harvester.watts * C.harvester.time} J for 4 logs, 4 leaves and a sapling, then replants; trees regrow in ${C.tree.grow} s.</p>` + gridHTML(s);
      case "barrel":
        UI.v(`m${i}:bar`, t.time > 0 ? 1 - t.time / C.barrel.time : t.fill / C.barrel.units);
        UI.v(`m${i}:st`, t.time > 0 ? `rotting into dirt · ${Math.ceil(t.time)} s` : `compost ${t.fill}/${C.barrel.units}`);
        return unit(`m${i}:st`, `m${i}:bar`, "green") +
          `<div class="row"><span class="meta">all barrels:</span><label><input type="checkbox" data-opt="feedBarrels" ${s.opt.feedBarrels ? "checked" : ""}> auto-feed</label>` +
          `<label><input type="checkbox" data-opt="compostSaplings" ${s.opt.compostSaplings ? "checked" : ""}> compost saplings</label><button class="mini" data-act="loadbarrels">Load now</button></div>`;
      case "rainBarrel": {
        const full = !!A.fullRain(s);
        UI.v(`m${i}:bar`, t.water);
        UI.v(`m${i}:st`, t.water >= 1 ? "full of rainwater" : `filling · ${Math.floor(t.water * 100)}%`);
        UI.v("d:clay", !(full && A.count(s, "dust") > 0));
        UI.v("d:water", !(full && A.count(s, "bucket") > 0));
        return unit(`m${i}:st`, `m${i}:bar`, "water") + `<div class="row"><button class="mini" data-act="clay" data-d="d:clay">Mix clay · 1 dust</button><button class="mini" data-act="bucket:water" data-d="d:water">Fill a bucket</button></div>`;
      }
      case "crucible":
        UI.v(`m${i}:bar`, t.lava / C.crucible.lava);
        UI.v(`m${i}:st`, `${t.cobble} cobblestone melting · ${t.lava} mB lava`);
        UI.v("d:lava", !(A.lavaCrucible(s) && A.count(s, "bucket") > 0));
        return unit(`m${i}:st`, `m${i}:bar`, "warm") + `<div class="row"><label><input type="checkbox" data-opt="feedCrucible" ${s.opt.feedCrucible ? "checked" : ""}> melt cobblestone</label><button class="mini" data-act="bucket:lava" data-d="d:lava">Fill a bucket · 1000 mB</button></div>`;
      case "farmland": {
        const seeds = Object.keys(CROPS).filter(k => s.seen[k]);
        UI.v(`m${i}:bar`, t.seed ? t.g : 0);
        UI.v(`m${i}:st`, t.seed ? `${name(t.seed)} · ${Math.floor(t.g * 100)}%` : t.sel ? `no ${name(t.sel).toLowerCase()} to plant` : "empty");
        return `<div class="chips">${seeds.map(sd => `<button class="chip" data-act="seed:${i}:${sd}" aria-pressed="${t.sel === sd}" data-tip="${sd}">${img(sd, "sm")}<span data-v="i:${sd}"></span></button>`).join("")}<button class="chip" style="padding-left:9px" data-act="seed:${i}:" aria-pressed="${!t.sel}">none</button></div>` +
          unit(`m${i}:st`, `m${i}:bar`, "green") + `<p class="meta">A planted seed stays and regrows forever; switching seeds hands the old one back.</p>`;
      }
      case "infested":
        UI.v(`m${i}:bar`, t.t / C.infested.time);
        return `<p class="meta">Spins 1 string every ${C.infested.time} s.</p><div class="bar"><i data-w="m${i}:bar"></i></div>`;
      case "tree":
        return `<p class="meta">${t.grow < 1 ? `Growing (${Math.floor(t.grow * 100)}%).` : `Drops leaves every ${C.tree.litter} s. Chop it or shake it from the Work panel.`} Picking it up gives the sapling back${t.grow >= 1 ? ", plus 2 logs" : ""}.</p>`;
      case "cobblegen": {
        const p = A.tool(s, "pick"), n = A.built(s, "cobblegen");
        return `<p class="meta">${p ? `Mine it from the Work panel (key 5): ${esc(name(p[0]).toLowerCase())} + ${n} generator${n === 1 ? "" : "s"} = ${p[1] + n} power per swing.` : "You need a pickaxe to mine it."}</p>`;
      }
      case "autoGen": case "autoGen2": case "autoGen3":
        return `<p class="meta">Mines ${C.autoGen[id]} cobblestone per second by itself. Upgrade it in the crafting list.</p>`;
      case "table":
        return `<p class="meta">Recipes marked "at a table" in the crafting list need one of these on the island.</p>`;
      case "sieve": case "heavySieve":
        return `<p class="meta">Each one adds sieving power to the ${id === "sieve" ? "Sieve" : "Heavy sieve"} button in the Work panel.</p>`;
      default:
        return ITEMS[id].desc ? `<p class="meta">${esc(ITEMS[id].desc)}</p>` : "";
    }
  }
  UI.machineBody = machineBody;
  UI.desc = id => (ITEMS[id] && ITEMS[id].desc) || "";
  const desc = id => (ITEMS[id] && ITEMS[id].desc ? `<div>${esc(ITEMS[id].desc)}</div>` : "");

  Object.assign(UI.handlers, {
    power: ([i]) => { const t = UI.s.island[+i]; if (t && (D.POWER[t.id]?.watts || t.id === "treeHarvester")) t.enabled = t.enabled === false; },
    genfuel: ([i, id]) => { const t = UI.s.island[+i]; if (t && D.POWER[t.id]?.fuels?.[id]) t.fuel = id; },
    sel: ([act, k]) => { UI.s.sel[act] = k; },
    auto: ([id, k]) => { UI.s.sel[id] = k; UI.s.island.forEach(t => { if (t && t.id === id) t.sel = k; }); },
    autot: ([i, k]) => { const t = UI.s.island[+i]; if (t) { t.sel = k; UI.s.sel[t.id] = k; } },
    insert: ([i, id]) => A.insertTool(UI.s, +i, id),
    pull: ([i]) => A.pullTool(UI.s, +i),
    seed: ([i, id]) => A.setSeed(UI.s, +i, id || null),
    filter: ([f]) => { UI.filter = f; },
    drops: () => { const box = $("drops-box"); box.open = true; box.scrollIntoView({ behavior: "smooth", block: "nearest" }); },
    amt: ([n]) => { UI.amount = +n; $("craftn").value = n; },
    focus: ([id]) => { UI.focus = id; $("crafting").scrollTop = 0; $("crafting").closest(".card").scrollIntoView({ block: "nearest", behavior: "smooth" }); },
    unfocus: () => { UI.focus = null; },
    usedin: ([id]) => { UI.focus = null; UI.search = name(id); $("craftsearch").value = UI.search; },
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
  UI.renderers.push(renderInventory, renderActions, renderCrafting);
})();
