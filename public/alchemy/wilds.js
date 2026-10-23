/* Alchemy — the Wilds: places off the island that cost no tiles. The Dark Platform and the Nether (fight monsters
 * for XP and drops: swords hit harder, armor blocks hits, steak heals) and the pasture (cows: leather and beef; sheep: wool). */
(function () {
  "use strict";
  const UI = window.AlchemyUI, { A, D, $ } = UI;
  const { img, name, esc } = UI;
  const C = D.CONFIG, K = C.combat;

  const ings = cost => Object.entries(cost).map(([k, n]) =>
    `<span class="ing ${A.count(UI.s, k) < n ? "lack" : ""}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span>/${n}</span>`).join("");

  function combatHTML(s) {
    const L = A.level(s), peak = A.peakLevel(s), lo = A.xpFor(L), hi = A.xpFor(L + 1), m = D.MOBS[s.mob.id];
    UI.v("w:hp", s.hp / K.hp);
    UI.v("w:hpt", s.faintT > 0 ? `knocked out · back in ${Math.ceil(s.faintT)} s` : `${Math.ceil(s.hp)} / ${K.hp} HP`);
    UI.v("w:xp", (s.xp - lo) / (hi - lo));
    UI.v("w:xpt", `level ${L}${peak > L ? ` (best ${peak})` : ""} · ${Math.floor(s.xp - lo)} / ${hi - lo} XP`);
    UI.v("w:mob", s.mob.hp / m.hp);
    UI.v("w:mobt", `${Math.max(0, Math.ceil(s.mob.hp))} / ${m.hp} HP`);
    UI.v("d:fight", s.faintT > 0);
    UI.v("d:eat", !(s.inv.steak > 0) || s.hp >= K.hp || s.faintT > 0);
    const sword = A.tool(s, "sword"), armor = A.tool(s, "armor");
    // monsters stay unlocked by your best level ever, so enchanting never takes one away
    const chip = ([id, mb]) => A.mobOpen(s, id)
      ? `<button class="chip" style="padding-left:4px" data-act="mob:${id}" aria-pressed="${s.mob.id === id}">${img(id, "sm")}${mb.name}</button>`
      : `<span class="chip" style="padding-left:4px;opacity:.45;cursor:default" title="reach level ${mb.level}">${img(id, "sm")}level ${mb.level}</span>`;
    const group = area => Object.entries(D.MOBS).filter(([, mb]) => mb.area === area);
    const mobs = (s.areas.platform ? `<div class="chips"><span class="meta">Dark Platform</span>${group("platform").map(chip).join("")}</div>` : "") +
      (s.areas.nether ? `<div class="chips"><span class="meta">the Nether</span>${group("nether").map(chip).join("")}</div>` : "");
    const where = m.area === "nether" ? "The Nether" : "Dark Platform";
    return `<div class="area"><div class="row"><b>${where}</b><span class="meta">${Object.values(s.kills).reduce((a, n) => a + n, 0)} kills</span></div>
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
      ${mobs}</div>`;
  }

  const costText = cost => Object.entries(cost).map(([k, n]) => `${n} ${esc(name(k).toLowerCase())}`).join(", ");
  function herdHTML(s, kind, P, timer, gives) {
    const n = s[kind], cost = A.breedCost(s, kind);
    UI.v(`w:${kind}`, n ? s[timer] / P.every : 0);
    UI.v(`d:breed:${kind}`, n >= P.max || Object.entries(cost).some(([k, m]) => A.count(s, k) < m));
    return `<div class="row"><span class="meta grow">${n} / ${P.max} ${kind} · every ${P.every} s each gives ${gives}</span>
      <button class="mini" data-act="breed:${kind}" data-d="d:breed:${kind}">${n ? "Breed" : `Lure ${P.start} ${kind}`} · ${costText(cost)}</button></div>
      <div class="row"><div class="bar green grow"><i data-w="w:${kind}"></i></div></div>`;
  }
  function pastureHTML(s) {
    return `<div class="area"><div class="row"><b>Pasture</b></div>
      ${herdHTML(s, "cows", C.pasture, "cowT", "leather (often raw beef)")}${herdHTML(s, "sheep", C.pasture.sheep, "sheepT", "wool")}</div>`;
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
    if (s.areas.platform || s.areas.nether) h += combatHTML(s);
    if (s.areas.pasture) h += pastureHTML(s);
    UI.setHTML($("wilds"), "wilds", h);
  }

  function swing() {
    const r = A.attack(UI.s);
    // only your first kill of each monster gets a log line; the panel counts the rest
    if (r && r.killed && UI.s.kills[UI.s.mob.id] === 1) UI.log(`First ${D.MOBS[UI.s.mob.id].name.toLowerCase()} down: +${r.xp} XP.`, "quest", UI.s.mob.id);
  }
  Object.assign(UI.handlers, {
    area: ([id]) => A.unlockArea(UI.s, id),
    fight: () => swing(),
    eat: () => A.eat(UI.s),
    mob: ([id]) => A.setMob(UI.s, id),
    breed: ([kind]) => A.breed(UI.s, kind || "cows"),
  });
  let lastKey = 0;
  document.addEventListener("keydown", e => {
    if (e.key !== "8" || e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!(UI.s.areas.platform || UI.s.areas.nether) || performance.now() - lastKey < 110) return;
    lastKey = performance.now();
    e.preventDefault();
    swing();
    UI.render();
  });
  UI.renderers.push(render);
})();
