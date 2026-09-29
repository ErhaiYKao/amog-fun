/* Alchemy — the island: a pixel canvas of your tiles floating in the void, plus the selected-tile panel. */
(function () {
  "use strict";
  const UI = window.AlchemyUI, { A, D, I, $ } = UI;
  const C = D.CONFIG;
  const TS = 20, COLS = 9, ROWS = 7, CLIFF = 6;
  const cv = $("island"), ctx = cv.getContext("2d");
  // twice the world size, so the camera can zoom in whole-pixel steps
  cv.width = COLS * TS * 2;
  cv.height = (ROWS * TS + CLIFF) * 2;

  // land grows outward from the middle, roughly in a circle
  const cells = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) cells.push([x, y]);
  const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
  const dist = ([x, y]) => Math.hypot(x - cx, (y - cy) * 1.25);
  cells.sort((a, b) => dist(a) - dist(b) || Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));

  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 50 }, () => [Math.floor(rand() * cv.width), Math.floor(rand() * cv.height), rand()]);
  function pattern(h, fn) {
    const c = document.createElement("canvas");
    c.width = TS; c.height = h;
    const g = c.getContext("2d");
    for (let y = 0; y < h; y++) for (let x = 0; x < TS; x++) { g.fillStyle = fn(x, y, rand()); g.fillRect(x, y, 1, 1); }
    return c;
  }
  const grass = pattern(TS, (x, y, r) => (r < 0.08 ? "#4a7a2e" : r < 0.16 ? "#6aa246" : y === 0 ? "#6aa246" : "#5b8f3a"));
  const cliff = pattern(CLIFF, (x, y, r) => (y === CLIFF - 1 ? "#3b2a1a" : r < 0.2 ? "#5a3d24" : "#6b4a2b"));

  function progress(t) {
    switch (t.id) {
      case "tree": return t.grow < 1 ? [t.grow, "#a7c957"] : null;
      case "barrel": return t.time > 0 ? [1 - t.time / C.barrel.time, "#c08a4a"] : [t.fill / C.barrel.units, "#a7c957"];
      case "rainBarrel": return [t.water, "#3f76e4"];
      case "crucible": return [t.lava / C.crucible.lava, "#ff7a1a"];
      case "infested": return [t.t / C.infested.time, "#f2efe6"];
      case "autoHammer": case "autoSieve": case "autoCHammer": case "autoHeavySieve": return t.idle ? null : [t.t / A.autoPeriod(t), "#4fd6e8"];
      case "farmland": return t.seed ? [t.g, "#a7c957"] : null;
      case "autoGen": case "autoGen2": case "autoGen3": return [t.acc, "#9a9aa2"];
      case "treeHarvester": return [t.p, "#a7c957"];
      case "battery": case "fuelGenerator": case "solarGenerator": return [UI.s.energy / (A.energyCapacity(UI.s) || 1), "#4fd6e8"];
      default: return null;
    }
  }
  const iconOf = t => (t.id === "tree" && t.grow < 1 ? "sapling" : t.id);

  let hover = -1, frameNo = 0, cam = { k: 1, ox: 0, oy: 0 };
  function camera(n) {
    const used = cells.slice(0, Math.min(n + 1, C.land.max));
    const xs = used.map(c => c[0]), ys = used.map(c => c[1]);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS, h = (Math.max(...ys) - Math.min(...ys) + 1) * TS + CLIFF;
    const k = Math.max(1, Math.min(4, Math.floor(Math.min(cv.width / (w + TS), cv.height / (h + TS)))));
    return { k, ox: Math.round((cv.width - w * k) / 2 - Math.min(...xs) * TS * k), oy: Math.round((cv.height - h * k) / 2 - Math.min(...ys) * TS * k) };
  }
  function outline(i, color) {
    const [x, y] = cells[i];
    ctx.strokeStyle = color;
    ctx.strokeRect(x * TS + 0.5, y * TS + 0.5, TS - 1, TS - 1);
  }
  function draw() {
    const s = UI.s;
    frameNo++;
    ctx.fillStyle = "#07070c";
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (const [x, y, b] of stars) {
      ctx.fillStyle = `rgba(255,255,255,${((0.3 + 0.5 * Math.abs(Math.sin(frameNo / 25 + b * 9))) * b).toFixed(2)})`;
      ctx.fillRect(x, y, 1, 1);
    }
    cam = camera(s.island.length);
    ctx.save();
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(cam.k, cam.k);
    const land = new Set(s.island.map((_, i) => cells[i].join(",")));
    if (s.island.length < C.land.max) {
      ctx.setLineDash([2, 2]);
      outline(s.island.length, "rgba(255,255,255,.2)");
      ctx.setLineDash([]);
    }
    s.island.forEach((t, i) => {
      const [x, y] = cells[i], px = x * TS, py = y * TS;
      ctx.drawImage(grass, px, py);
      if (!land.has(`${x},${y + 1}`)) ctx.drawImage(cliff, px, py + TS);
      if (!t) return;
      ctx.drawImage(I.canvas(iconOf(t)), px + 2, py + 2);
      const p = progress(t);
      if (p) {
        ctx.fillStyle = "rgba(0,0,0,.6)";
        ctx.fillRect(px + 2, py + 17, 16, 2);
        ctx.fillStyle = p[1];
        ctx.fillRect(px + 2, py + 17, Math.round(16 * Math.max(0, Math.min(1, p[0]))), 2);
      }
      if (t.id === "furnace" && s.slots.some(j => j && !j.stalled) && frameNo % 6 < 3) {
        ctx.fillStyle = "#fff1a8";
        ctx.fillRect(px + 9, py + 12, 2, 1);
      }
    });
    if (hover >= 0) outline(hover, "rgba(255,255,255,.4)");
    if (UI.selected >= 0 && UI.selected < s.island.length) outline(UI.selected, "#ffffff");
    ctx.restore();
  }

  function indexAt(e) {
    const r = cv.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * cv.width, py = ((e.clientY - r.top) / r.height) * cv.height;
    const x = Math.floor((px - cam.ox) / cam.k / TS), y = Math.floor((py - cam.oy) / cam.k / TS);
    return UI.s.island.findIndex((_, i) => cells[i][0] === x && cells[i][1] === y);
  }
  cv.addEventListener("mousemove", e => { hover = indexAt(e); });
  cv.addEventListener("mouseleave", () => { hover = -1; });
  cv.addEventListener("click", e => { UI.selected = indexAt(e); UI.render(); });

  function status(s, t) {
    switch (t.id) {
      case "tree": return t.grow < 1 ? `growing · ${Math.floor(t.grow * 100)}%` : `drops leaves every ${C.tree.litter} s`;
      case "barrel": return t.time > 0 ? `rotting into dirt · ${Math.ceil(t.time)} s` : `compost ${t.fill}/${C.barrel.units}`;
      case "rainBarrel": return t.water >= 1 ? "full of rainwater" : `filling · ${Math.floor(t.water * 100)}%`;
      case "infested": return `next string in ${Math.ceil(C.infested.time - t.t)} s`;
      case "crucible": return `${t.cobble} cobblestone waiting · ${t.lava} mB lava`;
      case "cobblegen": { const p = A.tool(s, "pick"); return p ? `mine it from the Work panel (${UI.name(p[0]).toLowerCase()})` : "needs a pickaxe to mine"; }
      case "autoGen": case "autoGen2": case "autoGen3": return `${C.autoGen[t.id]} cobblestone/s, no pickaxe needed`;
      case "autoHammer": case "autoSieve": case "autoCHammer": case "autoHeavySieve":
        return t.tool ? `${UI.name(t.tool).toLowerCase()} · ${t.idle ? "waiting for" : "working on"} ${UI.name(t.sel || s.sel[t.id]).toLowerCase()} · set up under Machines` : "empty: insert a tool under Machines";
      case "farmland": return t.seed ? `${UI.name(t.seed).toLowerCase()} · ${Math.floor(t.g * 100)}%` : "pick a seed under Machines";
      case "alloy": return "recipes are in the Alloy tab of the crafting panel";
      case "furnace": return "fuel is under Machines, recipes in the Furnace tab";
      case "crusher": case "energizedSmelter": case "infuser": return `${D.ELECTRIC[t.id].watts} W · queue recipes in the ${UI.name(t.id)} tab`;
      case "treeHarvester": return `${t.status || "waiting"} · ${Math.floor(t.p * 100)}% · configure under Machines`;
      case "fuelGenerator": case "solarGenerator": return `${(t.output || 0).toFixed(1)} W · configure under Machines`;
      case "battery": return `${Math.floor(s.energy).toLocaleString()} / ${A.energyCapacity(s).toLocaleString()} J on the grid`;
      default: return D.ITEMS[t.id].desc || "";
    }
  }

  function renderIsland() {
    const s = UI.s;
    draw();
    const used = s.island.filter(Boolean).length, cost = A.expandCost(s), maxed = s.island.length >= C.land.max;
    UI.v("d:expand", A.count(s, "dirt") < cost);
    UI.setHTML($("land"), "land", `${used}/${s.island.length} tiles ${maxed ? "· full size" : `<button class="mini" data-act="expand" data-d="d:expand">Expand · ${cost} dirt</button>`}`);
    const i = UI.selected, t = s.island[i];
    let h;
    if (i < 0 || i >= s.island.length) h = `<span class="meta">Click a tile to inspect it. New land appears at the dashed square.</span>`;
    else if (!t) h = `<span class="meta">Empty land. Build a machine or plant a sapling to use it.</span>`;
    else {
      UI.v("tile:st", status(s, t));
      h = `${UI.img(iconOf(t))}<div class="grow"><b>${UI.esc(UI.name(t.id))}</b><br><span class="meta" data-v="tile:st"></span></div><button class="mini" data-act="demolish:${i}">Demolish</button>`;
    }
    UI.setHTML($("tile"), "tile", h);
  }

  UI.handlers.demolish = ([i]) => {
    const t = UI.s.island[+i];
    if (!t) return;
    const note = t.id === "tree" ? "You get a sapling back." : "You won't get the materials back.";
    if (confirm(`Demolish this ${UI.name(t.id).toLowerCase()}? ${note}`)) { A.demolish(UI.s, +i); UI.selected = -1; }
  };
  UI.renderers.push(renderIsland);
})();
