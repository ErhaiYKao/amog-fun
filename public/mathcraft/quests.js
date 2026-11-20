/* Mathcraft quests (#33): the axioms, the quest chain and Amog's reference proof of each quest.
 * Needs logic.js first. Pure (page and Node).
 *
 * A quest: { id, name, goal, given?, intro, hint, proof }. Finishing it adds its theorem to the library as a
 * machine (an equality machine, or a rule if it has `given` premises); a quest may only use the axioms and the
 * quests before it (machinesFor), so nothing is ever circular. `proof` is a list of engine steps (see logic.js);
 * its length is the par shown to the player, and the tests replay it, so every quest is known to be provable.
 * Induction arrives with the first quest whose `induct` is true and stays.
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
      id: "zz", name: "Zero plus zero", goal: "0+0=0",
      intro: "Every proof here starts from a block that is obviously true: <b>refl</b> makes $t = t$ for any term $t$. Then machines rewrite parts of it. Tap a part of a block to see which machines fit.",
      hint: "Make $0+0 = 0+0$, then tap the right-hand $0+0$ and let <i>Adding zero</i> turn it into $0$.",
      proof: [refl("", "0+0"), rw("", [1], "add0")],
    },
    {
      id: "sym", name: "Symmetry", given: ["a=b"], goal: "b=a",
      intro: "This time you are <i>given</i> a fact: $a = b$, for two numbers you know nothing else about. A given fact is a machine too, but it only speaks about this $a$ and this $b$.",
      hint: "Start from $b = b$ and use the given fact backwards on one side.",
      proof: [refl("", "b"), rw("", [1], "h0", "rl")],
    },
    {
      id: "trans", name: "Transitivity", given: ["a=b", "b=c"], goal: "a=c",
      intro: "Two given facts. Once this is crafted, <i>Symmetry</i> and <i>Transitivity</i> become rules: they act on whole blocks instead of parts.",
      hint: "Start from $a = a$ and walk the right side along: $a$ to $b$, then $b$ to $c$.",
      proof: [refl("", "a"), rw("", [1], "h0"), rw("", [1], "h1")],
    },
    {
      id: "zadd", name: "Zero on the left", goal: "0+a=a", induct: true,
      intro: "<i>Adding zero</i> says $a+0 = a$. With the zero on the left, no machine fits: $a$ could be anything. The new <b>Induction</b> machine splits the job into two workshops: craft it for $0$, then craft it for $S(a)$ while holding the fact for $a$.",
      hint: "Induct on $a$. In the step workshop, push the $S$ outward with <i>Adding a successor</i>, then the given fact fits inside it.",
      proof: [{ op: "induct", at: "", v: "a" }, refl("b", "0+0"), rw("b", [1], "add0"), refl("s", "0+S(a)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0")],
    },
    {
      id: "sadd", name: "Successor on the left", goal: "S(a)+b=S(a+b)", induct: true,
      intro: "The mirror image of <i>Adding a successor</i>. There are two numbers now; pick the one to induct on with care.",
      hint: "Induct on $b$. Machines also run backwards: $a$ can become $a+0$, and $S(a+b)$ can become $a+S(b)$.",
      proof: [{ op: "induct", at: "", v: "b" },
        refl("b", "S(a)+0"), rw("b", [1], "add0"), rw("b", [1, 0], "add0", "rl"),
        refl("s", "S(a)+S(b)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1, 0], "addS", "rl")],
    },
    {
      id: "comm", name: "Commutativity", goal: "a+b=b+a", induct: true,
      intro: "The two machines you just crafted are exactly the two this one needs.",
      hint: "Induct on $b$. The base case is <i>Zero on the left</i> run backwards; the step ends with <i>Successor on the left</i> run backwards.",
      proof: [{ op: "induct", at: "", v: "b" },
        refl("b", "a+0"), rw("b", [1], "add0"), rw("b", [1], "zadd", "rl"),
        refl("s", "a+S(b)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1], "sadd", "rl")],
    },
    {
      id: "assoc", name: "Associativity", goal: "(a+b)+c=a+(b+c)", induct: true,
      intro: "The last one for addition. After this the brackets are yours to move.",
      hint: "Induct on $c$. In the step, <i>Adding a successor</i> runs backwards twice, once on the outside and once inside.",
      proof: [{ op: "induct", at: "", v: "c" },
        refl("b", "(a+b)+0"), rw("b", [1], "add0"), rw("b", [1, 1], "add0", "rl"),
        refl("s", "(a+b)+S(c)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1], "addS", "rl"), rw("s", [1, 1], "addS", "rl")],
    },
  ];

  /* machines quest number i may use, given the set of finished quest ids */
  function machinesFor(i, done) {
    const ms = AXIOMS.slice();
    if (QUESTS.slice(0, i + 1).some(q => q.induct)) ms.push(INDUCT);
    QUESTS.slice(0, i).forEach(q => { if (done.has(q.id)) ms.push(L.questMachine(q)); });
    return ms;
  }
  const par = q => L.count(q.proof);

  root.MathcraftQuests = { AXIOMS, INDUCT, QUESTS, machinesFor, par };
})(typeof window !== "undefined" ? window : globalThis);
