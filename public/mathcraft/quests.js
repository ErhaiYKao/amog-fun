/* Mathcraft quests (#33): the axioms, the quest chain and Amog's reference proof of each quest.
 * Needs logic.js first. Pure (page and Node).
 *
 * A quest: { id, name, goal, given?, intro, hint, proof, guide? } (guide: the page points at each next step of
 * the reference proof while the player is still on it). Finishing it adds its theorem to the library as a
 * machine (an equality machine, or a rule if it has `given` premises); a quest may only use the axioms and the
 * quests before it (machinesFor), so nothing is ever circular. `proof` is a list of engine steps (see logic.js);
 * its length is the par shown to the player, and the tests replay it, so every quest is known to be provable.
 * Economy (#33): finishing a quest pays `pay` ∎ (tombstones), plus PAR_BONUS if the best proof is no longer than
 * Amog's; BOUNTIES are optional theorems that pay once. ∎ buys the SHOP: `gate` machines (the axioms and induction,
 * which later quests need) and convenience upgrades. Nothing is stored as a balance: `balance` derives it from what
 * is done and owned, so it can't be farmed or drift. Two rules keep it from ever getting stuck, both tested: the
 * quests before a quest always pay for the gates it `needs`, and `canBuy` refuses an upgrade that would leave less
 * than the gates still unbought cost.
 * machinesFor / playMachines take the set of owned shop ids; without it (tests, the reference proofs) everything is
 * owned and induction arrives with the first quest whose `induct` is true.
 */
(function (root) {
  "use strict";
  const L = root.MathcraftLogic;

  const AXIOMS = [
    { id: "add0", name: "Adding zero", stmt: "a+0=a" },
    { id: "addS", name: "Adding a successor", stmt: "a+S(b)=S(a+b)" },
  ].map(L.machine);
  const INDUCT = { id: "induct", name: "Induction" };

  const rw = (at, path, m, dir = "lr") => ({ op: "rw", at, b: 0, path, m, dir });
  const refl = (at, t) => ({ op: "refl", at, t });

  const QUESTS = [
    {
      id: "refl0", name: "Something from nothing", pay: 1, goal: "0=0", guide: true,
      intro: "This is your first machine. <b>refl</b> makes theorems of the form $t = t$ out of thin air, for any term $t$ you feed it. That is already enough for a theorem, if not a deep one.",
      hint: "Open refl, type $0$ and run it.",
      proof: [refl("", "0")],
    },
    {
      id: "zz", name: "Zero plus zero", pay: 2, needs: ["add0"], goal: "0+0=0", guide: true,
      intro: "Finishing a craft pays ∎. Spend your first one on a machine: <i>Adding zero</i>, an axiom. An equality machine rewrites a part of a block: set its lever to a direction, then tap the part to feed it.",
      hint: "Make $0+0 = 0+0$ with refl. Then open <i>Adding zero</i>, lever on $a+0 \\to a$, and tap the right-hand $0+0$.",
      proof: [refl("", "0+0"), rw("", [1], "add0")],
    },
    {
      id: "sym", name: "Symmetry", pay: 2, given: ["a=b"], goal: "b=a", guide: true,
      intro: "This time you are <i>given</i> a fact: $a = b$, for two numbers you know nothing else about. A given fact is a machine too, but it only speaks about this $a$ and this $b$.",
      hint: "Start from $b = b$ and use the given fact backwards on one side.",
      proof: [refl("", "b"), rw("", [1], "h0", "rl")],
    },
    {
      id: "trans", name: "Transitivity", pay: 2, given: ["a=b", "b=c"], goal: "a=c",
      intro: "Two given facts. Once this is crafted, <i>Symmetry</i> and <i>Transitivity</i> are rules: they take whole blocks, so open one and tap a block's $=$ sign.",
      hint: "Start from $a = a$ and walk the right side along: $a$ to $b$, then $b$ to $c$.",
      proof: [refl("", "a"), rw("", [1], "h0"), rw("", [1], "h1")],
    },
    {
      id: "zadd", name: "Zero on the left", pay: 3, needs: ["addS", "induct"], goal: "0+a=a", induct: true,
      intro: "<i>Adding zero</i> says $a+0 = a$. With the zero on the left, no machine fits: $a$ could be anything. Two machines to buy: <i>Adding a successor</i>, the other axiom, and <b>Induction</b>, which splits the job into two workshops: craft it for $0$, then craft it for $S(a)$ while holding the fact for $a$.",
      hint: "Induct on $a$. In the step workshop, push the $S$ outward with <i>Adding a successor</i>, then the given fact fits inside it.",
      proof: [{ op: "induct", at: "", v: "a" }, refl("b", "0+0"), rw("b", [1], "add0"), refl("s", "0+S(a)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0")],
    },
    {
      id: "sadd", name: "Successor on the left", pay: 3, goal: "S(a)+b=S(a+b)", induct: true,
      intro: "The mirror image of <i>Adding a successor</i>. There are two numbers now; pick the one to induct on with care.",
      hint: "Induct on $b$. Machines also run backwards: $a$ can become $a+0$, and $S(a+b)$ can become $a+S(b)$.",
      proof: [{ op: "induct", at: "", v: "b" },
        refl("b", "S(a)+0"), rw("b", [1], "add0"), rw("b", [1, 0], "add0", "rl"),
        refl("s", "S(a)+S(b)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1, 0], "addS", "rl")],
    },
    {
      id: "comm", name: "Commutativity", pay: 4, goal: "a+b=b+a", induct: true,
      intro: "The two machines you just crafted are exactly the two this one needs.",
      hint: "Induct on $b$. The base case is <i>Zero on the left</i> run backwards; the step ends with <i>Successor on the left</i> run backwards.",
      proof: [{ op: "induct", at: "", v: "b" },
        refl("b", "a+0"), rw("b", [1], "add0"), rw("b", [1], "zadd", "rl"),
        refl("s", "a+S(b)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1], "sadd", "rl")],
    },
    {
      id: "assoc", name: "Associativity", pay: 4, goal: "(a+b)+c=a+(b+c)", induct: true,
      intro: "The last one for addition. After this the brackets are yours to move.",
      hint: "Induct on $c$. In the step, <i>Adding a successor</i> runs backwards twice, once on the outside and once inside.",
      proof: [{ op: "induct", at: "", v: "c" },
        refl("b", "(a+b)+0"), rw("b", [1], "add0"), rw("b", [1, 1], "add0", "rl"),
        refl("s", "(a+b)+S(c)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1], "addS", "rl"), rw("s", [1, 1], "addS", "rl")],
    },
  ];

  /* optional theorems that pay once; they use every quest finished so far */
  const BOUNTIES = [
    { id: "b11", name: "One plus one", goal: "1+1=2", pay: 1,
      proof: [refl("", "1+1"), rw("", [1], "addS"), rw("", [1, 0], "add0")] },
    { id: "b22", name: "Two plus two", goal: "2+2=4", pay: 2,
      proof: [refl("", "2+2"), rw("", [1], "addS"), rw("", [1, 0], "addS"), rw("", [1, 0, 0], "add0")] },
    { id: "bss", name: "Two successors", goal: "S(a)+S(b)=S(S(a+b))", pay: 2,
      proof: [refl("", "S(a)+S(b)"), rw("", [1], "addS"), rw("", [1, 0], "sadd")] },
    { id: "bswap", name: "Swap the front", goal: "a+(b+c)=b+(a+c)", pay: 3,
      proof: [refl("", "a+(b+c)"), rw("", [1], "assoc", "rl"), rw("", [1, 0], "comm"), rw("", [1], "assoc")] },
    { id: "bmid", name: "Middle four", goal: "(a+b)+(c+d)=(a+c)+(b+d)", pay: 5,
      proof: [refl("", "(a+b)+(c+d)"), rw("", [1], "assoc"), rw("", [1, 1], "assoc", "rl"), rw("", [1, 1, 0], "comm"), rw("", [1, 1], "assoc"), rw("", [1], "assoc", "rl")] },
  ].map(b => ({ ...b, bounty: true }));

  const PAR_BONUS = 1;
  const SHOP = [
    { id: "add0", gate: true, price: 1 },
    { id: "addS", gate: true, price: 2 },
    { id: "induct", gate: true, price: 3 },
    { id: "autofill", name: "Autofill", price: 2, text: "refl offers the two sides of the goal, and Induction offers the letters, so you type less." },
    { id: "press", name: "Block press", price: 2, text: "Any equality machine can stamp its own statement onto the bench, with the slots filled in as you like." },
    { id: "scanner", name: "Scanner", price: 4, text: "Tap a part of a block with no machine open to list every machine that fits it, and see where the open machine fits." },
  ];
  const price = id => (SHOP.find(x => x.id === id) || { price: 0 }).price;
  const par = q => L.count(q.proof);
  /* done: { id: best step count } */
  function earned(done) {
    let n = 0;
    for (const q of QUESTS) if (q.id in done) n += q.pay + (done[q.id] <= par(q) ? PAR_BONUS : 0);
    for (const b of BOUNTIES) if (b.id in done) n += b.pay;
    return n;
  }
  const balance = (done, owned) => earned(done) - [...owned].reduce((a, id) => a + price(id), 0);
  /* "" if id can be bought now, otherwise the reason it can't */
  function canBuy(id, done, owned) {
    const it = SHOP.find(x => x.id === id), have = balance(done, owned);
    if (!it) return "no such thing";
    if (owned.has(id)) return "you own it";
    if (have < it.price) return "you need ∎" + (it.price - have) + " more";
    const gates = SHOP.filter(x => x.gate && !owned.has(x.id)).reduce((a, x) => a + x.price, 0);
    if (!it.gate && have - it.price < gates) return "keep ∎" + gates + " back for the machines the quests need";
    return "";
  }

  const has = (owned, id) => !owned || owned.has(id);
  /* machines quest number i may use: the shop machines owned, and the quests finished before it */
  function machinesFor(i, done, owned) {
    const ms = AXIOMS.filter(m => has(owned, m.id));
    if (owned ? owned.has("induct") : QUESTS.slice(0, i + 1).some(q => q.induct)) ms.push(INDUCT);
    QUESTS.slice(0, i).forEach(q => { if (done.has(q.id)) ms.push(L.questMachine(q)); });
    return ms;
  }
  /* machines for bounties and the playground: the shop machines owned and every finished quest */
  function playMachines(done, owned) {
    const ms = AXIOMS.filter(m => has(owned, m.id)), k = QUESTS.findIndex(q => q.induct);
    if (owned ? owned.has("induct") : k <= 0 || done.has(QUESTS[k - 1].id)) ms.push(INDUCT);
    QUESTS.forEach(q => { if (done.has(q.id)) ms.push(L.questMachine(q)); });
    return ms;
  }

  root.MathcraftQuests = { AXIOMS, INDUCT, QUESTS, BOUNTIES, SHOP, PAR_BONUS, machinesFor, playMachines, par, price, earned, balance, canBuy };
})(typeof window !== "undefined" ? window : globalThis);
