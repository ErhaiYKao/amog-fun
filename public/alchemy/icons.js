/* Alchemy — procedural 16x16 pixel icons, drawn from each item's icon spec in data.js.
 *   AlchemyIcons.url(id)    -> data URL for <img>
 *   AlchemyIcons.canvas(id) -> 16x16 canvas for drawImage
 */
(function (root) {
  "use strict";
  const { ITEMS, MOBS } = root.ALCHEMY_DATA;
  const WOOD = "#8a6236";

  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function shade(h, f) {
    const k = f >= 0 ? c => c + (255 - c) * f : c => c * (1 + f);
    const [r, g, b] = rgb(h).map(c => Math.max(0, Math.min(255, k(c)) | 0));
    return `rgb(${r},${g},${b})`;
  }
  function hash(x, y, seed) {
    let n = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  const seedOf = id => [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);

  // rotated coordinates around the handle end, for tool heads
  const along = (x, y, cx, cy) => [((x - cx) + (y - cy)) / Math.SQRT2, ((x - cx) - (y - cy)) / Math.SQRT2];

  function handle(P, from = [2, 13], to = [9, 6]) {
    for (let i = 0; i <= 10; i++) {
      const x = Math.round(from[0] + (to[0] - from[0]) * i / 10), y = Math.round(from[1] + (to[1] - from[1]) * i / 10);
      P(x, y, WOOD); P(x + 1, y, shade(WOOD, -0.35));
    }
  }
  function disc(P, cx, cy, r, color, light = 0.3, rnd) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      let f = -((x - cx) + (y - cy)) / (2 * r) * light;
      if (rnd) f += (rnd(x, y, 9) - 0.5) * 0.12;
      P(x, y, shade(color, f));
    }
  }

  const SHAPES = {
    sword(P, c) {
      for (let k = 0; k < 9; k++) { const x = 5 + k, y = 10 - k; P(x, y, shade(c, 0.25)); P(x + 1, y, c); P(x + 1, y + 1, shade(c, -0.3)); }
      for (let k = -2; k <= 2; k++) P(5 + k, 10 + k, "#5a3d24"); // crossguard
      P(3, 13, "#8a6236"); P(2, 14, "#8a6236"); P(4, 12, "#8a6236"); P(1, 15, "#c9a227");
    },
    armor(P, c) {
      for (let y = 3; y < 14; y++) for (let x = 2; x < 14; x++) {
        const shoulder = y < 6 && (x < 5 || x > 10), neck = y < 5 && x > 5 && x < 10, sleeve = y >= 8 && (x < 4 || x > 11);
        if (neck || sleeve || (y >= 6 && y < 8 && (x < 3 || x > 12))) continue;
        if (y < 3 || (!shoulder && y < 5 && (x < 6 || x > 9) && false)) continue;
        P(x, y, shade(c, (x < 5 ? 0.15 : x > 10 ? -0.25 : 0) + (y === 13 ? -0.3 : 0)));
      }
      for (let x = 6; x < 10; x++) P(x, 5, shade(c, -0.45));
    },
    bone(P, c) {
      for (let k = 0; k < 8; k++) { P(4 + k, 11 - k, c); P(5 + k, 11 - k, shade(c, -0.15)); }
      for (const [x, y] of [[2, 11], [3, 12], [3, 10], [4, 13], [12, 2], [13, 3], [11, 1], [13, 4]]) P(x, y, shade(c, 0.1));
    },
    hide(P, c, _, rnd) {
      for (let y = 3; y < 14; y++) for (let x = 3; x < 13; x++) {
        if ((y === 3 || y === 13) && (x < 5 || x > 10)) continue;
        if ((x === 3 || x === 12) && (y < 5 || y > 11)) continue;
        P(x, y, shade(c, (rnd(x, y) - 0.5) * 0.2 + (x > 10 ? -0.2 : 0)));
      }
    },
    cane(P, c) {
      for (const x of [5, 9]) for (let y = 2; y < 15; y++) P(x + (y > 8 ? 1 : 0), y, shade(c, y % 4 === 0 ? -0.35 : x === 9 ? -0.1 : 0.1));
      P(4, 5, "#9ad46a"); P(3, 4, "#9ad46a"); P(11, 9, "#9ad46a"); P(12, 8, "#9ad46a");
    },
    sheet(P, c) {
      for (let y = 2; y < 15; y++) for (let x = 3; x < 13; x++) P(x, y, (x === 12 || y === 14) ? shade(c, -0.2) : c);
      for (let y = 5; y < 13; y += 2) for (let x = 5; x < 11; x++) P(x, y, "#b9b3a3");
    },
    book(P, c) {
      for (let y = 2; y < 15; y++) for (let x = 3; x < 13; x++) P(x, y, x === 3 ? shade(c, -0.4) : x === 12 ? "#efe9d8" : shade(c, y === 2 || y === 14 ? -0.2 : 0));
      for (let x = 6; x < 11; x++) P(x, 6, "#e3c35a");
    },
    enchant(P, _, __, rnd) {
      for (let y = 8; y < 16; y++) for (let x = 0; x < 16; x++) P(x, y, shade("#2a1f3d", (rnd(x, y) - 0.5) * 0.2 + (y === 8 ? 0.2 : 0)));
      for (let y = 6; y < 8; y++) for (let x = 1; x < 15; x++) P(x, y, x === 1 || x === 14 ? "#5ee0d8" : "#c0392b");
      for (let y = 2; y < 6; y++) for (let x = 5; x < 11; x++) P(x, y, x === 8 ? "#5a2a1f" : "#8b3a2b"); // the open book
      P(6, 3, "#efe9d8"); P(9, 3, "#efe9d8");
    },
    mob(P, c, kind) {
      for (let y = 1; y < 15; y++) for (let x = 2; x < 14; x++) P(x, y, shade(c, (x < 4 ? 0.12 : x > 11 ? -0.2 : 0) + (y > 11 ? -0.1 : 0)));
      const eye = { zombie: "#1d2a17", skeleton: "#111111", spider: "#d42a1f", enderman: "#c77dff" }[kind] || "#000";
      if (kind === "spider") { for (const [x, y] of [[4, 5], [6, 5], [9, 5], [11, 5], [5, 7], [10, 7]]) P(x, y, eye); }
      else { P(4, 6, eye); P(5, 6, eye); P(10, 6, eye); P(11, 6, eye); if (kind === "enderman") { P(3, 6, eye); P(12, 6, eye); } }
      if (kind === "zombie") for (let x = 5; x < 11; x++) P(x, 10, shade(c, -0.45));
      if (kind === "skeleton") for (let x = 5; x < 11; x++) P(x, 10, x % 2 ? "#111" : shade(c, -0.3));
    },
    paperclip(P, c) {
      for (let y = 3; y <= 12; y++) { P(4, y, c); P(11, y, c); }
      for (let x = 5; x <= 10; x++) { P(x, 2, c); P(x, 13, c); }
      for (let y = 5; y <= 10; y++) { P(7, y, c); P(9, y, c); }
      P(8, 4, c); P(10, 11, c); P(11, 11, c);
    },
    power(P, c, _, rnd) {
      SHAPES.block(P, "#56606d", "cobble", rnd);
      for (let y = 3; y < 13; y++) {
        const x = y < 8 ? 9 - Math.floor((y - 3) / 2) : 10 - Math.floor((y - 8) / 2);
        P(x, y, c); P(x - 1, y, c); P(x - 2, y, c);
      }
    },
    solar(P, c) {
      for (let y = 2; y < 12; y++) for (let x = 1; x < 15; x++)
        P(x, y, x % 4 === 1 || y % 3 === 2 ? "#abc3de" : c);
      for (let y = 12; y < 16; y++) { P(4, y, "#727c87"); P(11, y, "#727c87"); }
    },
    battery(P, c) {
      for (let x = 6; x < 10; x++) P(x, 1, "#d0d8de");
      for (let y = 2; y < 15; y++) for (let x = 3; x < 13; x++)
        P(x, y, x === 3 || x === 12 || y === 2 || y === 14 ? "#737f8b" : c);
      for (let x = 6; x < 10; x++) P(x, 6, "#263d3a");
      for (let y = 4; y < 9; y++) P(8, y, "#263d3a");
    },
    harvester(P, c, _, rnd) {
      SHAPES.block(P, c, "cobble", rnd);
      SHAPES.axe(P, "#d0d8de");
      P(12, 13, "#4fd6e8");
    },
    block(P, c, v, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let f = (rnd(x, y) - 0.5) * 0.16;
        if (v === "dirt") { if (rnd(x, y, 1) < 0.12) f -= 0.25; if (rnd(x, y, 2) < 0.05) f += 0.15; }
        if (v === "cobble") {
          const row = Math.floor(y / 5), ox = (x + (row % 2) * 3) % 16;
          if (ox % 5 === 0 || y % 5 === 0) f -= 0.32; else f += (hash(Math.floor(ox / 5), row, 3) - 0.5) * 0.3;
        }
        if (v === "gravel") f += (rnd(x, y, 3) - 0.5) * 0.5;
        if (v === "sand") f += (rnd(x, y, 3) - 0.5) * 0.1;
        if (v === "dust") f = (rnd(x, y) - 0.5) * 0.08;
        if (v === "clay") f += y % 5 === 0 ? -0.06 : 0;
        if (v === "compressed") { f += (rnd(x, y, 3) - 0.5) * 0.25; if (x === 2 || y === 2 || x === 13 || y === 13) f -= 0.4; if (x < 2 || y < 2 || x > 13 || y > 13) f -= 0.15; }
        if (y === 15 || x === 15) f -= 0.12;
        P(x, y, shade(c, f));
      }
    },
    log(P, bark, wood, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const edge = x < 2 || y < 2 || x > 13 || y > 13;
        const ring = Math.floor(Math.hypot(x - 7.5, y - 7.5) * 1.1) % 2;
        P(x, y, edge ? shade(bark, (rnd(x, y) - 0.5) * 0.3) : shade(wood, (ring ? -0.14 : 0.04) + (rnd(x, y) - 0.5) * 0.06));
      }
    },
    planks(P, c, _, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const row = Math.floor(y / 4);
        let f = (rnd(x, y) - 0.5) * 0.12 + (row % 2 ? -0.05 : 0.04);
        if (y % 4 === 3) f = -0.32; else if ((x + row * 5) % 8 === 0) f = -0.22;
        P(x, y, shade(c, f));
      }
    },
    leaves(P, c, _, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const r = rnd(x, y);
        if (r < 0.08) continue;
        P(x, y, shade(c, (rnd(x, y, 1) - 0.5) * 0.5 - (r < 0.2 ? 0.22 : 0)));
      }
    },
    infested(P, _, __, rnd) {
      SHAPES.leaves(P, "#4b7d3a", 0, rnd);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        if ((x + y) % 5 === 0 || (x - y + 16) % 7 === 0) if (rnd(x, y, 4) < 0.7) P(x, y, "#f1f0ea");
    },
    tree(P, _, __, rnd) {
      for (let y = 10; y < 16; y++) { P(7, y, "#6b4a2b"); P(8, y, "#4f361f"); }
      for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot((x - 7.5) / 1.05, y - 5.6);
        if (d > 6.2 + (rnd(x, y) - 0.5) * 1.2) continue;
        P(x, y, shade("#3f7a2e", (rnd(x, y, 1) - 0.5) * 0.45 - (x + y - 10) * 0.02));
      }
    },
    sapling(P, c) {
      for (let y = 8; y < 15; y++) P(8, y, "#5a7a2a");
      [[5, 8], [11, 7], [8, 4]].forEach(([cx, cy]) => disc(P, cx, cy, 2.6, c, 0.4));
    },
    stick(P, c) { handle(P, [3, 13], [12, 3]); },
    string(P, c) {
      for (let x = 1; x < 15; x++) { const y = Math.round(8 + 3 * Math.sin(x / 1.8)); P(x, y, c); P(x, y + 1, shade(c, -0.3)); }
    },
    twine(P, c) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5), a = Math.atan2(y - 7.5, x - 7.5);
        if (d > 3.2 && d < 6.2) P(x, y, shade(c, Math.floor((a + 4) * 2.2) % 2 ? -0.25 : 0.08));
      }
    },
    worm(P, c) {
      for (let i = 0; i < 6; i++) disc(P, 3 + i * 2, 9 + Math.round(2 * Math.sin(i * 0.9)), 1.7, c, i % 2 ? 0.7 : 0.25);
      P(14, 10, "#222");
    },
    seeds(P, c) { [[4, 5], [9, 4], [6, 9], [11, 9], [8, 12]].forEach(([x, y]) => { P(x, y, c); P(x + 1, y, shade(c, -0.2)); P(x, y + 1, shade(c, -0.35)); }); },
    pebble(P, c, _, rnd) { disc(P, 8, 9, 4.6, c, 0.45, rnd); },
    ball(P, c, _, rnd) { disc(P, 8, 8, 4.8, c, 0.5, rnd); },
    lump(P, c, _, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const a = Math.atan2(y - 8, x - 8), r = 5.4 + 1.1 * Math.sin(3 * a + 1);
        if (Math.hypot(x - 8, y - 8) > r) continue;
        P(x, y, rnd(x, y) < 0.14 ? shade(c, 0.45) : shade(c, (rnd(x, y, 1) - 0.5) * 0.3));
      }
    },
    shard(P, c) {
      const tri = [[3, 13], [8, 2], [13, 11]];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const s = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
        const a = s(tri[0], tri[1]), b = s(tri[1], tri[2]), d = s(tri[2], tri[0]);
        if ((a >= 0 && b >= 0 && d >= 0) || (a <= 0 && b <= 0 && d <= 0)) P(x, y, shade(c, x < 8 ? 0.18 : -0.1));
      }
    },
    pieces(P, c, _, rnd) { [[5, 6], [11, 5], [8, 11]].forEach(([x, y]) => disc(P, x, y, 2.4, c, 0.5, rnd)); },
    chunk(P, c, _, rnd) {
      disc(P, 8, 8.5, 5.6, "#8f8f8f", 0.4, rnd);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        if (Math.hypot(x - 8, y - 8.5) < 5 && rnd(x, y, 5) < 0.28) P(x, y, shade(c, (rnd(x, y, 6) - 0.5) * 0.3));
    },
    ingot(P, c) {
      for (let y = 5; y < 12; y++) {
        const x0 = y < 7 ? 4 : 2, x1 = y < 7 ? 11 : 13;
        for (let x = x0; x <= x1; x++) P(x, y, y < 7 ? shade(c, 0.3) : y === 11 ? shade(c, -0.4) : shade(c, x > 11 ? -0.2 : 0));
      }
    },
    gem(P, c, v) {
      for (let y = 2; y < 15; y++) {
        const w = y < 6 ? 2 + (y - 2) * 1.5 : 7.5 - (y - 6) * 0.85;
        for (let x = 0; x < 16; x++) {
          const dx = x - 7.5;
          if (Math.abs(dx) > w) continue;
          P(x, y, shade(c, y < 6 ? 0.3 : dx < 0 ? 0.08 : -0.22));
        }
      }
      if (v === "glow") { P(6, 5, "#fff"); P(7, 4, "#fff"); }
    },
    pile(P, c, _, rnd) {
      for (let y = 6; y < 14; y++) for (let x = 0; x < 16; x++)
        if (Math.abs(x - 7.5) <= (y - 5) * 0.95) P(x, y, shade(c, (rnd(x, y) - 0.5) * 0.5 + (y < 8 ? 0.2 : 0)));
    },
    gear(P, c) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5), a = Math.atan2(y - 7.5, x - 7.5);
        const r = Math.cos(a * 8) > 0.2 ? 7.2 : 5.6;
        if (d <= r && d > 1.9) P(x, y, shade(c, -((x - 7.5) + (y - 7.5)) / 18));
      }
    },
    mesh(P, c) {
      for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
        const frame = x === 1 || y === 1 || x === 14 || y === 14;
        if (frame) P(x, y, shade(c, -0.3)); else if (x % 3 === 1 || y % 3 === 1) P(x, y, c);
      }
    },
    bucket(P, c, liquid) {
      for (let y = 3; y < 14; y++) {
        const inset = Math.round((y - 3) * 0.25);
        for (let x = 2 + inset; x <= 13 - inset; x++) {
          let col = shade(c, x < 6 ? 0.15 : x > 10 ? -0.25 : 0);
          if (y === 3) col = shade(c, -0.3);
          if (y === 4 && x > 2 + inset && x < 13 - inset) col = liquid ? shade(liquid, 0.1) : shade(c, -0.55);
          P(x, y, col);
        }
      }
    },
    cast(P, c) {
      for (let y = 3; y < 13; y++) for (let x = 2; x < 14; x++) P(x, y, shade(c, y === 3 ? 0.2 : y === 12 ? -0.3 : 0));
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 3.5, y - 12.5), a = Math.atan2(12.5 - y, x - 3.5) * 180 / Math.PI;
        if ((d > 7.2 && d < 8.8 && a > 15 && a < 75) || (Math.abs((x - 3.5) - (12.5 - y)) < 1 && d < 7.5 && y > 4 && y < 12)) P(x, y, shade(c, -0.4));
      }
    },
    pot(P, c) {
      for (let y = 5; y < 14; y++) {
        const w = y < 7 ? 6 : 6 - (y - 7) * 0.45;
        for (let x = 0; x < 16; x++) if (Math.abs(x - 7.5) <= w) P(x, y, shade(c, y === 5 ? 0.25 : y === 6 && Math.abs(x - 7.5) < w - 1 ? -0.5 : x < 7 ? 0.08 : -0.15));
      }
    },
    torch(P) {
      for (let y = 7; y < 15; y++) { P(7, y, WOOD); P(8, y, shade(WOOD, -0.3)); }
      [[7, 5, "#ffd23f"], [8, 5, "#ffb03b"], [7, 6, "#ff8c1a"], [8, 6, "#ff8c1a"], [7, 4, "#fff1a8"], [8, 4, "#ffd23f"], [7, 3, "#fff1a8"]].forEach(([x, y, col]) => P(x, y, col));
    },
    pick(P, c) {
      handle(P);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 3.5, y - 12.5), a = Math.atan2(12.5 - y, x - 3.5) * 180 / Math.PI;
        if (d > 9.3 && d < 11.4 && a > 10 && a < 80) P(x, y, shade(c, d < 10.3 ? 0.2 : -0.2));
      }
    },
    axe(P, c) {
      handle(P);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const [u, v] = along(x, y, 10, 5);
        if (u >= -1 && u <= 4 && Math.abs(v) <= 1.3 + Math.max(0, u - 0.5) * 0.7) P(x, y, shade(c, u > 3 ? 0.25 : v > 0 ? -0.2 : 0));
      }
    },
    hammer(P, c) {
      handle(P);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const [u, v] = along(x, y, 10.5, 4.5);
        if (Math.abs(v) <= 4.3 && Math.abs(u) <= 2.2) P(x, y, shade(c, Math.abs(v) > 3.2 ? -0.25 : u < 0 ? 0.2 : 0));
      }
    },
    crook(P, c) {
      handle(P, [3, 14], [9, 5]);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 11, y - 4.5), a = Math.atan2(y - 4.5, x - 11);
        if (d > 2 && d < 3.6 && !(a > 0.2 && a < 1.9)) P(x, y, shade(c, a < 0 ? 0.15 : -0.2));
      }
    },
    table(P, _, __, rnd) {
      SHAPES.planks(P, "#b08850", 0, rnd);
      for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) P(x, y, x % 5 === 0 || y === 2 || y === 4 ? "#6b4a2b" : shade("#c79c62", (rnd(x, y) - 0.5) * 0.1));
    },
    barrel(P, c, water, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 1; x < 15; x++) {
        let f = (rnd(x, y) - 0.5) * 0.1 + (x % 4 === 0 ? -0.25 : 0) + (x < 4 ? 0.08 : x > 11 ? -0.18 : 0);
        let col = shade(c, f);
        if (y === 3 || y === 12) col = "#4c4c50";
        if (y === 0) col = shade(c, -0.35);
        if (y === 1 && x > 1 && x < 14) col = water ? shade(water, (rnd(x, y, 2) - 0.5) * 0.2) : shade(c, -0.5);
        P(x, y, col);
      }
    },
    sieve(P, c, __, rnd) {
      const frame = c === "#888888" ? "#b08850" : c, leg = c === "#888888" ? WOOD : shade(c, -0.2);
      for (let y = 8; y < 16; y++) { P(2, y, leg); P(13, y, shade(leg, -0.3)); }
      for (let y = 5; y < 9; y++) for (let x = 1; x < 15; x++) P(x, y, shade(frame, (rnd(x, y) - 0.5) * 0.12 + (y === 8 ? -0.3 : 0)));
      for (let y = 2; y < 5; y++) for (let x = 2; x < 14; x++) P(x, y, (x + y) % 2 ? "#f2efe6" : "#9c9181");
    },
    furnace(P, c, __, rnd) {
      SHAPES.block(P, c === "#888888" ? "#7b7b7b" : c, "cobble", rnd);
      for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) P(x, y, y > 10 ? (rnd(x, y, 7) < 0.5 ? "#ff8c1a" : "#ffd23f") : "#1c1c1f");
      for (let x = 4; x < 12; x += 2) P(x, 3, "#2a2a2e");
    },
    crucible(P, _, __, rnd) {
      SHAPES.pot(P, "#b8643f");
      for (let x = 3; x < 13; x++) P(x, 6, rnd(x, 6, 2) < 0.5 ? "#ff7a1a" : "#ffb03b");
    },
    gen(P, _, __, rnd) {
      SHAPES.block(P, "#7b7b7b", "cobble", rnd);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) { P(x, y, shade("#ff7a1a", (rnd(x, y, 3) - 0.5) * 0.4)); P(15 - x, y, shade("#3f76e4", (rnd(x, y, 4) - 0.5) * 0.3)); }
    },
    autohammer(P, c, __, rnd) {
      const edge = c === "#888888" ? "#5c5c62" : c;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        P(x, y, x === 0 || y === 0 || x === 15 || y === 15 || (c !== "#888888" && (x === 1 || y === 1 || x === 14 || y === 14)) ? edge : shade("#b9b9bf", (rnd(x, y) - 0.5) * 0.1));
      SHAPES.hammer((x, y, col) => { if (x > 1 && y > 1 && x < 14 && y < 14) P(x, y, col); }, "#4c4c52");
      P(12, 12, "#d42a1f");
    },
    autosieve(P, c, __, rnd) {
      const edge = c === "#888888" ? "#5c5c62" : c;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        P(x, y, x === 0 || y === 0 || x === 15 || y === 15 || (c !== "#888888" && (x === 1 || y === 1 || x === 14 || y === 14)) ? edge : shade("#b9b9bf", (rnd(x, y) - 0.5) * 0.1));
      for (let y = 3; y < 9; y++) for (let x = 3; x < 13; x++) P(x, y, (x + y) % 2 ? "#f2efe6" : "#7c7c84");
      P(12, 12, "#d42a1f");
    },
    autogen(P, c, _, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        P(x, y, x === 0 || y === 0 || x === 15 || y === 15 ? c : shade("#b9b9bf", (rnd(x, y) - 0.5) * 0.1));
      for (let y = 3; y < 11; y++) for (let x = 3; x < 13; x++) {
        const row = Math.floor(y / 3), ox = (x + (row % 2) * 2) % 4;
        P(x, y, x < 5 ? shade("#ff7a1a", (rnd(x, y, 3) - 0.5) * 0.4) : x > 10 ? shade("#3f76e4", (rnd(x, y, 4) - 0.5) * 0.3) : shade("#7b7b7b", ox === 0 || y % 3 === 0 ? -0.3 : 0));
      }
      P(12, 12, "#d42a1f"); P(3, 12, c); P(4, 12, c);
    },
    wheat(P, c) {
      for (const x of [4, 7, 10]) {
        for (let y = 7; y < 15; y++) P(x + (y > 11 ? 1 : 0), y, shade("#8a9a3a", -0.1));
        for (let y = 2; y < 8; y++) { P(x - 1, y, shade(c, (y % 2) * -0.2)); P(x + 1, y, shade(c, ((y + 1) % 2) * -0.2)); P(x, y - 1, c); }
      }
    },
    farm(P, _, __, rnd) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        P(x, y, shade("#5a3a22", (rnd(x, y) - 0.5) * 0.2 + (y % 4 === 0 ? -0.3 : 0) + (x === 0 || x === 15 ? -0.2 : 0)));
      for (const x of [3, 7, 11]) for (const y of [2, 6, 10]) { P(x, y + 1, "#6aa246"); P(x + 1, y, "#8fc25a"); P(x + 1, y + 1, "#6aa246"); }
      for (let x = 1; x < 15; x++) P(x, 14, "#3f76e4");
    },
    terminal(P) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const ray = (Math.abs(x - 7.5) < 1 || Math.abs(y - 7.5) < 1) && d < 7;
        P(x, y, d < 1.6 ? "#ffffff" : ray ? `rgba(79,214,232,${(0.9 - d / 8).toFixed(2)})` : x === 0 || y === 0 || x === 15 || y === 15 ? "#4fd6e8" : "#0b0b12");
      }
    },
  };

  const cache = {};
  function canvas(id) {
    if (cache[id]) return cache[id];
    const spec = (ITEMS[id] && ITEMS[id].icon) || (MOBS && MOBS[id] && MOBS[id].icon) || [id];
    const cv = document.createElement("canvas");
    cv.width = cv.height = 16;
    const ctx = cv.getContext("2d");
    const P = (x, y, col) => { if (x < 0 || y < 0 || x > 15 || y > 15) return; ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
    const seed = seedOf(id);
    const rnd = (x, y, k = 0) => hash(x, y, seed + k * 101);
    (SHAPES[spec[0]] || SHAPES.pebble)(P, spec[1] || "#888888", spec[2], rnd);
    return (cache[id] = cv);
  }
  const urls = {};
  const url = id => urls[id] || (urls[id] = canvas(id).toDataURL());

  root.AlchemyIcons = { canvas, url };
})(window);
