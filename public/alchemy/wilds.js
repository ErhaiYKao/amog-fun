/* Alchemy — the Wilds: places off the island that cost no tiles. The Dark Platform and the Nether (fight monsters
 * for XP and drops: monsters wander in at random, a swing recharges, swords hit harder, armor blocks hits, steak heals,
 * milk heals fully, TNT is a free 40 damage, arena upgrades unlock harder difficulties) and the pasture (cows: leather, beef and milk; sheep: wool). */
(function () {
  "use strict";
  const UI = window.AlchemyUI, { A, D, $ } = UI;
  const { img, name, esc } = UI;
  const C = D.CONFIG, K = C.combat;

  const ings = cost => Object.entries(cost).map(([k, n]) =>
    `<span class="ing ${A.count(UI.s, k) < n ? "lack" : ""}" data-tip="${k}">${img(k, "sm")}<span data-v="c:${k}"></span>/${n}</span>`).join("");

  const AREA_NAME = { platform: "Dark Platform", nether: "The Nether" };
  function combatHTML(s) {
    const L = A.level(s), peak = A.peakLevel(s), lo = A.xpFor(L), hi = A.xpFor(L + 1), m = D.MOBS[s.mob.id], d = A.difficulty(s);
    UI.v("w:hp", s.hp / K.hp);
    UI.v("w:hpt", s.faintT > 0 ? `knocked out · back in ${Math.ceil(s.faintT)} s` : `${Math.ceil(s.hp)} / ${K.hp} HP`);
    UI.v("w:xp", (s.xp - lo) / (hi - lo));
    UI.v("w:xpt", `level ${L}${peak > L ? ` (best ${peak})` : ""} · ${Math.floor(s.xp - lo)} / ${hi - lo} XP`);
    UI.v("w:mob", s.mob.hp / s.mob.max);
    UI.v("w:mobt", `${Math.max(0, Math.ceil(s.mob.hp))} / ${Math.round(s.mob.max)} HP`);
    UI.v("w:charge", A.charge(s));
    UI.v("w:fuse", m.fuse ? (s.mob.fuse || 0) / m.fuse : 0);
    UI.v("w:fuset", m.fuse ? (s.calmT >= K.calm ? "hissing quietly" : `goes off in ${Math.max(0, m.fuse - (s.mob.fuse || 0)).toFixed(1)} s`) : "");
    UI.v("d:fight", s.faintT > 0);
    UI.v("d:tnt", !(s.inv.tnt > 0) || s.faintT > 0);
    UI.v("d:eat", !(s.inv.steak > 0) || s.hp >= K.hp || s.faintT > 0);
    UI.v("d:drink", !(s.inv.milkBucket > 0) || s.hp >= K.hp || s.faintT > 0);
    const sword = A.tool(s, "sword"), armor = A.tool(s, "armor");
    // where to fight: whatever you've unlocked there wanders in; locked ones show the level they need
    const zones = Object.keys(AREA_NAME).filter(z => s.areas[z]).map(z => {
      const open = A.zoneMobs(s, z).length;
      return open ? `<button class="chip" style="padding-left:9px" data-act="zone:${z}" aria-pressed="${s.zone === z}">${AREA_NAME[z]}</button>`
        : `<span class="chip" style="padding-left:9px;opacity:.45;cursor:default">${AREA_NAME[z]} · level ${Math.min(...Object.values(D.MOBS).filter(mb => mb.area === z).map(mb => mb.level))}</span>`;
    }).join("");
    const roster = Object.entries(D.MOBS).filter(([, mb]) => mb.area === s.zone).map(([id, mb]) => A.mobOpen(s, id)
      ? `<span class="chip" style="padding-left:4px;cursor:default" title="${esc(mb.name)}">${img(id, "sm")}${mb.name}</span>`
      : `<span class="chip" style="padding-left:4px;opacity:.45;cursor:default" title="reach level ${mb.level}">${img(id, "sm")}level ${mb.level}</span>`).join("");
    // arena difficulty: the ones you've built, then the next upgrade with its price
    const D2 = K.difficulty, next = D2[(s.arena || 0) + 1];
    const diffs = D2.slice(0, (s.arena || 0) + 1).map((x, n) => `<button class="chip" style="padding-left:9px" data-act="diff:${n}" aria-pressed="${(s.diff || 0) === n}">${x.name}</button>`).join("");
    const upgrade = next && peak >= 6 ? `<div class="row"><span class="meta grow">arena upgrade: <b>${next.name}</b> · ${esc(next.desc)} Monsters ×${next.hp} HP, ×${next.dmg} damage; ×${next.xp} XP and ×${next.loot} loot.</span>
      <div class="ings">${ings(next.unlock)}</div><button class="mini" data-act="arena" ${Object.entries(next.unlock).every(([k, n]) => A.count(s, k) >= n) ? "" : "disabled"}>Build</button></div>` : "";
    const hits = m.fuse ? `explodes for ${Math.round(m.dmg * d.dmg)} after ${m.fuse} s` : `hits for ${+(m.dmg * d.dmg).toFixed(1)} every ${m.every} s${m.pierce ? " (half through armor)" : ""}`;
    return `<div class="area"><div class="row"><b>${AREA_NAME[s.zone] || "Dark Platform"}</b><span class="meta">${d.name} · ${Object.values(s.kills).reduce((a, n) => a + n, 0)} kills</span></div>
      <div class="chips">${zones}${D2.length > 1 && s.arena ? `<span class="meta" style="margin-left:8px">difficulty</span>${diffs}` : ""}</div>
      <div class="fight">
        <div class="side">
          <div class="meta">you · ${sword ? esc(name(sword[0])) : "bare fists"} (${A.swordDmg(s).toFixed(1)} per full swing) · ${armor ? `${esc(name(armor[0]))} (blocks ${Math.round(A.armorBlock(s) * 100)}%)` : "no armor"}</div>
          <div class="bar hp"><i data-w="w:hp"></i></div><span class="meta" data-v="w:hpt"></span>
          <div class="bar xp"><i data-w="w:xp"></i></div><span class="meta" data-v="w:xpt"></span>
        </div>
        <div class="side foe">${img(s.mob.id)}<div><b>${m.name}</b><div class="meta">${hits} · ${Math.round(m.xp * d.xp)} XP</div><div class="bar foehp"><i data-w="w:mob"></i></div><span class="meta" data-v="w:mobt"></span>
          ${m.fuse ? `<div class="bar fuse"><i data-w="w:fuse"></i></div><span class="meta" data-v="w:fuset"></span>` : ""}</div></div>
      </div>
      <div class="row"><button class="go fightbtn" data-act="fight" data-d="d:fight" title="a swing takes ${K.cooldown} s to recharge; swinging early hits for less">⚔ Attack <span class="k">8</span><i class="charge" data-w="w:charge"></i></button>
        ${s.got.tnt ? `<button class="mini" data-act="tnt" data-d="d:tnt" data-tip="tnt">Throw TNT · <span data-v="i:tnt"></span></button>` : ""}
        <button class="mini" data-act="eat" data-d="d:eat" data-tip="steak">Eat steak · <span data-v="i:steak"></span></button>
        ${s.got.milkBucket ? `<button class="mini" data-act="drink" data-d="d:drink" data-tip="milkBucket">Drink milk · <span data-v="i:milkBucket"></span></button>` : ""}</div>
      <div class="chips"><span class="meta">wanders in here</span>${roster}</div>${upgrade}</div>`;
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
  function milkHTML(s) {
    if (!s.seen.ironBucket && !s.seen.milkBucket) return "";
    UI.v("d:milk", !s.cows || !(s.inv.ironBucket > 0));
    return `<div class="row"><span class="meta grow">milk a cow into an iron bucket · drink it in a fight to heal completely</span>
      <button class="mini" data-act="milk" data-d="d:milk" data-tip="ironBucket">Milk · <span data-v="i:ironBucket"></span> bucket${s.inv.ironBucket === 1 ? "" : "s"}</button></div>`;
  }
  function pastureHTML(s) {
    return `<div class="area"><div class="row"><b>Pasture</b></div>
      ${herdHTML(s, "cows", C.pasture, "cowT", "leather (often raw beef)")}${milkHTML(s)}${herdHTML(s, "sheep", C.pasture.sheep, "sheepT", "wool")}</div>`;
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

  // only your first kill of each monster gets a log line; the panel counts the rest
  const noteKill = r => { if (r && r.killed && UI.s.kills[r.id] === 1) UI.log(`First ${D.MOBS[r.id].name.toLowerCase()} down: +${r.xp} XP.`, "quest", r.id); };
  const swing = () => noteKill(A.attack(UI.s));
  Object.assign(UI.handlers, {
    area: ([id]) => A.unlockArea(UI.s, id),
    fight: () => swing(),
    eat: () => A.eat(UI.s),
    drink: () => A.drink(UI.s),
    milk: () => A.milk(UI.s),
    zone: ([z]) => A.setZone(UI.s, z),
    diff: ([n]) => A.setDifficulty(UI.s, +n),
    arena: () => A.upgradeArena(UI.s),
    tnt: () => noteKill(A.throwTnt(UI.s)),
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
