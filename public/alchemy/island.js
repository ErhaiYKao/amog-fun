/* Alchemy — the island: a pixel canvas of your tiles floating in the void, plus the machine panel.
 * Drag a building to move it (it swaps with whatever is there), drag it onto the inventory to pick it up,
 * drag a building from the inventory onto an empty tile to place it (or click it, then click a tile).
 * The − fit + buttons (or ctrl/⌘ + wheel, or a pinch) zoom; drag empty space to pan. */
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

  const iconOf = t => (t.id === "tree" && t.grow < 1 ? "sapling" : t.id);

  let hover = -1, frameNo = 0, cam = { k: 1, ox: 0, oy: 0 };
  // view = null means "fit the island"; otherwise { k: zoom, x, y: world point at the centre of the canvas }
  let view = null;
  function fit(n) {
    const used = cells.slice(0, Math.min(n + 1, C.land.max));
    const xs = used.map(c => c[0]), ys = used.map(c => c[1]);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS, h = (Math.max(...ys) - Math.min(...ys) + 1) * TS + CLIFF;
    const k = Math.max(1, Math.min(4, Math.floor(Math.min(cv.width / (w + TS), cv.height / (h + TS)))));
    return { k, x: Math.min(...xs) * TS + w / 2, y: Math.min(...ys) * TS + h / 2 };
  }
  function camera(n) {
    const v = view || fit(n);
    // keep the view on the map
    const x = Math.max(0, Math.min(COLS * TS, v.x)), y = Math.max(0, Math.min(ROWS * TS + CLIFF, v.y));
    return { k: v.k, ox: Math.round(cv.width / 2 - x * v.k), oy: Math.round(cv.height / 2 - y * v.k) };
  }
  function zoom(dir, at) {
    const f = fit(UI.s.island.length), cur = view || f;
    const k = dir === 0 ? f.k : Math.max(1, Math.min(10, cur.k + dir));
    if (dir === 0 || k === f.k && dir < 0 && !at) { view = null; return; }
    // zoom around the pointer if we have one, else around the centre
    let x = cur.x, y = cur.y;
    if (at) { const wx = (at[0] - cam.ox) / cam.k, wy = (at[1] - cam.oy) / cam.k; x = wx - (wx - cur.x) * cur.k / k; y = wy - (wy - cur.y) * cur.k / k; }
    view = { k, x, y };
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
      if (t.id === "furnace" && s.slots.some(j => j && !j.stalled) && frameNo % 6 < 3) {
        ctx.fillStyle = "#fff1a8";
        ctx.fillRect(px + 9, py + 12, 2, 1);
      }
    });
    if (hover >= 0) outline(hover, drag && drag.moved ? "#c8f04a" : UI.placing && !s.island[hover] ? "#c8f04a" : "rgba(255,255,255,.4)");
    if (UI.selected >= 0 && UI.selected < s.island.length) outline(UI.selected, "#ffffff");
    // the building being dragged follows the pointer
    if (drag && drag.moved && drag.tile) {
      const wx = (drag.cx - cam.ox) / cam.k, wy = (drag.cy - cam.oy) / cam.k;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(I.canvas(iconOf(drag.tile)), Math.round(wx - 8), Math.round(wy - 8));
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  const canvasXY = e => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height]; };
  function indexAt(e) {
    const [px, py] = canvasXY(e);
    const x = Math.floor((px - cam.ox) / cam.k / TS), y = Math.floor((py - cam.oy) / cam.k / TS);
    return UI.s.island.findIndex((_, i) => cells[i][0] === x && cells[i][1] === y);
  }

  // pointer: press on a building and drag to move it; press on empty space and drag to pan; a plain click selects
  let drag = null;
  const invCard = $("inv-card");
  const overInventory = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return !!(el && el.closest("#inv-card")); };
  cv.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const i = indexAt(e), [cx, cy] = canvasXY(e);
    drag = { i, tile: i >= 0 ? UI.s.island[i] : null, x: e.clientX, y: e.clientY, cx, cy, moved: false, view: view || fit(UI.s.island.length) };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", e => {
    hover = indexAt(e);
    if (!drag) return;
    const [cx, cy] = canvasXY(e);
    drag.cx = cx; drag.cy = cy;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    if (drag.tile) { cv.classList.add("dragging"); invCard.classList.toggle("drop", overInventory(e)); }
    else { // pan
      const r = cv.getBoundingClientRect(), sx = cv.width / r.width;
      view = { k: drag.view.k, x: drag.view.x - ((e.clientX - drag.x) * sx) / drag.view.k, y: drag.view.y - ((e.clientY - drag.y) * sx) / drag.view.k };
    }
  });
  cv.addEventListener("pointerup", e => {
    const d = drag;
    drag = null;
    cv.classList.remove("dragging");
    invCard.classList.remove("drop");
    if (!d) return;
    const i = indexAt(e), s = UI.s;
    if (d.moved && d.tile) {
      if (overInventory(e)) { A.pickUp(s, d.i); UI.selected = -1; UI.log(`Picked up the ${UI.name(d.tile.id).toLowerCase()}.`, "", d.tile.id === "tree" ? "sapling" : d.tile.id); }
      else if (i >= 0 && A.move(s, d.i, i)) UI.selected = i;
    } else if (!d.moved) {
      if (UI.placing && i >= 0 && !s.island[i]) placeAt(UI.placing, i);
      else { UI.selected = i; UI.placing = null; }
    }
    UI.render();
  });
  cv.addEventListener("pointerleave", () => { hover = -1; });
  // ctrl/⌘ + wheel (or a trackpad pinch) zooms; a plain wheel keeps scrolling the page
  cv.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1 : -1, canvasXY(e));
  }, { passive: false });

  function placeAt(id, i) {
    if (!A.place(UI.s, id, i)) return false;
    UI.selected = i;
    if (!(UI.s.inv[id] > 0)) UI.placing = null; // keep placing while you still have more
    return true;
  }
  // drag a building out of the inventory onto the island
  document.addEventListener("dragstart", e => {
    const el = e.target.closest && e.target.closest("[data-bld]");
    if (!el) return;
    e.dataTransfer.setData("text/x-alchemy-building", el.dataset.bld);
    e.dataTransfer.effectAllowed = "move";
    const im = el.querySelector("img");
    if (im) e.dataTransfer.setDragImage(im, 16, 16);
  });
  cv.addEventListener("dragover", e => {
    if (!e.dataTransfer.types.includes("text/x-alchemy-building")) return;
    e.preventDefault();
    hover = indexAt(e);
    cv.classList.add("drop");
  });
  cv.addEventListener("dragleave", () => cv.classList.remove("drop"));
  cv.addEventListener("drop", e => {
    e.preventDefault();
    cv.classList.remove("drop");
    const id = e.dataTransfer.getData("text/x-alchemy-building"), i = indexAt(e);
    if (!id) return;
    if (i < 0 || UI.s.island[i]) UI.log(i < 0 ? "Drop it on a tile of the island." : "That tile is taken. Drop it on an empty one, or drag that building away first.");
    else placeAt(id, i);
    UI.render();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && UI.placing) { UI.placing = null; UI.render(); } });

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
        return t.tool ? `${UI.name(t.tool).toLowerCase()} · ${t.idle ? "waiting for" : "working on"} ${UI.name(t.sel || s.sel[t.id]).toLowerCase()}` : "empty: insert a tool below";
      case "farmland": return t.seed ? `${UI.name(t.seed).toLowerCase()} · ${Math.floor(t.g * 100)}%` : "pick a seed below";
      case "alloy": case "furnace": { const S = A.STATIONS[t.id]; const q = s[S.q].reduce((a, j) => a + j.n, 0); return q ? `${q} queued` : "idle · queue recipes below"; }
      case "crusher": case "energizedSmelter": case "infuser": return `${D.ELECTRIC[t.id].watts} W · queue recipes below`;
      case "treeHarvester": return `${t.status || "waiting"} · ${Math.floor(t.p * 100)}%`;
      case "fuelGenerator": case "solarGenerator": return `${(t.output || 0).toFixed(1)} W`;
      case "geothermal": return `${(t.output || 0).toFixed(1)} W from lava`;
      case "autoCompressor": return `${t.idle ? "waiting for 9" : "compressing"} ${UI.name(t.sel).toLowerCase()}`;
      case "battery": return `${Math.floor(s.energy).toLocaleString()} / ${A.energyCapacity(s).toLocaleString()} J on the grid`;
      default: return D.ITEMS[t.id].desc || "";
    }
  }

  function renderIsland() {
    const s = UI.s;
    draw();
    const used = s.island.filter(Boolean).length, cost = A.expandCost(s), maxed = s.island.length >= C.land.max;
    UI.v("d:expand", A.count(s, cost.id) < cost.n);
    UI.setHTML($("land"), "land", `${used}/${s.island.length} tiles ${maxed ? "· full size" : `<button class="mini" data-act="expand" data-d="d:expand" data-tip="${cost.id}">Expand · ${cost.n} ${UI.esc(UI.name(cost.id).toLowerCase())}</button>`}`);
    const i = UI.selected, t = s.island[i];
    let h, body = "";
    if (i < 0 || i >= s.island.length) h = `<span class="meta">Click a building to open it. Drag buildings to move them, or onto the inventory to pick them up. New land appears at the dashed square.</span>`;
    else if (!t) h = `<span class="meta">Empty land. Drag a building here from your inventory${Object.keys(D.ITEMS).some(id => A.placesAs(id) && s.inv[id] > 0) ? "" : " (craft one first)"}.</span>`;
    else {
      UI.v("tile:st", status(s, t));
      h = `${UI.img(iconOf(t))}<div class="grow"><b>${UI.esc(UI.name(t.id))}</b><br><span class="meta" data-v="tile:st"></span></div><button class="mini" data-act="pickup:${i}">Pick up</button><button class="mini" data-act="deselect">×</button>`;
      body = UI.machineBody(s, t, i);
    }
    UI.setHTML($("tile"), "tile", h);
    UI.setHTML($("machine"), "machine", body);
    UI.setHTML($("placing"), "placing", UI.placing ? `placing: ${UI.esc(UI.name(UI.placing))} · click an empty tile (Esc to stop)` : "");
    const cap = A.energyCapacity(s);
    UI.v("grid:st", `⚡ ${Math.floor(s.energy).toLocaleString()} / ${cap.toLocaleString()} J · ${s.power.generated.toFixed(0)} W in, ${s.power.used.toFixed(0)} W out`);
    UI.setHTML($("grid"), "grid", cap ? `<span data-v="grid:st"></span>` : "");
  }

  Object.assign(UI.handlers, {
    pickup: ([i]) => {
      const t = UI.s.island[+i];
      if (t && A.pickUp(UI.s, +i)) { UI.selected = -1; UI.log(`Picked up the ${UI.name(t.id).toLowerCase()}.`, "", t.id === "tree" ? "sapling" : t.id); }
    },
    deselect: () => { UI.selected = -1; },
    placing: ([id]) => { UI.placing = UI.placing === id ? null : id; },
    zoom: ([d]) => zoom(+d),
  });
  UI.renderers.push(renderIsland);
})();
