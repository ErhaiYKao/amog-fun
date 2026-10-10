/* Alchemy — the Wilds: places off the island that cost no tiles. The Dark Platform (fight monsters for XP and
 * drops: swords hit harder, armor blocks hits, steak heals) and the cow pasture (leather and beef; breed with wheat). */
(function () {
  "use strict";
  const UI = window.AlchemyUI, { A, D, $ } = UI;
  const { img, name, esc } = UI;
  const C = D.CONFIG, K = C.combat;

  const ings = cost => Object.entries(cost).map(([k, n]) =>
    `<span class="ing ${A.count(UI.s, k) < n ? "lack" : ""}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span>/${n}</span>`).join("");

  function combatHTML(s) {
    const L = A.level(s), lo = A.xpFor(L), hi = A.xpFor(L + 1), m = D.MOBS[s.mob.id];
    UI.v("w:hp", s.hp / K.hp);
    UI.v("w:hpt", s.faintT > 0 ? `knocked out · back in ${Math.ceil(s.faintT)} s` : `${Math.ceil(s.hp)} / ${K.hp} HP`);
    UI.v("w:xp", (s.xp - lo) / (hi - lo));
    UI.v("w:xpt", `level ${L} · ${Math.floor(s.xp - lo)} / ${hi - lo} XP`);
    UI.v("w:mob", s.mob.hp / m.hp);
    UI.v("w:mobt", `${Math.max(0, Math.ceil(s.mob.hp))} / ${m.hp} HP`);
    UI.v("d:fight", s.faintT > 0);
    UI.v("d:eat", !(s.inv.steak > 0) || s.hp >= K.hp || s.faintT > 0);
    const sword = A.tool(s, "sword"), armor = A.tool(s, "armor");
    const mobs = Object.entries(D.MOBS).map(([id, mb]) => L >= mb.level
      ? `<button class="chip" style="padding-left:4px" data-act="mob:${id}" aria-pressed="${s.mob.id === id}">${img(id, "sm")}${mb.name}</button>`
      : `<span class="chip" style="padding-left:4px;opacity:.45;cursor:default" title="reach level ${mb.level}">${img(id, "sm")}level ${mb.level}</span>`).join("");
    return `<div class="area"><div class="row"><b>Dark Platform</b><span class="meta">${Object.values(s.kills).reduce((a, n) => a + n, 0)} kills</span></div>
      <div class="fight">
        <div class="side">
          <div class="meta">you · ${sword ? esc(name(sword[0])) : "bare fists"} (${A.swordDmg(s).toFixed(1)} dmg) · ${armor ? `${esc(name(armor[0]))} (blocks ${Math.round(A.armorBlock(s) * 100)}%)` : "no armor"}</div>
          <div class="bar hp"><i data-w="w:hp"></i></div><span class="meta" data-v="w:hpt"></span>
          <div class="bar xp"><i data-w="w:xp"></i></div><span class="meta" data-v="w:xpt"></span>
        </div>
        <div class="side foe">${img(s.mob.id)}<div><b>${m.name}</b><div class="meta">hits for ${m.dmg} every ${m.every} s · ${m.xp} XP</div><div class="bar foehp"><i data-w="w:mob"></i></div><span class="meta" data-v="w:mobt"></span></div></div>
      </div>
      <div class="row"><button class="go fightbtn" data-act="fight" data-d="d:fight">⚔ Attack <span class="k">8</span></button>
        <button class="mini" data-act="eat" data-d="d:eat" data-tip="steak">Eat steak · <span data-v="i:steak"></span></button></div>
      <div class="chips">${mobs}</div>
      <p class="meta">Each click is one swing. While you fight, the monster hits back; stop for a few seconds and you both recover. Get knocked out and you're back in ${K.faint} s, with nothing lost. Better swords and armor are in the crafting list; enchanting makes them stronger still.</p></div>`;
  }

  function pastureHTML(s) {
    const P = C.pasture;
    UI.v("w:cow", s.cowT / P.every);
    UI.v("d:breed", s.cows >= P.max || Object.entries(P.breed).some(([k, n]) => A.count(s, k) < n));
    return `<div class="area"><div class="row"><b>Cow Pasture</b><span class="meta">${s.cows} / ${P.max} cows</span></div>
      <div class="row"><span class="meta">every ${P.every} s each cow gives leather (and often raw beef)</span><div class="bar green grow"><i data-w="w:cow"></i></div></div>
      <div class="row"><button class="mini" data-act="breed" data-d="d:breed">Breed · ${Object.entries(P.breed).map(([k, n]) => `${n} ${esc(name(k).toLowerCase())}`).join(", ")}</button>
        <span class="meta">barrels leave ${C.reserve.wheat} wheat alone for this</span></div></div>`;
  }

  function render() {
    const s = UI.s, card = $("wilds-card");
    card.hidden = !(s.seen.cobble || Object.keys(s.areas).length);
    if (card.hidden) return;
    let h = "";
    for (const [id, a] of Object.entries(D.AREAS)) {
      if (s.areas[id]) continue;
      const can = Object.entries(a.unlock).every(([k, n]) => A.count(s, k) >= n);
      h += `<div class="area locked"><div class="row"><b>${esc(a.name)}</b><span class="meta">locked</span></div><p class="meta">${esc(a.desc)}</p>
        <div class="row"><div class="ings">${ings(a.unlock)}</div><button class="mini" data-act="area:${id}" ${can ? "" : "disabled"}>Unlock</button></div></div>`;
    }
    if (s.areas.platform) h += combatHTML(s);
    if (s.areas.pasture) h += pastureHTML(s);
    UI.setHTML($("wilds"), "wilds", h);
  }

  function swing() {
    const r = A.attack(UI.s);
    // only log the notable ones: your first kill of each monster, and ender pearls (kills are counted on the panel)
    if (r && r.killed) {
      const id = UI.s.mob.id;
      if (UI.s.kills[id] === 1) UI.log(`First ${D.MOBS[id].name.toLowerCase()} down: +${r.xp} XP.`, "quest", id);
      if (r.drops.enderPearl) UI.log("An ender pearl!", "new", "enderPearl");
    }
  }
  Object.assign(UI.handlers, {
    area: ([id]) => A.unlockArea(UI.s, id),
    fight: () => swing(),
    eat: () => A.eat(UI.s),
    mob: ([id]) => A.setMob(UI.s, id),
    breed: () => A.breed(UI.s),
  });
  let lastKey = 0;
  document.addEventListener("keydown", e => {
    if (e.key !== "8" || e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!UI.s.areas.platform || performance.now() - lastKey < 110) return;
    lastKey = performance.now();
    e.preventDefault();
    swing();
    UI.render();
  });
  UI.renderers.push(render);
})();
