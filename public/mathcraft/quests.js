/* Mathcraft quests (#33): the shop machines, the quest worlds and Amog's reference proof of each quest.
 * Needs logic.js first. Pure (page and Node).
 *
 * A quest: { id, world, name, goal, given?, takes?, pay, needs?, after?, intro, hint, proof, guide? }. Finishing it adds its
 * theorem to the library as a machine (a rule if it has `given` premises); a quest may only use the shop machines
 * owned and the finished quests listed before it (machinesFor), so nothing is ever circular. `proof` is a list of
 * engine steps (see logic.js); its length is the par shown to the player, and the tests replay it, so every quest
 * is known to be provable. A quest opens when every quest in `after` is finished (default: the one before it in its
 * world), `needs` lists the shop machines its proof uses, and `guide` makes the page point at each next step.
 * `takes` is how many arrows of an implication are hypotheses of its rule (logic.js questMachine): read the goal as
 * a theorem, "from these, that", so Chain is "P → Q, Q → R give P → R" rather than a disguised modus ponens.
 *
 * Worlds branch (Pope Amog's choice): addition is the trunk; implication opens after Transitivity, logic (and, or,
 * false, true) after the third implication quest, multiplication after Associativity, each started by buying its
 * machines. A world only sees machines from the worlds in SEES (logic sees implication, multiplication sees
 * addition); bounties and the playground see everything.
 *
 * Economy: finishing a quest pays `pay` ∎ (tombstones), plus PAR_BONUS if the best proof is no longer than Amog's;
 * BOUNTIES are optional theorems that pay once. ∎ buys the SHOP: `gate` machines (axioms, Induction, Assume, Modus
 * ponens; each appears once the quests in its `after` are finished, i.e. when there is a quest it helps with) and
 * convenience upgrades. Nothing is stored as a balance: `balance` derives it from what is done and owned, so it
 * can't be farmed or drift. `canBuy` looks ahead (`alive`) and refuses any purchase after which some quest could no longer be
 * reached; the tests search every reachable state (worst case: no bonuses, no bounties) for a dead end.
 * machinesFor / playMachines take the set of owned shop ids; without it (tests, reference proofs) all are owned.
 */
(function (root) {
  "use strict";
  const L = root.MathcraftLogic;

  /* the machines the shop sells, in floor order; `w` is the world each belongs to */
  const thm = (id, name, goal) => L.questMachine({ id, name, goal });
  const GATES = [
    ["add", L.machine({ id: "add0", name: "Adding zero", stmt: "a+0=a" })],
    ["add", L.machine({ id: "addS", name: "Adding a successor", stmt: "a+S(b)=S(a+b)" })],
    ["add", { id: "induct", name: "Induction" }],
    ["prop", { id: "assume", name: "Assume" }],
    ["prop", L.machine({ id: "mp", name: "Modus ponens", premises: ["P->Q", "P"], concl: "Q" })],
    ["any", { id: "have", name: "Lemma" }],
    ["logic", thm("dne", "Double negation", "((P->false)->false)->P")],
    ["logic", { id: "apply", name: "Apply" }],
    ["logic", { id: "byc", name: "Contradiction" }],
    ["mul", L.machine({ id: "mul0", name: "Times zero", stmt: "a*0=0" })],
    ["mul", L.machine({ id: "mulS", name: "Times a successor", stmt: "a*S(b)=a*b+a" })],
  ].map(([w, m]) => ({ ...m, w }));
  const WORLDS = [["add", "Addition"], ["prop", "Implication"], ["logic", "Logic"], ["mul", "Multiplication"]];
  const SEES = { add: ["add"], prop: ["prop"], logic: ["prop", "logic"], mul: ["add", "mul"] };
  /* does a quest in `world` see things from world w? (no world = bounties and the playground: everything) */
  const sees = (world, w) => !world || w === "any" || SEES[world].includes(w);
  /* tactics open workshops instead of stating something */
  const TACTICS = ["induct", "assume", "apply", "have", "byc"];

  const rw = (at, path, m, dir = "lr", fill) => ({ op: "rw", at, b: 0, path, m, dir, ...(fill ? { fill } : {}) });
  const refl = (at, t) => ({ op: "refl", at, t });
  const induct = v => ({ op: "induct", at: "", v });
  const assume = at => ({ op: "assume", at });
  const hyp = (at, i) => ({ op: "hyp", at, i });
  const rule = (at, b, m, others = [], fill) => ({ op: "rule", at, b, m, others, ...(fill ? { fill } : {}) });
  const mp = (at, b, other) => rule(at, b, "mp", [other]);
  const make = (at, m, fill) => ({ op: "make", at, m, fill });
  const dup = (at, b) => ({ op: "dup", at, b });
  const applyB = (at, b) => ({ op: "apply", at, b });
  const applyR = (at, m, fill) => ({ op: "apply", at, m, ...(fill ? { fill } : {}) });

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
      hint: "A given fact can go on the bench as a block. Put $a = b$ there, then walk its right side along.",
      proof: [hyp("", 0), rw("", [1], "h1")],
    },
    {
      id: "zadd", name: "Zero on the left", pay: 3, needs: ["addS", "induct"], goal: "0+a=a",
      intro: "<i>Adding zero</i> says $a+0 = a$. With the zero on the left, no machine fits: $a$ could be anything. Two machines to buy: <i>Adding a successor</i>, the other axiom, and <b>Induction</b>, which splits the job into two workshops: craft it for $0$, then craft it for $S(a)$ while holding the fact for $a$.",
      hint: "Induct on $a$. In the step workshop, push the $S$ outward with <i>Adding a successor</i>, then the given fact fits inside it.",
      proof: [{ op: "induct", at: "", v: "a" }, refl("b", "0+0"), rw("b", [1], "add0"), refl("s", "0+S(a)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0")],
    },
    {
      id: "sadd", name: "Successor on the left", pay: 3, goal: "S(a)+b=S(a+b)",
      intro: "The mirror image of <i>Adding a successor</i>. There are two numbers now; pick the one to induct on with care.",
      hint: "Induct on $b$. Machines also run backwards: $a$ can become $a+0$, and $S(a+b)$ can become $a+S(b)$.",
      proof: [{ op: "induct", at: "", v: "b" },
        refl("b", "S(a)+0"), rw("b", [1], "add0"), rw("b", [1, 0], "add0", "rl"),
        refl("s", "S(a)+S(b)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1, 0], "addS", "rl")],
    },
    {
      id: "comm", name: "Commutativity of +", pay: 4, goal: "a+b=b+a",
      intro: "The two machines you just crafted are exactly the two this one needs.",
      hint: "Induct on $b$. The base case is <i>Zero on the left</i> run backwards; the step ends with <i>Successor on the left</i> run backwards.",
      proof: [{ op: "induct", at: "", v: "b" },
        refl("b", "a+0"), rw("b", [1], "add0"), rw("b", [1], "zadd", "rl"),
        refl("s", "a+S(b)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1], "sadd", "rl")],
    },
    {
      id: "assoc", name: "Associativity of +", pay: 4, goal: "(a+b)+c=a+(b+c)",
      intro: "The last one for addition. After this the brackets are yours to move, and multiplication opens.",
      hint: "Induct on $c$. In the step, <i>Adding a successor</i> runs backwards twice, once on the outside and once inside.",
      proof: [{ op: "induct", at: "", v: "c" },
        refl("b", "(a+b)+0"), rw("b", [1], "add0"), rw("b", [1, 1], "add0", "rl"),
        refl("s", "(a+b)+S(c)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1], "addS", "rl"), rw("s", [1, 1], "addS", "rl")],
    },

    /* ---- propositions: implication only, by assuming and by modus ponens ---- */
    {
      id: "pid", world: "prop", after: ["trans"], name: "Identity", pay: 2, needs: ["assume"], goal: "P->P",
      intro: "A new kind of block: statements, written with capital letters, joined by $\\to$ (\"implies\"). Nothing is known about $P$. To craft $P \\to Q$ you buy <b>Assume</b>: it opens a workshop where $P$ is a fact, already on the bench, and the goal is $Q$.",
      hint: "Run Assume. Inside the workshop, the assumption is exactly the goal.",
      proof: [assume("")],
    },
    {
      id: "pk", takes: 1, world: "prop", name: "Weakening", pay: 2, goal: "P->(Q->P)",
      intro: "If $P$ holds, it still holds after assuming something else. Workshops nest: a goal that is itself an implication can be assumed again, and what was on the bench comes along.",
      hint: "Assume twice.",
      proof: [assume(""), assume("a")],
    },
    {
      id: "pmp", takes: 1, world: "prop", name: "Using an implication", pay: 3, needs: ["mp"], goal: "P->((P->Q)->Q)",
      intro: "Holding $P \\to Q$ and $P$ should give $Q$. That is a machine to buy: <b>Modus ponens</b>, a rule. Feed it the implication first, then the block that matches its left side; it uses up both. Every implication you craft from now on becomes a rule of its own: it takes its hypotheses as blocks and gives what they imply.",
      hint: "Assume twice, then open Modus ponens and tap the $\\to$ of $P \\to Q$, then $P$.",
      proof: [assume(""), assume("a"), mp("aa", 1, 0)],
    },
    {
      id: "pchain", takes: 2, world: "prop", name: "Chain", pay: 4, goal: "(P->Q)->((Q->R)->(P->R))",
      intro: "Implications compose, like transitivity for $=$.",
      hint: "Assume three times. Get $Q$ from $P \\to Q$ and $P$, then $R$ from $Q \\to R$ and $Q$.",
      proof: [assume(""), assume("a"), assume("aa"), mp("aaa", 0, 2), mp("aaa", 1, 0)],
    },
    {
      id: "pswap", takes: 1, world: "prop", name: "Swapping assumptions", pay: 4, goal: "(P->(Q->R))->(Q->(P->R))",
      intro: "The order in which you assume things does not matter.",
      hint: "Assume three times. Modus ponens twice: first with $P$, then with $Q$.",
      proof: [assume(""), assume("a"), assume("aa"), mp("aaa", 0, 2), mp("aaa", 0, 1)],
    },
    {
      id: "pdist", takes: 2, world: "prop", name: "Distributing an assumption", pay: 5, goal: "(P->(Q->R))->((P->Q)->(P->R))",
      intro: "The last one for implication: $P$ gets used twice, and a rule uses up what it is fed, so you need a copy (⧉ on a block, one step).",
      hint: "Assume three times and copy $P$. Use $P$ on both implications, then combine what comes out.",
      proof: [assume(""), assume("a"), assume("aa"), dup("aaa", 2), mp("aaa", 0, 2), mp("aaa", 1, 2), mp("aaa", 0, 1)],
    },

    /* ---- logic: ¬, ∨, ∧, ⊤ are definitions in terms of → and ⊥; one classical axiom, ¬¬P → P (airetho) ---- */
    {
      id: "lnn", world: "logic", after: ["pmp"], name: "Double negation in", pay: 2, goal: "P->((P->false)->false)",
      intro: "$\\bot$ is the statement that is simply false, and $\\lnot P$, \"not $P$\", is short for $P \\to \\bot$. So this says $P \\to \\lnot\\lnot P$. You have proved it already: it is <i>Using an implication</i> with $\\bot$ in its $Q$ slot. A machine that came from an implication can stamp its statement as a block, with the slots filled in as you like.",
      hint: "Open <i>Using an implication</i> and stamp it with $P$ for $P$ and false for $Q$.",
      proof: [make("", "pmp", { P: "P", Q: "false" })],
    },
    {
      id: "lefq", world: "logic", name: "From false, anything", pay: 3, needs: ["dne"], goal: "false->P",
      intro: "The other direction, $\\lnot\\lnot P \\to P$, can't be crafted from implication alone. It is the one axiom of classical logic: buy <b>Double negation</b>. First use: once you hold $\\bot$, you can craft anything.",
      hint: "Assume. <i>Weakening</i> turns $\\bot$ into $\\lnot P \\to \\bot$, which is $\\lnot\\lnot P$. Then Double negation.",
      proof: [assume(""), rule("a", 0, "pk", [], { Q: "P->false" }), rule("a", 0, "dne")],
    },
    {
      id: "le", world: "logic", name: "Or: from the left", pay: 3, goal: "P->P|Q",
      intro: "$P \\lor Q$ is short for $\\lnot P \\to Q$: if it isn't $P$, it's $Q$. A block or goal with $\\lor$ behaves like its definition wherever an implication is wanted, so Assume works on $P \\lor Q$ straight away. The other way round needs translating: tap a part of a block with the Scanner (or open the <i>Translator</i>) to fold or unfold a definition, for free.",
      hint: "Assume twice: you hold $P$ and $\\lnot P$. That's $\\bot$, and $\\bot$ gives anything.",
      proof: [assume(""), assume("a"), mp("aa", 1, 0), rule("aa", 0, "lefq", [], { P: "Q" })],
    },
    {
      id: "lre", world: "logic", name: "Or: from the right", pay: 2, goal: "Q->P|Q",
      intro: "The other half. Unfolded, $Q \\to P \\lor Q$ is $Q \\to (\\lnot P \\to Q)$, and you may have seen that before.",
      hint: "Assume twice, or stamp a theorem you already have with the right slots.",
      proof: [make("", "pk", { P: "Q", Q: "P->false" })],
    },
    {
      id: "landi", takes: 2, world: "logic", name: "And: make", pay: 3, goal: "P->(Q->P&Q)",
      intro: "$P \\land Q$ is short for $\\lnot(P \\to \\lnot Q)$: it is not the case that $P$ rules out $Q$. As with $\\lor$, Assume sees through it.",
      hint: "Assume three times: you hold $P$, $Q$ and $P \\to \\lnot Q$. Modus ponens twice.",
      proof: [assume(""), assume("a"), assume("aa"), mp("aaa", 2, 0), mp("aaa", 1, 0)],
    },
    {
      id: "landl", world: "logic", name: "And: left", pay: 4, needs: ["apply"], goal: "P&Q->P",
      intro: "Taking $\\land$ apart is harder: it needs working backwards. Buy <b>Apply</b>, a tactic: when the goal is $Q$, a block $P \\to Q$ (or a rule that concludes $Q$) turns the goal into $P$. Tap the block with Apply open, or drag it onto the goal. Double negation applied to the goal $P$ leaves $\\lnot\\lnot P$.",
      hint: "Assume. Apply Double negation, Assume $\\lnot P$, then apply $P \\land Q$ to the goal $\\bot$: it leaves $P \\to \\lnot Q$. Assume twice more.",
      proof: [assume(""), applyR("a", "dne"), assume("a1"), applyB("a1a", 0), assume("a1a1"), assume("a1a1a"), mp("a1a1aa", 0, 1)],
    },
    {
      id: "landr", world: "logic", name: "And: right", pay: 3, goal: "P&Q->Q",
      intro: "The same trick for the right half.",
      hint: "Assume, apply Double negation, assume $\\lnot Q$, apply $P \\land Q$, assume.",
      proof: [assume(""), applyR("a", "dne"), assume("a1"), applyB("a1a", 0), assume("a1a1")],
    },
    {
      id: "lore", world: "logic", name: "Or: by cases", pay: 5, goal: "(P->R)->((Q->R)->(P|Q->R))",
      intro: "If $P$ gives $R$ and $Q$ gives $R$, then $P \\lor Q$ gives $R$. The longest craft in logic. New on the floor: <b>Contradiction</b>. Applying Double negation and then assuming $\\lnot P$ is what you did in both $\\land$ proofs: that is proof by contradiction, and the tactic does both at once. It still counts as the two steps it is.",
      hint: "Assume three times and apply Double negation, so you hold $\\lnot R$ and the goal is $\\bot$. Keep a copy of $\\lnot R$, then work backwards: $\\lnot R$, then $Q \\to R$, then $P \\lor Q$ leave the goal $\\lnot P$.",
      proof: [assume(""), assume("a"), assume("aa"), applyR("aaa", "dne"), assume("aaa1"), dup("aaa1a", 3), applyB("aaa1a", 3), applyB("aaa1a1", 1), applyB("aaa1a11", 1), assume("aaa1a111"), mp("aaa1a111a", 0, 2), mp("aaa1a111a", 1, 0)],
    },
    {
      id: "la", world: "logic", name: "And commutes", pay: 3, goal: "P&Q->Q&P",
      intro: "With the three $\\land$ machines crafted, this is just plumbing.",
      hint: "Assume, copy the assumption, take $Q$ from one copy and $P$ from the other, then build $Q \\land P$. Amog takes a shortcut through <i>Swapping assumptions</i> and <i>Chain</i>.",
      proof: [assume(""), make("a", "pswap", { P: "Q", Q: "P", R: "false" }), rule("a", 1, "pchain", [0])],
    },
    {
      id: "lc", takes: 1, world: "logic", name: "Currying", pay: 3, goal: "(P&Q->R)->(P->(Q->R))",
      intro: "A machine that wants $P \\land Q$ can be fed $P$ and $Q$ one at a time.",
      hint: "Assume three times. Build $P \\land Q$, then modus ponens.",
      proof: [assume(""), assume("a"), assume("aa"), rule("aaa", 1, "landi", [2]), mp("aaa", 0, 1)],
    },
    {
      id: "lu", takes: 1, world: "logic", name: "Uncurrying", pay: 4, goal: "(P->(Q->R))->(P&Q->R)",
      intro: "And the other way round.",
      hint: "Assume twice. Take $P \\land Q$ apart (you need it twice), then modus ponens twice.",
      proof: [assume(""), assume("a"), dup("aa", 1), rule("aa", 1, "landl"), rule("aa", 2, "landr"), mp("aa", 0, 1), mp("aa", 0, 1)],
    },
    {
      id: "lo", world: "logic", name: "Or commutes", pay: 4, goal: "P|Q->Q|P",
      intro: "Unfolded, this is $(\\lnot P \\to Q) \\to (\\lnot Q \\to P)$.",
      hint: "Assume twice, apply Double negation and assume $\\lnot P$. $P \\lor Q$ and $\\lnot P$ go into modus ponens as they are.",
      proof: [assume(""), assume("a"), applyR("aa", "dne"), assume("aa1"), mp("aa1a", 0, 2), mp("aa1a", 1, 0)],
    },
    {
      id: "lt", world: "logic", name: "True can be dropped", pay: 2, goal: "(true->P)->P",
      intro: "$\\top$, the statement that is simply true, is short for $\\bot \\to \\bot$.",
      hint: "Assume, then apply the assumption to the goal. Amog does it without assuming: <i>Using an implication</i> works backwards too.",
      proof: [make("", "pid", { P: "false" }), applyR("", "pmp")],
    },
    {
      id: "lk", takes: 1, world: "logic", name: "Modus tollens", pay: 4, goal: "(P->Q)&(Q->false)->(P->false)",
      intro: "If $P$ implies $Q$ and $Q$ is false, then $P$ is false. Amog's proof is two steps long, and neither of them is Assume.",
      hint: "Assume twice. Take the $\\land$ apart (you need it twice), get $Q$ from $P$, then $\\bot$.",
      proof: [make("", "pchain", { P: "P", Q: "Q", R: "false" }), applyR("", "lu")],
    },
    {
      id: "lem", world: "logic", name: "Excluded middle", pay: 2, goal: "P|(P->false)",
      intro: "$P$ or not $P$: the famous one. Unfold it before you start.",
      curious: "Why is this so easy, when excluded middle is supposed to be the classical axiom? Because the classical part is in our definition of $\\lor$. In intuitionistic logic $P \\lor Q$ is a connective of its own: a proof of it is a proof of $P$ or a proof of $Q$, and $P \\lor \\lnot P$ can't be proved. Our $P \\lor Q$ means $\\lnot P \\to Q$, which intuitionistically is weaker (it follows from the real $\\lor$, not the other way round). Unfolded, excluded middle is just $\\lnot P \\to \\lnot P$, an Identity. The price was paid earlier: <i>Or: by cases</i>, the rule that makes $\\lor$ behave like an or, needed Double negation.",
      hint: "What does $P \\lor \\lnot P$ stand for?",
      proof: [assume("")],
    },
    {
      id: "lpeirce", world: "logic", name: "Peirce's law", pay: 5, goal: "((P->Q)->P)->P",
      intro: "A law with no $\\lnot$ in it that still needs the classical axiom.",
      hint: "Assume, apply Double negation, assume $\\lnot P$, keep a copy. Apply $\\lnot P$, then the assumption: the goal becomes $P \\to Q$.",
      proof: [assume(""), applyR("a", "dne"), assume("a1"), dup("a1a", 1), applyB("a1a", 1), applyB("a1a1", 0), assume("a1a11"), mp("a1a11a", 0, 1), rule("a1a11a", 0, "lefq", [], { P: "Q" })],
    },

    /* ---- multiplication: two more axioms, on top of all of addition ---- */
    {
      id: "mz", world: "mul", after: ["assoc"], name: "Zero times", pay: 3, needs: ["mul0", "mulS"], goal: "0*a=0",
      intro: "Multiplication is two more axioms to buy: $a \\cdot 0 = 0$ and $a \\cdot S(b) = a \\cdot b + a$. As with addition, the zero on the left needs induction.",
      hint: "Induct on $a$. In the step, <i>Times a successor</i> gives $0 \\cdot a + 0$.",
      proof: [induct("a"), refl("b", "0*0"), rw("b", [1], "mul0"),
        refl("s", "0*S(a)"), rw("s", [1], "mulS"), rw("s", [1], "add0"), rw("s", [1], "h0")],
    },
    {
      id: "ms", world: "mul", name: "Successor times", pay: 5, goal: "S(a)*b=a*b+b",
      intro: "The mirror image of <i>Times a successor</i>, and the longest craft yet. Some directions leave a slot open: $0 \\to a \\cdot 0$ has to be told which $a$, and the machine asks.",
      hint: "Induct on $b$. In the step both sides reach $S(a \\cdot b + (b + a))$: push every $S$ outward, then use associativity and commutativity of $+$.",
      proof: [induct("b"),
        refl("b", "S(a)*0"), rw("b", [1], "mul0"), rw("b", [1], "add0", "rl"), rw("b", [1, 0], "mul0", "rl", { a: "a" }),
        refl("s", "S(a)*S(b)"), rw("s", [1], "mulS"), rw("s", [1, 0], "h0"), rw("s", [1], "addS"), rw("s", [1, 0], "assoc"),
        rw("s", [1, 0, 1], "comm"), rw("s", [1, 0], "assoc", "rl"), rw("s", [1], "addS", "rl"), rw("s", [1, 0], "mulS", "rl")],
    },
    {
      id: "mdist", world: "mul", name: "Distributivity", pay: 4, goal: "a*(b+c)=a*b+a*c",
      intro: "The law that ties $\\cdot$ to $+$.",
      hint: "Induct on $c$. For the base case it is easier to start refl from the right-hand side and work on the left.",
      proof: [induct("c"),
        refl("b", "a*b+a*0"), rw("b", [0, 1], "mul0"), rw("b", [0], "add0"), rw("b", [0, 1], "add0", "rl"),
        refl("s", "a*(b+S(c))"), rw("s", [1, 1], "addS"), rw("s", [1], "mulS"), rw("s", [1, 0], "h0"), rw("s", [1], "assoc"), rw("s", [1, 1], "mulS", "rl")],
    },
    {
      id: "mcomm", world: "mul", name: "Commutativity of ·", pay: 4, goal: "a*b=b*a",
      intro: "Once more the two mirror-image machines do the work.",
      hint: "Induct on $b$. The base case ends with <i>Zero times</i> run backwards, which needs to be told its $a$.",
      proof: [induct("b"),
        refl("b", "a*0"), rw("b", [1], "mul0"), rw("b", [1], "mz", "rl", { a: "a" }),
        refl("s", "a*S(b)"), rw("s", [1], "mulS"), rw("s", [1, 0], "h0"), rw("s", [1], "ms", "rl")],
    },
    {
      id: "massoc", world: "mul", name: "Associativity of ·", pay: 5, goal: "(a*b)*c=a*(b*c)",
      intro: "The last one for multiplication. With this, the numbers are a commutative semiring.",
      hint: "Induct on $c$. The step is <i>Distributivity</i> run backwards.",
      proof: [induct("c"),
        refl("b", "(a*b)*0"), rw("b", [1], "mul0"), rw("b", [1], "mul0", "rl", { a: "a" }), rw("b", [1, 1], "mul0", "rl", { a: "b" }),
        refl("s", "(a*b)*S(c)"), rw("s", [1], "mulS"), rw("s", [1, 0], "h0"), rw("s", [1], "mdist", "rl"), rw("s", [1, 1], "mulS", "rl")],
    },
  ].map(q => ({ world: "add", ...q }));

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
    { id: "ln", name: "Triple negation", goal: "(((P->false)->false)->false)->(P->false)", pay: 4, worlds: ["prop"],
      intro: "$\\lnot\\lnot\\lnot P \\to \\lnot P$, with implication only: no Double negation axiom and nothing from logic.",
      proof: [assume(""), assume("a"), rule("aa", 1, "pmp", [], { Q: "false" }), mp("aa", 0, 1)] },
  ].map(b => ({ ...b, bounty: true }));

  /* a workshop finishes only when the player says so (a qed step, free): add those to the reference proofs */
  const EVERY = [...GATES, ...QUESTS.map(L.questMachine)];
  for (const q of [...QUESTS, ...BOUNTIES]) q.proof = L.withQed(q, EVERY, q.proof);

  const PAR_BONUS = 1;
  const SHOP = [
    { id: "add0", gate: true, price: 1, after: ["refl0"] },
    { id: "addS", gate: true, price: 2, after: ["trans"] },
    { id: "induct", gate: true, price: 3, after: ["trans"] },
    { id: "assume", gate: true, price: 3, after: ["trans"] },
    { id: "mp", gate: true, price: 3, after: ["pk"] },
    { id: "have", gate: true, extra: true, price: 3, after: ["pmp"] },
    { id: "dne", gate: true, price: 3, after: ["lnn"] },
    { id: "apply", gate: true, price: 3, after: ["landi"] },
    { id: "byc", gate: true, extra: true, price: 2, after: ["landr"] },
    { id: "mul0", gate: true, price: 2, after: ["assoc"] },
    { id: "mulS", gate: true, price: 3, after: ["assoc"] },
    { id: "autofill", name: "Autofill", price: 2, text: "refl offers the two sides of the goal, and Induction offers the letters, so you type less." },
    { id: "press", name: "Block press", price: 2, text: "Any equality machine can stamp its own statement onto the bench, with the slots filled in as you like." },
    { id: "scanner", name: "Scanner", price: 4, text: "Tap a part of a block with no machine open to list every machine that fits it, and see where the open machine fits." },
    { id: "goalrw", name: "Goal lever", price: 4, after: ["assoc"], text: "Equality machines rewrite the goal too: with one open, tap a part of the goal. Craft towards the goal and the goal towards you." },
  ];
  const price = id => (SHOP.find(x => x.id === id) || { price: 0 }).price;
  const gate = id => GATES.find(m => m.id === id);
  const par = q => L.count(q.proof);
  const all = (ids, done) => (ids || []).every(id => id in done);
  /* done: { id: best step count }. A quest is open once the quests it comes after are finished. */
  function isOpen(q, done) {
    if (q.after) return all(q.after, done);
    const i = QUESTS.indexOf(q);
    return i <= 0 || QUESTS[i - 1].world !== q.world || QUESTS[i - 1].id in done;
  }
  /* a shop item is on sale once the quests it comes after are finished */
  const onSale = (id, done) => { const it = SHOP.find(x => x.id === id); return !!it && all(it.after, done); };
  function earned(done) {
    let n = 0;
    for (const q of QUESTS) if (q.id in done) n += q.pay + (done[q.id] <= par(q) ? PAR_BONUS : 0);
    for (const b of BOUNTIES) if (b.id in done) n += b.pay;
    return n;
  }
  const balance = (done, owned) => earned(done) - [...owned].reduce((a, id) => a + price(id), 0);
  /* what the machines a quest still needs would cost */
  const missing = (q, owned) => (q.needs || []).filter(id => !owned.has(id)).reduce((a, id) => a + price(id), 0);
  /* Can every quest still be finished from here, even with no bonuses and no bounties? prog = quests finished per
     world, mask = gates owned, bal = ∎ in hand. Upgrades only ever cost, so they don't appear. */
  const CHAINS = WORLDS.map(w => QUESTS.filter(q => q.world === w[0]));
  const GATE_IDS = SHOP.filter(x => x.gate).map(x => x.id);
  const memo = new Map();
  function alive(prog, mask, bal) {
    if (CHAINS.every((qs, w) => prog[w] >= qs.length)) return true;
    const key = prog.join(",") + "|" + mask + "|" + bal;
    if (memo.has(key)) return memo.get(key);
    const done = {};
    CHAINS.forEach((qs, w) => qs.slice(0, prog[w]).forEach(q => { done[q.id] = 1; }));
    const owns = id => mask >> GATE_IDS.indexOf(id) & 1;
    let ok = false;
    for (let w = 0; w < CHAINS.length && !ok; w++) {
      const q = CHAINS[w][prog[w]];
      if (q && isOpen(q, done) && (q.needs || []).every(owns)) ok = alive(prog.map((n, k) => n + (k === w)), mask, bal + q.pay);
    }
    for (let k = 0; k < GATE_IDS.length && !ok; k++) {
      const id = GATE_IDS[k];
      if (!(mask >> k & 1) && onSale(id, done) && price(id) <= bal) ok = alive(prog, mask | 1 << k, bal - price(id));
    }
    memo.set(key, ok);
    return ok;
  }
  /* "" if id can be bought now, otherwise the reason it can't. The last check is what keeps a choice from
     becoming a trap: a purchase is refused if it could leave some quest forever out of reach. */
  function canBuy(id, done, owned) {
    const it = SHOP.find(x => x.id === id), have = balance(done, owned);
    if (!it) return "no such thing";
    if (owned.has(id)) return "you own it";
    if (!onSale(id, done)) return it.gate ? "not on sale yet" : "on sale once you've crafted " + it.after.map(a => QUESTS.find(q => q.id === a).name).join(" and ");
    if (have < it.price) return "you need ∎" + (it.price - have) + " more";
    const prog = CHAINS.map(qs => qs.filter(q => q.id in done).length);
    const mask = GATE_IDS.reduce((m, g, k) => m | (owned.has(g) || g === id ? 1 << k : 0), 0);
    if (!alive(prog, mask, have - it.price)) return "that would leave too little for the machines the quests ahead need";
    return "";
  }

  const mine = (owned, world) => GATES.filter(m => (!owned || owned.has(m.id)) && sees(world, m.w));
  /* machines quest number i may use: the shop machines owned and the finished quests listed before it, from the
     worlds its world sees */
  function machinesFor(i, done, owned) {
    const w = QUESTS[i].world;
    return [...mine(owned, w), ...QUESTS.slice(0, i).filter(q => done.has(q.id) && sees(w, q.world)).map(L.questMachine)];
  }
  /* machines for bounties and the playground: the shop machines owned and every finished quest */
  function playMachines(done, owned, worlds) {
    const ok = w => !worlds || w === "any" || worlds.includes(w);
    return [...mine(owned).filter(m => ok(m.w)), ...QUESTS.filter(q => done.has(q.id) && ok(q.world)).map(L.questMachine)];
  }

  root.MathcraftQuests = { GATES, WORLDS, SEES, sees, TACTICS, QUESTS, BOUNTIES, SHOP, PAR_BONUS, gate, machinesFor, playMachines, par, price, isOpen, onSale, missing, earned, balance, canBuy };
})(typeof window !== "undefined" ? window : globalThis);
