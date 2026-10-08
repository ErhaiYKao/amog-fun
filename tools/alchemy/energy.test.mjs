import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const A = createRequire(import.meta.url)('../../public/alchemy/engine.js');
const D = A.DATA;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function island(...ids) {
  const s = A.create(0);
  s.island = Array(36).fill(null);
  for (const id of ids) { A.give(s, id); A.place(s, id, s.island.indexOf(null)); } // crafted buildings go to the inventory first
  return s;
}
function run(s, seconds, step = 0.1) {
  for (let t = 0; t < seconds - 1e-9; t += step) A.tick(s, Math.min(step, seconds - t));
}
test('sand rewards exceed gravel ore yields at every mesh tier; dust has secondary drops', () => {
  const ore = (input, tier) => D.SIEVE[input].reduce((sum, [id, chance, n, gate]) =>
    sum + (['ironPiece', 'goldPiece'].includes(id) && (!gate || gate <= tier) ? Math.min(1, chance * D.CONFIG.meshLuck[tier]) * n : 0), 0);
  for (let tier = 1; tier <= 4; tier++) assert.ok(ore('sand', tier) > ore('gravel', tier));
  for (const id of ['clay', 'goldPiece']) assert.ok(D.SIEVE.dust.some(d => d[0] === id));
});
test('paperclips consume steel and have no mechanical use', () => {
  const s = island('table');
  A.give(s, 'steel', 3);
  assert.equal(A.craft(s, D.RECIPES.find(r => r.out.paperclip), 3), 3);
  assert.equal(s.inv.paperclip, 24);
  assert.equal(s.inv.steel, 0);
  assert.ok(!D.RECIPES.some(r => r.in.paperclip));
});
test('generators produce joules at their watt rating and preserve unused fuel', () => {
  const s = island('fuelGenerator', 'solarGenerator');
  A.give(s, 'charcoal', 2);
  run(s, 10);
  close(s.energy, 500);
  assert.equal(s.inv.charcoal, 1);
  close(s.island[0].fuelJ, 1200);
  close(s.power.generated, 50);
  close(s.power.used, 0);
  s.energy = A.energyCapacity(s);
  const remaining = s.island[0].fuelJ;
  run(s, 5);
  close(s.energy, 6000);
  close(s.island[0].fuelJ, remaining);
  assert.equal(s.inv.charcoal, 1);
});
test('paused generators and empty fuel do not produce energy', () => {
  const s = island('fuelGenerator', 'solarGenerator');
  s.island[1].enabled = false;
  run(s, 3);
  close(s.energy, 0);
  A.give(s, 'charcoal', 1);
  s.island[0].enabled = false;
  run(s, 3);
  assert.equal(s.inv.charcoal, 1);
  close(s.energy, 0);
});
test('powered jobs stall without energy, resume fractionally, and charge exactly J = W × s', () => {
  const s = island('battery', 'crusher');
  A.give(s, 'ironChunk', 1);
  A.queueAt(s, 'crusher', 'ironChunk', 1);
  run(s, 10);
  assert.equal(s.crusherSlots[0].p, 0);
  assert.equal(s.crusherSlots[0].stalled, true);
  s.energy = 45;
  run(s, 10);
  close(s.crusherSlots[0].p, 0.5);
  close(s.energy, 0);
  assert.equal(s.inv.ironDust || 0, 0);
  s.energy = 145;
  run(s, 1.5);
  assert.equal(s.inv.ironDust, 2);
  close(s.energy, 100);
});
test('crusher and energized smelter double ore, and infuser uses reduced reagents', () => {
  const s = island('battery', 'crusher', 'energizedSmelter', 'infuser');
  s.energy = 1000;
  A.give(s, 'goldChunk', 1);
  A.queueAt(s, 'crusher', 'goldChunk', 1);
  run(s, 3);
  assert.equal(s.inv.goldDust, 2);
  A.queueAt(s, 'energizedSmelter', 'goldDust', 2);
  run(s, 8);
  assert.equal(s.inv.gold, 2);
  close(s.energy, 750);
  A.give(s, 'iron', 2); A.give(s, 'coal', 1); A.give(s, 'redstone', 2);
  A.queueAt(s, 'infuser', 'steel', 1);
  A.queueAt(s, 'infuser', 'redAlloy', 1);
  run(s, 11);
  assert.equal(s.inv.steel, 1);
  assert.equal(s.inv.redAlloy, 1);
  close(s.energy, 310);
  close(s.fuel.reduce((a, b) => a + b), 0);
});
test('multiple consumers cannot spend the same energy', () => {
  const s = island('battery', 'crusher', 'crusher');
  s.energy = 90;
  A.give(s, 'ironChunk', 2);
  A.queueAt(s, 'crusher', 'ironChunk', 2);
  run(s, 20);
  close(s.energy, 0);
  const completed = (s.inv.ironDust || 0) / 2;
  close(completed + s.crusherSlots.reduce((n, j) => n + (j?.p || 0), 0), 1);
});
test('clearing queues refunds only unstarted jobs; demolition returns active inputs once', () => {
  const s = island('battery', 'crusher');
  A.give(s, 'ironChunk', 3);
  A.queueAt(s, 'crusher', 'ironChunk', 3);
  A.tick(s, 1);
  A.clearAt(s, 'crusher');
  assert.equal(s.inv.ironChunk, 2);
  A.demolish(s, 1);
  assert.equal(s.inv.ironChunk, 3);
  A.tick(s, 1);
  assert.equal(s.inv.ironChunk, 3);
  assert.equal(s.crusherSlots.length, 0);
});
test('demolishing the last station also refunds its waiting queue', () => {
  const s = island('infuser');
  A.give(s, 'iron', 2); A.give(s, 'coal', 2);
  A.queueAt(s, 'infuser', 'steel', 2);
  A.demolish(s, 0);
  assert.equal(s.inv.iron, 2);
  assert.equal(s.inv.coal, 2);
  assert.equal(s.infuserQueue.length, 0);
});
test('removing storage clamps energy immediately', () => {
  const s = island('battery', 'solarGenerator');
  s.energy = 22000;
  A.demolish(s, 0);
  close(s.energy, 2000);
  A.demolish(s, 1);
  close(s.energy, 0);
});
test('harvester costs 600 J, replants, waits for regrowth, and respects pause', () => {
  const s = island('battery', 'tree', 'treeHarvester');
  s.island[1].grow = 1;
  s.energy = 1200;
  s.island[2].enabled = false;
  run(s, 10);
  close(s.energy, 1200);
  s.island[2].enabled = true;
  run(s, 10);
  assert.equal(s.inv.log, 4);
  assert.equal(s.inv.leaves, 5); // one passive tree litter at 20 s
  assert.equal(s.inv.sapling >= 1, true);
  close(s.energy, 600);
  close(s.island[1].grow, 0);
  run(s, 30);
  close(s.energy, 600);
  assert.equal(s.inv.log, 4);
});
test('old saves migrate without changing legacy machines, inventory or recipe preferences', () => {
  const s = island('autoGen', 'autoHammer');
  s.island[1].tool = 'stoneHammer'; s.island[1].sel = 'cobble';
  A.give(s, 'cobble', 100);
  s.v = 3; s.hide['ironChunk<ironPiece'] = 1;
  delete s.energy; delete s.power;
  for (const st of Object.keys(D.ELECTRIC)) { delete s[A.STATIONS[st].q]; delete s[A.STATIONS[st].sl]; }
  const saved = A.serialize(s), revived = A.revive(saved);
  assert.equal(revived.v, 5);
  assert.equal(revived.energy, 0);
  assert.deepEqual(revived.island, s.island);
  assert.deepEqual(revived.inv, s.inv);
  assert.deepEqual(revived.hide, s.hide);
  run(revived, 10);
  assert.ok(revived.inv.gravel > 0);
  close(revived.energy, 0);
});
test('save roundtrip and offline progress preserve powered queues and accounting', () => {
  const s = island('solarGenerator', 'energizedSmelter');
  A.give(s, 'ironDust', 2);
  A.queueAt(s, 'energizedSmelter', 'ironDust', 2);
  const revived = A.revive(A.serialize(s));
  const away = A.catchUp(revived, 20000);
  assert.equal(away.secs, 20);
  assert.equal(revived.inv.iron, 2);
  close(revived.energy, 40);
  assert.deepEqual(revived.energizedSmelterQueue, []);
});
test('electric operation is independent of tick size with a charged buffer', () => {
  const s = island('battery', 'crusher');
  s.energy = 500;
  A.give(s, 'ironChunk', 4); A.queueAt(s, 'crusher', 'ironChunk', 4);
  const fine = A.revive(A.serialize(s));
  A.tick(s, 10); run(fine, 10);
  close(s.energy, fine.energy);
  assert.equal(s.inv.ironDust, fine.inv.ironDust);
  close(s.crusherSlots[0].p, fine.crusherSlots[0].p);
});

test('crafted buildings go to the inventory; place, move and pick up keep their contents', () => {
  const s = island('table');
  A.give(s, 'planks', 7);
  assert.equal(A.craft(s, D.RECIPES.find(r => r.out.barrel), 1), 1);
  assert.equal(s.inv.barrel, 1);
  assert.equal(A.built(s, 'barrel'), 0);
  assert.ok(A.place(s, 'barrel', 1));
  assert.equal(s.inv.barrel, 0);
  assert.equal(A.built(s, 'barrel'), 1);
  assert.ok(!A.place(s, 'barrel', 2), 'nothing left to place');
  // auto machines take the best tool when placed and hand it back when picked up
  A.give(s, 'woodHammer'); A.give(s, 'ironHammer'); A.give(s, 'autoHammer');
  assert.ok(A.place(s, 'autoHammer', 2));
  assert.equal(s.island[2].tool, 'ironHammer');
  s.island[2].sel = 'gravel';
  assert.ok(A.move(s, 2, 5));
  assert.equal(s.island[2], null);
  assert.equal(s.island[5].tool, 'ironHammer');
  assert.equal(s.island[5].sel, 'gravel');
  assert.ok(A.move(s, 5, 1)); // swap with the barrel
  assert.equal(s.island[1].id, 'autoHammer');
  assert.equal(s.island[5].id, 'barrel');
  assert.ok(A.pickUp(s, 1));
  assert.equal(s.inv.autoHammer, 1);
  assert.equal(s.inv.ironHammer, 1);
  // a sapling plants a tree; picking up a grown tree gives the sapling and logs back
  A.give(s, 'sapling');
  assert.ok(A.place(s, 'sapling', 3));
  assert.equal(s.island[3].id, 'tree');
  s.island[3].grow = 1;
  const logs = s.inv.log || 0;
  assert.ok(A.pickUp(s, 3));
  assert.equal(s.inv.sapling, 1);
  assert.equal(s.inv.log, logs + 2);
});
test('recipes can consume a building from the inventory or straight off the island', () => {
  const s = island('table', 'autoGen');
  A.give(s, 'gear', 4); A.give(s, 'gold', 8); A.give(s, 'redstone', 16);
  const up = D.RECIPES.find(r => r.out.autoGen2);
  assert.equal(A.craft(s, up, 1), 1); // takes the placed Mk I
  assert.equal(A.built(s, 'autoGen'), 0);
  assert.equal(s.inv.autoGen2, 1);
});
