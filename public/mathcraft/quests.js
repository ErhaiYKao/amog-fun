/* Mathcraft quests (#33): the shop machines, the quest worlds and Amog's reference proof of each quest.
 * Needs logic.js first. Pure (page and Node).
 *
 * A quest: { id, world, name, goal, given?, takes?, pay, needs?, after?, intro, hint, proof, guide? }. Finishing it adds its
 * theorem to the library as a machine (a rule if it has `given` premises); a quest may only use the shop machines
 * owned and the finished quests listed before it (machinesFor), so nothing is ever circular. `proof` is a list of
 * engine steps (see logic.js); its length is the par shown to the player, and the tests replay it, so every quest
 * is known to be provable. A quest opens when every quest in `after` is finished (default: the one before it in its
 * world), `needs` lists the shop machines its proof uses, and `guide` makes the page point at each next step
 * without being asked (the first use of a mechanic; everywhere else the hint button does it on request).
 * `takes` is how many arrows of an implication are hypotheses of its rule (logic.js questMachine): read the goal as
 * a theorem, "from these, that", so Chain is "P → Q, Q → R give P → R" rather than a disguised modus ponens.
 *
 * Worlds branch (Pope Amog's choice): addition is the trunk; implication opens after Zero plus zero, equality
 * (Symmetry and Transitivity as implications between equations, airetho) after Identity, logic (and, or, false,
 * true) after the third implication quest, equivalence (↔ and the laws of logic, proved by rewriting) after Or
 * commutes, multiplication after Associativity, powers after Associativity of ·, each started by buying its
 * machines. A world only sees machines from the worlds in SEES (logic sees implication, equivalence sees logic,
 * multiplication sees addition, powers see multiplication, the number worlds see equality); bounties and the
 * playground see everything. A world's quests need
 * not sit together in QUESTS: the order of the list is what a quest may use (the finished quests before it), so
 * the equality quests sit before Zero on the left.
 *
 * Economy: finishing a quest pays `pay` ∎ (tombstones), plus PAR_BONUS if the best proof is no longer than Amog's;
 * BOUNTIES are optional theorems that pay once, each open once the machines its reference proof uses are there. ∎ buys the SHOP: `gate` machines (axioms, Induction, Assume, Modus
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
    ["iff", { id: "cases", name: "Cases" }],
    ["mul", L.machine({ id: "mul0", name: "Times zero", stmt: "a*0=0" })],
    ["mul", L.machine({ id: "mulS", name: "Times a successor", stmt: "a*S(b)=a*b+a" })],
    ["pow", L.machine({ id: "pow0", name: "Power zero", stmt: "a^0=1" })],
    ["pow", L.machine({ id: "powS", name: "Power of a successor", stmt: "a^S(b)=a^b*a" })],
  ].map(([w, m]) => ({ ...m, w }));
  const WORLDS = [["add", "Addition"], ["prop", "Implication"], ["eq", "Equality"], ["logic", "Logic"], ["iff", "Equivalence"], ["mul", "Multiplication"], ["pow", "Powers"]];
  const SEES = { add: ["add", "eq"], prop: ["prop"], eq: ["eq", "prop"], logic: ["prop", "logic"], iff: ["prop", "logic", "iff"], mul: ["add", "mul", "eq"], pow: ["add", "mul", "eq", "pow"] };
  /* does a quest in `world` see things from world w? (no world = bounties and the playground: everything) */
  const sees = (world, w) => !world || w === "any" || SEES[world].includes(w);
  /* tactics open workshops instead of stating something */
  const TACTICS = ["induct", "assume", "apply", "have", "byc", "cases"];

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
  const unf = (at, path, as) => ({ op: "unfold", at, b: 0, path, ...(as ? { as } : {}) });
  const cases = (at, b) => ({ op: "cases", at, b });
  const both = (m, a, b) => [make("", m, a), make("", m, b), rule("", 0, "landi", [1])];   // each direction stamped, then And: make

  const QUESTS = [
    {
      id: "refl0", name: "Something from nothing", pay: 2, goal: "0=0", guide: true,
      intro: "This is your first machine. <b>refl</b> makes theorems of the form $t = t$ out of thin air, for any term $t$ you feed it. That is already enough for a theorem, if not a deep one.",
      hint: "Open refl, type $0$ and run it.",
      proof: [refl("", "0")],
    },
    {
      id: "zz", name: "Zero plus zero", pay: 3, needs: ["add0"], goal: "0+0=0", guide: true,
      intro: "Finishing a craft pays ∎, and ∎ buys machines. This quest needs one: <i>Adding zero</i>, an axiom. An equality machine rewrites a part of a block: set its lever to a direction, then tap the part to feed it. Nearly every equation is crafted this way: make a block from one side of the goal with refl, then rewrite its other side until the block is the goal.",
      hint: "Make $0+0 = 0+0$ with refl. Then open <i>Adding zero</i>, set its lever to $a+0 \\to a$, and tap the $0+0$ on the right side of your block.",
      proof: [refl("", "0+0"), rw("", [1], "add0")],
    },
    /* ---- equality: Symmetry and Transitivity in the logic world's framing (airetho). They sit here in the list
       so the number worlds can use them as rules, but they open after Identity. ---- */
    {
      id: "sym", world: "eq", after: ["pid"], name: "Symmetry", pay: 2, goal: "a=b->b=a",
      intro: "Equations can be assumed too. To craft $a = b \\to b = a$, run Assume: you get a workshop that holds $a = b$, for two numbers you know nothing else about. A fact you hold is a machine: it rewrites $a$ into $b$, or $b$ back into $a$, but only this $a$ and this $b$.",
      hint: "Assume. Make $b = b$ with refl, then open the assumption and run it backwards ($b \\to a$) on the right side of that block.",
      proof: [assume(""), refl("a", "b"), { ...rw("a", [1], "h0", "rl"), b: 1 }],
    },
    {
      id: "trans", world: "eq", name: "Transitivity", pay: 2, goal: "a=b->(b=c->a=c)",
      intro: "Two assumptions, one after the other. Once this is crafted, <i>Symmetry</i> and <i>Transitivity</i> are rules in every world with numbers: they take whole blocks, so open one and tap a block's $=$ sign.",
      hint: "Assume twice. Both assumptions are on the bench already: use the second one, $b = c$, to rewrite the right side of the block $a = b$.",
      proof: [assume(""), assume("a"), rw("aa", [1], "h1")],
    },
    {
      id: "zadd", name: "Zero on the left", pay: 3, needs: ["addS", "induct"], goal: "0+a=a", guide: true,
      intro: "<i>Adding zero</i> says $a+0 = a$. With the zero on the left, no machine fits: $a$ could be anything. Two machines to buy: <i>Adding a successor</i>, the other axiom, and <b>Induction</b>. Induction splits the job into two workshops: craft the goal for $0$ (the base case), then craft it for $S(a)$ while <i>holding</i> it for $a$ (the step). What you hold there, the induction hypothesis, is a machine too: it turns $0+a$ into $a$, but only for this $a$.",
      hint: "Induct on $a$. Each workshop then goes like <i>Zero plus zero</i>: make a block from the goal's left side with refl, and rewrite its right side until it reads the goal's right side. Don't try to reshape the induction hypothesis into the goal: it is the machine for the last rewrite. In the step, <i>Adding a successor</i> turns $0+S(a)$ into $S(0+a)$, and now there is a $0+a$ inside for the induction hypothesis to work on.",
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
      id: "pid", world: "prop", after: ["zz"], name: "Identity", pay: 2, needs: ["assume"], goal: "P->P", guide: true,
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
      id: "pmp", takes: 1, world: "prop", name: "Using an implication", pay: 3, needs: ["mp"], goal: "P->((P->Q)->Q)", guide: true,
      intro: "Holding $P \\to Q$ and $P$ should give $Q$. That is a machine to buy: <b>Modus ponens</b>, a rule. Feed it the implication first, then the block that matches its left side; it uses up both. Every implication you craft from now on becomes a rule of its own: it takes its hypotheses as blocks and gives what they imply.",
      hint: "Assume twice, then open Modus ponens and tap the $\\to$ of $P \\to Q$, then $P$.",
      proof: [assume(""), assume("a"), mp("aa", 1, 0)],
    },
    {
      id: "pchain", takes: 2, world: "prop", name: "Chain", pay: 4, goal: "(P->Q)->((Q->R)->(P->R))",
      intro: "Implications compose: from $P$ to $Q$ and from $Q$ to $R$ makes from $P$ to $R$.",
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

    /* ---- equivalence (airetho): A ↔ B is (A → B) ∧ (B → A), and a proved ↔ rewrites statements the way an equation
       rewrites numbers. The laws of logic, most of them crafted by rewriting instead of by assuming. ---- */
    {
      id: "ir", world: "iff", after: ["lo"], name: "If and only if", pay: 2, goal: "P<->P", guide: true,
      intro: "$P \\leftrightarrow Q$, \"$P$ if and only if $Q$\", is short for $(P \\to Q) \\land (Q \\to P)$: each gives the other. The $\\land$ machines see through it, so a $\\leftrightarrow$ is crafted like an $\\land$: one workshop for each direction. Once crafted, a $\\leftrightarrow$ is a machine with a lever, like an equation: it rewrites any part of a block that reads like one side into the other. This first one, $P \\leftrightarrow P$, is the refl of statements: stamp it with any statement to start from.",
      hint: "Apply <i>And: make</i> to the goal. It leaves two workshops, both with the goal $P \\to P$: Assume in each.",
      proof: [applyR("", "landi"), assume("1"), assume("2")],
    },
    {
      id: "idn", world: "iff", name: "Double negation, both ways", pay: 2, goal: "not not P<->P",
      intro: "You hold both directions already: the axiom <i>Double negation</i> and the theorem <i>Double negation in</i>. Stamp each and join them. The machine you get adds or removes $\\lnot\\lnot$ anywhere inside a block.",
      hint: "Stamp <i>Double negation</i> and <i>Double negation in</i> (both with $P$), then feed the two blocks to <i>And: make</i>.",
      proof: both("dne", { P: "P" }, { P: "P" }).map((st, k) => (k === 1 ? { ...st, m: "lnn" } : st)),
    },
    {
      id: "idm", world: "iff", name: "De Morgan: not or", pay: 3, goal: "not (P|Q)<->not P&not Q", guide: true,
      intro: "Now the new way of crafting: start from a block that says a statement is equivalent to itself, then rewrite one side until it is the goal. Translating is free, so the only real step is one rewrite.",
      hint: "Stamp <i>If and only if</i> with $\\lnot(P \\lor Q)$. On the right side, unfold the $\\lor$: it reads $\\lnot(\\lnot P \\to Q)$. Turn that $Q$ into $\\lnot\\lnot Q$ with <i>Double negation, both ways</i> run backwards. What is left, $\\lnot(\\lnot P \\to \\lnot\\lnot Q)$, is $\\lnot P \\land \\lnot Q$ written out: the block is the goal (fold it with the Translator to see it).",
      proof: [make("", "ir", { P: "not (P|Q)" }), unf("", [1, 0]), rw("", [1, 0, 1], "idn", "rl")],
    },
    {
      id: "idm2", world: "iff", name: "De Morgan: not and", pay: 3, goal: "not (P&Q)<->not P|not Q",
      intro: "The other De Morgan law, the same way.",
      hint: "Stamp <i>If and only if</i> with $\\lnot(P \\land Q)$ and unfold the $\\land$ on the right: $\\lnot\\lnot(P \\to \\lnot Q)$. Remove that $\\lnot\\lnot$ and put one on the $P$ instead: $\\lnot\\lnot P \\to \\lnot Q$ is $\\lnot P \\lor \\lnot Q$ written out.",
      proof: [make("", "ir", { P: "not (P&Q)" }), unf("", [1, 0]), rw("", [1], "idn"), rw("", [1, 0], "idn", "rl")],
    },
    {
      id: "iac", world: "iff", name: "And commutes, both ways", pay: 2, goal: "P&Q<->Q&P",
      intro: "<i>And commutes</i> is an implication, so it only works on a whole block. As a $\\leftrightarrow$ it swaps an $\\land$ anywhere inside one.",
      hint: "Stamp <i>And commutes</i> twice, once with $P$ and $Q$ the other way round, and join them with <i>And: make</i>.",
      proof: both("la", { P: "P", Q: "Q" }, { P: "Q", Q: "P" }),
    },
    {
      id: "ioc", world: "iff", name: "Or commutes, both ways", pay: 2, goal: "P|Q<->Q|P",
      intro: "And the same for $\\lor$.",
      hint: "Stamp <i>Or commutes</i> twice and join them.",
      proof: both("lo", { P: "P", Q: "Q" }, { P: "Q", Q: "P" }),
    },
    {
      id: "icur", world: "iff", name: "Currying, both ways", pay: 2, goal: "(P&Q->R)<->(P->(Q->R))",
      intro: "<i>Currying</i> and <i>Uncurrying</i> are the two directions of one equivalence. It is the machine that moves an $\\land$ in and out of an implication.",
      hint: "Stamp <i>Currying</i> and <i>Uncurrying</i> and join them.",
      proof: both("lc", { P: "P", Q: "Q", R: "R" }, { P: "P", Q: "Q", R: "R" }).map((st, k) => (k === 1 ? { ...st, m: "lu" } : st)),
    },
    {
      id: "iaa", world: "iff", name: "And associates", pay: 4, goal: "(P&Q)&R<->P&(Q&R)",
      intro: "Brackets in a chain of $\\land$ don't matter. You could take both sides apart block by block; Amog rewrites instead. Unfolded, an $\\land$ has an implication inside it, and <i>Currying, both ways</i> moves brackets there.",
      hint: "Stamp <i>If and only if</i> with $(P \\land Q) \\land R$ and unfold the outer $\\land$ on the right: $\\lnot(P \\land Q \\to \\lnot R)$. Curry the inside to $P \\to (Q \\to \\lnot R)$, then uncurry its second half, $Q \\to \\lnot R$, to $\\lnot(Q \\land R)$. What is left, $\\lnot(P \\to \\lnot(Q \\land R))$, is $P \\land (Q \\land R)$ written out.",
      proof: [make("", "ir", { P: "(P&Q)&R" }), unf("", [1]), rw("", [1, 0], "icur"), rw("", [1, 0, 1], "icur", "rl")],
    },
    {
      id: "ioa", world: "iff", name: "Or associates", pay: 4, goal: "(P|Q)|R<->P|(Q|R)",
      intro: "The same for $\\lor$, and shorter than it looks: unfolded, the two sides are a De Morgan law and a currying apart.",
      hint: "Stamp <i>If and only if</i> with $(P \\lor Q) \\lor R$ and unfold the outer $\\lor$ on the right: $\\lnot(P \\lor Q) \\to R$. De Morgan makes that $\\lnot P \\land \\lnot Q \\to R$, currying makes it $\\lnot P \\to (\\lnot Q \\to R)$, and that is $P \\lor (Q \\lor R)$ written out.",
      proof: [make("", "ir", { P: "(P|Q)|R" }), unf("", [1]), rw("", [1, 0], "idm"), rw("", [1], "icur")],
    },
    {
      id: "iof", world: "iff", name: "Or with false", pay: 2, goal: "P|false<->P",
      intro: "The simplification laws: $\\bot$ does nothing to an $\\lor$. Unfold $P \\lor \\bot$ in your head before you start.",
      hint: "$P \\lor \\bot$ is short for $\\lnot P \\to \\bot$, which is $\\lnot\\lnot P$. So the goal is <i>Double negation, both ways</i> in disguise: stamp it.",
      proof: [make("", "idn", { P: "P" })],
    },
    {
      id: "iat", world: "iff", name: "And with true", pay: 3, goal: "P&true<->P",
      intro: "And $\\top$ does nothing to an $\\land$. This one is crafted a direction at a time.",
      hint: "Apply <i>And: make</i> to the goal. One direction is <i>And: left</i>, stamped. For the other, assume $P$, make $\\top$ (it is <i>Identity</i> stamped with $\\bot$) and join them.",
      proof: [applyR("", "landi"), make("1", "landl", { P: "P", Q: "true" }), assume("2"), make("2a", "pid", { P: "false" }), rule("2a", 0, "landi", [1])],
    },
    {
      id: "idist", world: "iff", name: "Distributivity", pay: 6, needs: ["cases"], goal: "P&(Q|R)<->(P&Q)|(P&R)",
      intro: "The law that ties $\\land$ to $\\lor$, and the longest craft in logic. A new machine to buy: <b>Cases</b> takes a block apart. A block $P \\land Q$ becomes the two blocks $P$ and $Q$. A block $P \\lor Q$ splits the workshop in two: one where you hold $P$, one where you hold $Q$, with the same goal in both. No more unfolding into implications.",
      hint: "Apply <i>And: make</i> for the two directions and Assume in each. Left to right: take $P \\land (Q \\lor R)$ apart, then the $\\lor$; in each case make the $\\land$ you can and put it into an $\\lor$ with <i>Or: from the left</i> or <i>from the right</i>. Right to left: take the $\\lor$ apart first, then the $\\land$ in each case.",
      proof: [applyR("", "landi"),
        assume("1"), cases("1a", 0), cases("1a", 1),
        rule("1ap", 0, "landi", [1]), rule("1ap", 0, "le", [], { Q: "P&R" }),
        rule("1aq", 0, "landi", [1]), rule("1aq", 0, "lre", [], { P: "P&Q" }),
        assume("2"), cases("2a", 0),
        cases("2ap", 0), rule("2ap", 1, "le", [], { Q: "R" }), rule("2ap", 0, "landi", [1]),
        cases("2aq", 0), rule("2aq", 1, "lre", [], { P: "Q" }), rule("2aq", 0, "landi", [1])],
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

    /* ---- powers: two more axioms, on top of multiplication ---- */
    {
      id: "t1", world: "pow", after: ["massoc"], name: "Times one", pay: 2, goal: "a*1=a",
      intro: "Powers are repeated multiplication, and the empty product is $1$, so $1$ had better do nothing. A warm-up with the machines you have: $1$ is $S(0)$.",
      hint: "Start from $a \\cdot S(0)$: <i>Times a successor</i>, then <i>Times zero</i>, then <i>Zero on the left</i>.",
      proof: [refl("", "a*1"), rw("", [1], "mulS"), rw("", [1, 0], "mul0"), rw("", [1], "zadd")],
    },
    {
      id: "pone", world: "pow", name: "First power", pay: 3, needs: ["pow0", "powS"], goal: "a^1=a",
      intro: "Two more axioms to buy: $a^0 = 1$ and $a^{S(b)} = a^b \\cdot a$. Type a power as a^b.",
      hint: "$a^{S(0)}$ is $a^0 \\cdot a$, which is $S(0) \\cdot a$. Swap it round and <i>Times one</i> finishes.",
      proof: [refl("", "a^1"), rw("", [1], "powS"), rw("", [1, 0], "pow0"), rw("", [1], "mcomm"), rw("", [1], "t1")],
    },
    {
      id: "p1", world: "pow", name: "One to any power", pay: 3, goal: "1^a=1",
      intro: "The exponent is the number that counts, so that is the one to induct on.",
      hint: "Induct on $a$. In the step, $S(0)^{S(a)}$ is $S(0)^a \\cdot S(0)$: <i>Times one</i>, then the induction hypothesis.",
      proof: [induct("a"), refl("b", "1^0"), rw("b", [1], "pow0"),
        refl("s", "1^S(a)"), rw("s", [1], "powS"), rw("s", [1], "t1"), rw("s", [1], "h0")],
    },
    {
      id: "padd", world: "pow", name: "Adding exponents", pay: 5, goal: "a^(b+c)=a^b*a^c",
      intro: "The law everyone remembers: multiplying powers adds the exponents.",
      hint: "Induct on $c$. Base: $a^{b+0}$ is $a^b$, and <i>Times one</i> run backwards turns that into $a^b \\cdot S(0)$. Step: <i>Adding a successor</i> in the exponent, then <i>Power of a successor</i>, the induction hypothesis and associativity of $\\cdot$.",
      proof: [induct("c"),
        refl("b", "a^(b+0)"), rw("b", [1, 1], "add0"), rw("b", [1], "t1", "rl"), rw("b", [1, 1], "pow0", "rl", { a: "a" }),
        refl("s", "a^(b+S(c))"), rw("s", [1, 1], "addS"), rw("s", [1], "powS"), rw("s", [1, 0], "h0"), rw("s", [1], "massoc"), rw("s", [1, 1], "powS", "rl")],
    },
    {
      id: "ppow", world: "pow", name: "Power of a power", pay: 5, goal: "(a^b)^c=a^(b*c)",
      intro: "The last one for powers: a power of a power multiplies the exponents.",
      hint: "Induct on $c$. The step ends with <i>Adding exponents</i> run backwards, then <i>Times a successor</i> run backwards in the exponent.",
      proof: [induct("c"),
        refl("b", "(a^b)^0"), rw("b", [1], "pow0"), rw("b", [1], "pow0", "rl", { a: "a" }), rw("b", [1, 1], "mul0", "rl", { a: "b" }),
        refl("s", "(a^b)^S(c)"), rw("s", [1], "powS"), rw("s", [1, 0], "h0"), rw("s", [1], "padd", "rl"), rw("s", [1, 1], "mulS", "rl")],
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
    { id: "bdbl", name: "Doubling", goal: "a*2=a+a", pay: 3,
      proof: [refl("", "a*2"), rw("", [1], "mulS"), rw("", [1, 0], "mulS"), rw("", [1, 0, 0], "mul0"), rw("", [1, 0], "zadd")] },
    { id: "b2x2", name: "Two times two", goal: "2*2=4", pay: 3,
      proof: [refl("", "2*2"), rw("", [1], "mulS"), rw("", [1, 0], "mulS"), rw("", [1, 0, 0], "mul0"), rw("", [1, 0], "zadd"), rw("", [1], "addS"), rw("", [1, 0], "addS"), rw("", [1, 0, 0], "add0")] },
    { id: "brd", name: "Distributing from the right", goal: "(a+b)*c=a*c+b*c", pay: 3,
      proof: [refl("", "(a+b)*c"), rw("", [1], "mcomm"), rw("", [1], "mdist"), rw("", [1, 0], "mcomm"), rw("", [1, 1], "mcomm")] },
    { id: "bz", name: "Zero to a power", goal: "0^S(a)=0", pay: 2,
      proof: [refl("", "0^S(a)"), rw("", [1], "powS"), rw("", [1], "mul0")] },
    { id: "bsq", name: "Squaring", goal: "a^2=a*a", pay: 2,
      proof: [refl("", "a^2"), rw("", [1], "powS"), rw("", [1, 0], "pone")] },
    { id: "beq", name: "Symmetry, both ways", goal: "a=b<->b=a", pay: 2,
      intro: "A $\\leftrightarrow$ between equations rewrites an equation inside a block.",
      proof: both("sym", { a: "a", b: "b" }, { a: "b", b: "a" }) },
    { id: "bimp", name: "Implication as or", goal: "(P->Q)<->(not P|Q)", pay: 3,
      proof: [make("", "ir", { P: "P->Q" }), rw("", [1, 0], "idn", "rl")] },
    { id: "bcontra", name: "A contradiction is false", goal: "P&not P<->false", pay: 3,
      proof: [applyR("", "landi"), assume("1"), cases("1a", 0), mp("1a", 1, 0), make("2", "lefq", { P: "P&not P" })] },
    { id: "bdist", name: "The other distributivity", goal: "P|(Q&R)<->(P|Q)&(P|R)", pay: 5,
      intro: "$\\lor$ distributes over $\\land$ too. No cases needed: it is <i>Distributivity</i> seen through De Morgan's laws.",
      proof: [make("", "ir", { P: "P|(Q&R)" }), rw("", [1], "idn", "rl"), rw("", [1, 0], "idm"), rw("", [1, 0, 1], "idm2"), rw("", [1, 0], "idist"),
        rw("", [1, 0, 0], "idm", "rl"), rw("", [1, 0, 1], "idm", "rl"), rw("", [1, 0], "idm2", "rl"), rw("", [1], "idn")] },
  ].map(b => ({ ...b, bounty: true }));

  /* a workshop finishes only when the player says so (a qed step, free): add those to the reference proofs */
  const EVERY = [...GATES, ...QUESTS.map(L.questMachine)];
  for (const q of [...QUESTS, ...BOUNTIES]) q.proof = L.withQed(q, EVERY, q.proof);
  /* a bounty opens once the machines Amog's proof of it uses are there (airetho): shop machines owned, theorems crafted */
  for (const b of BOUNTIES) b.tools = [...new Set(b.proof.flatMap(s => [TACTICS.includes(s.op) ? s.op : null, s.m]).filter(m => m && !/^h\d+$/.test(m)))];

  const PAR_BONUS = 1;
  const SHOP = [
    { id: "add0", gate: true, price: 1, after: ["refl0"] },
    { id: "addS", gate: true, price: 2, after: ["zz"] },
    { id: "induct", gate: true, price: 2, after: ["zz"] },
    { id: "assume", gate: true, price: 3, after: ["zz"] },
    { id: "mp", gate: true, price: 3, after: ["pk"] },
    { id: "have", gate: true, extra: true, price: 3, after: ["pmp"] },
    { id: "dne", gate: true, price: 3, after: ["lnn"] },
    { id: "apply", gate: true, price: 3, after: ["landi"] },
    { id: "byc", gate: true, extra: true, price: 2, after: ["landr"] },
    { id: "cases", gate: true, price: 3, after: ["iat"] },
    { id: "mul0", gate: true, price: 2, after: ["assoc"] },
    { id: "mulS", gate: true, price: 3, after: ["assoc"] },
    { id: "pow0", gate: true, price: 2, after: ["t1"] },
    { id: "powS", gate: true, price: 3, after: ["t1"] },
    { id: "autofill", name: "Autofill", price: 2, text: "refl offers the two sides of the goal, and Induction offers the letters, so you type less." },
    { id: "press", name: "Block press", price: 2, text: "Any equality machine can stamp its own statement onto the bench, with the slots filled in as you like." },
    { id: "quick", name: "Goal buttons", price: 2, text: "When the goal reads t = t, a refl button on it crafts that block and uses it. When the goal is an implication, an assume button runs Assume. One tap instead of opening the machine." },
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
    const chain = QUESTS.filter(x => x.world === q.world), k = chain.indexOf(q);
    return k <= 0 || chain[k - 1].id in done;
  }
  const bountyOpen = (b, done, owned) => b.tools.every(id => (gate(id) ? owned.has(id) : id in done));
  /* does a world work with numbers (so refl belongs on its floor)? */
  const numeric = w => QUESTS.some(q => q.world === w && q.goal.includes("="));
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
     world, mask = gates owned, bal = ∎ in hand. Upgrades only ever cost, so they don't appear. Finishing a quest
     never hurts (it pays, and only ever opens things), so every quest that can be done is done first; what is
     left to search is the order of purchases. */
  const CHAINS = WORLDS.map(w => QUESTS.filter(q => q.world === w[0]));
  const GATE_IDS = SHOP.filter(x => x.gate).map(x => x.id);
  const NEEDED = new Set(QUESTS.flatMap(q => q.needs || []));
  const memo = new Map();
  function alive(prog, mask, bal) {
    prog = prog.slice();
    const done = {}, owns = id => mask >> GATE_IDS.indexOf(id) & 1;
    CHAINS.forEach((qs, w) => qs.slice(0, prog[w]).forEach(q => { done[q.id] = 1; }));
    for (let moved = true; moved;) {
      moved = false;
      CHAINS.forEach((qs, w) => {
        const q = qs[prog[w]];
        if (q && isOpen(q, done) && (q.needs || []).every(owns)) { done[q.id] = 1; prog[w]++; bal += q.pay; moved = true; }
      });
    }
    if (CHAINS.every((qs, w) => prog[w] >= qs.length)) return true;
    const key = prog.join(",") + "|" + mask + "|" + bal;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    for (let k = 0; k < GATE_IDS.length && !ok; k++) {
      const id = GATE_IDS[k];
      if (!(mask >> k & 1) && NEEDED.has(id) && onSale(id, done) && price(id) <= bal) ok = alive(prog, mask | 1 << k, bal - price(id));
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

  root.MathcraftQuests = { GATES, WORLDS, SEES, sees, TACTICS, QUESTS, BOUNTIES, SHOP, PAR_BONUS, gate, machinesFor, playMachines, par, price, isOpen, bountyOpen, numeric, onSale, missing, earned, balance, canBuy };
})(typeof window !== "undefined" ? window : globalThis);
