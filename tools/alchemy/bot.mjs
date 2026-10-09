// Alchemy bot: plays engine.js from a fresh island to the Terminal Object, following the quests.
// Run: node tools/alchemy/bot.mjs   (prints when each quest completes, in simulated time and clicks)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const A = require("../../public/alchemy/engine.js");
const { RECIPES, SMELT, QUESTS, ACTIONS, ITEMS } = A.DATA;

const CPS = 5; // clicks per second
const s = A.create(0);
let t = 0, clicks = 0;
const tick = secs => { for (let x = secs; x > 0; x -= 1) A.tick(s, Math.min(1, x)); t += secs; };
const click = (act, input) => { if (input) s.sel[act] = input; const r = A.act(s, act); clicks++; tick(1 / CPS); return r; };
const wait = () => tick(1);

const SIEVED = {}; // item -> [input, mesh tier needed]
for (const [inp, table] of Object.entries(A.DATA.SIEVE)) for (const [id, , , gate] of table) {
  const tier = typeof gate === "number" ? gate : 1;
  if (!SIEVED[id] || SIEVED[id][1] > tier) SIEVED[id] = [inp, tier];
}
const HAMMERED = { gravel: "cobble", sand: "gravel", dust: "sand" };
const SMELTED = Object.fromEntries(Object.entries(SMELT).map(([k, v]) => [v.out, k]));
const MESHES = ["stringMesh", "flintMesh", "ironMesh", "diamondMesh"];
const FUEL = { 1: "planks", 2: "charcoal", 3: "coal" };

function land(d) {
  if (A.free(s) > 0) return true;
  if (s.island.length >= A.DATA.CONFIG.land.max) throw new Error("island is full");
  if (need(A.expandCost(s).id, A.expandCost(s).n, d + 1)) A.expand(s);
  return false;
}

// make one unit of progress towards having n of id; true once we have it
// buildings count once they're on the island: craft one into the inventory, then place it
function needBuilt(id, n, d) {
  if (A.built(s, id) >= n) return true;
  const item = id === "tree" ? "sapling" : id;
  if ((s.inv[item] || 0) > 0) { if (land(d)) A.place(s, item, s.island.indexOf(null)); return false; }
  if (id === "tree") return need("sapling", 1, d + 1) && false;
  return need(id, A.count(s, id) + 1, d + 1) && false;
}

function need(id, n, d = 0) {
  if (A.count(s, id) >= n) return true;
  if (d > 14) { wait(); return false; }
  const act = () => false;
  if (id === "log") { if (A.grownTrees(s)) click("chop"); else wait(); return act(); }
  if (id === "leaves" || id === "sapling") { if (A.grownTrees(s)) click("leaves"); else wait(); return act(); }
  if (id === "silkworm") { if (!need("crook", 1, d + 1)) return false; click("leaves"); return act(); }
  if (id === "string") { if (needBuilt("infested", 1, d + 1)) wait(); return false; }
  if (id === "dirt") { if (needBuilt("barrel", A.free(s) ? Math.min(3, 1 + Math.floor(s.island.length / 8)) : 1, d + 1)) { if (A.grownTrees(s)) click("leaves"); else wait(); } return false; }
  if (id === "cobble" && A.built(s, "cobblegen") && A.tool(s, "pick")) { click("mine"); return false; }
  if (id === "cobble" && s.island.some(t => t && A.DATA.CONFIG.autoGen[t.id])) { wait(); return false; }
  if (HAMMERED[id]) {
    if (!A.tool(s, "hammer") && !need("woodHammer", 1, d + 1)) return false;
    if (!need(HAMMERED[id], 1, d + 1)) return false;
    click("hammer", HAMMERED[id]); return false;
  }
  if (SIEVED[id]) {
    const [inp, tier] = SIEVED[id];
    if (!needBuilt("sieve", 1, d + 1)) return false;
    if (A.toolValue(s, "mesh") < tier && !need(MESHES[tier - 1], 1, d + 1)) return false;
    if (!need(inp, 1, d + 1)) return false;
    click("sieve", inp); return false;
  }
  if (id === "clayBlock") {
    if (!needBuilt("rainBarrel", 1, d + 1) || !need("dust", 1, d + 1)) return false;
    if (!A.mixClay(s)) wait();
    return false;
  }
  if (id === "waterBucket" || id === "lavaBucket") {
    const water = id === "waterBucket";
    if (!need("bucket", 1, d + 1) || !needBuilt(water ? "rainBarrel" : "crucible", 1, d + 1)) return false;
    if (!water && !A.lavaCrucible(s) && !need("cobble", 4, d + 1)) return false;
    if (!A.fillBucket(s, water ? "water" : "lava")) wait();
    return false;
  }
  if (A.DATA.ALLOY[id]) {
    if (!needBuilt("alloy", 1, d + 1)) return false;
    const busy = s.aqueue.length || s.aslots.some(Boolean);
    if (!busy) for (const [k, v] of Object.entries(A.DATA.ALLOY[id].in)) if (!need(k, v, d + 1)) return false;
    if (s.fuel[3] < 20) { if (!need("coal", 2, d + 1)) return false; A.addFuel(s, "coal", 2); }
    if (!busy) A.queueAt(s, "alloy", id, 1); else wait();
    return false;
  }
  if (SMELTED[id] && !(id === "gold" && A.count(s, "pstone"))) {
    const inp = SMELTED[id], heat = SMELT[inp].heat;
    if (!needBuilt("furnace", 1, d + 1)) return false;
    const busy = s.queue.length || s.slots.some(Boolean);
    if (!busy && !need(inp, 1, d + 1)) return false;
    const fuel = s.fuel.slice(heat).reduce((a, b) => a + b, 0);
    if (fuel < 20) {
      const f = FUEL[heat];
      if (!need(f, 2, d + 1)) return false;
      A.addFuel(s, f, 2);
    }
    if (!busy) A.queueSmelt(s, inp, 1); else wait();
    return false;
  }
  const r = RECIPES.find(r => r.out[id]);
  if (!r) throw new Error("no way to make " + id);
  const st = A.recipeState(s, r);
  if (st.ok) { A.craft(s, r, 1); return false; }
  if (r.at === "table" && !A.built(s, "table")) return needBuilt("table", 1, d + 1) && false;
  for (const k in r.needs || {}) if (!need(k, r.needs[k], d + 1)) return false;
  for (const [k, v] of Object.entries(A.cost(s, r))) if (!need(k, v, d + 1)) return false;
  if (st.reason === "no free land") land(d);
  return false;
}

function pursue(q) {
  const nd = q.need;
  for (const [id, n] of Object.entries(nd.got || {})) {
    const target = A.count(s, id) + Math.max(0, n - (s.got[id] || 0));
    if ((s.got[id] || 0) < n) return need(id, target);
  }
  for (const [id, n] of Object.entries(nd.built || {})) if (A.built(s, id) < n) return needBuilt(id, n, 0);
  if (nd.anyBuilt && !nd.anyBuilt.some(id => A.built(s, id))) return needBuilt(nd.anyBuilt[0], 1, 0);
  if (nd.gotAny && !nd.gotAny.some(id => s.got[id])) return need(nd.gotAny[0], 1);
  if (nd.land && s.island.length < nd.land) { if (need(A.expandCost(s).id, A.expandCost(s).n)) A.expand(s); return; }
  wait();
}

const fmt = x => `${Math.floor(x / 60)}m${String(Math.floor(x % 60)).padStart(2, "0")}s`;
let q, lastQ = null, steps = 0;
while ((q = A.currentQuest(s)) && steps++ < 400000 && t < 6 * 3600) {
  if (q !== lastQ) { console.log(`${fmt(t).padStart(9)}  ${String(clicks).padStart(6)} clicks  → ${q.title}`); lastQ = q; }
  pursue(q);
}
const barrels = A.built(s, "barrel");
console.log(q ? `STUCK on "${q.title}" after ${fmt(t)}` : `WON in ${fmt(t)}, ${clicks} clicks · island ${s.island.length} tiles, ${barrels} barrels`);
process.exit(q ? 1 : 0);
