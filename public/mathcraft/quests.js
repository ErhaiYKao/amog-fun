/* Mathcraft quests (#33): the shop machines, the quest worlds and Amog's reference proof of each quest.
 * Needs logic.js first. Pure (page and Node).
 *
 * A quest: { id, world, name, goal, given?, takes?, pay, needs?, after?, intro, hint, proof, guide?, amog?, short? }. Finishing it adds its
 * theorem to the library as a machine (a rule if it has `given` premises); a quest may only use the shop machines
 * owned and the finished quests listed before it (machinesFor), so nothing is ever circular. `proof` is a list of
 * engine steps (see logic.js); its length is the par shown to the player, and the tests replay it, so every quest
 * is known to be provable. A quest opens when every quest in `after` is finished (default: the one before it in its
 * world), `needs` lists the shop machines its proof uses, and `guide` makes the page point at each next step
 * without being asked (the first use of a mechanic; everywhere else the hint button does it on request).
 * Amog's proof is the natural one, not always the shortest (airetho): where a trick is shorter, `short` holds it,
 * { proof, hint }; the page shows the hint as Amog's once the quest is done and the step count once the player
 * ties or beats Amog. `amog` is a spelled-out hint for Amog's own proof, also shown once the quest is done, so
 * `hint` can stay a nudge.
 * `takes` is how many arrows of an implication are hypotheses of its rule (logic.js questMachine): read the goal as
 * a theorem, "from these, that", so Chain is "P → Q, Q → R give P → R" rather than a disguised modus ponens.
 *
 * Worlds branch (Pope Amog's choice): addition is the trunk; implication opens after Zero plus zero, equality
 * (Symmetry and Transitivity as implications between equations, airetho) after Identity, logic (and, or, false,
 * true) after the third implication quest, equivalence (↔ and the laws of logic, proved by rewriting) after Or
 * commutes, quantifiers (∀, ∃ and predicates) after the Double negation ↔ and Zero on the left,
 * multiplication after Associativity, powers after Associativity of ·, each started by getting its
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
    ["any", { id: "have", name: "Lemma" }],
    ["logic", thm("dne", "Double negation", "((P->false)->false)->P")],
    ["logic", { id: "apply", name: "Apply" }],
    ["logic", { id: "byc", name: "Contradiction" }],
    ["logic", { id: "cases", name: "Cases" }],
    ["quant", { id: "fix", name: "Fix" }],
    ["quant", { id: "spec", name: "Specialise" }],
    ["quant", { id: "witness", name: "Witness" }],
    ["quant", { id: "obtain", name: "Take a witness" }],
    ["peano", thm("szero", "Zero comes first", "S(a)=0->false")],
    ["peano", thm("sinj", "Successors cancel", "S(a)=S(b)->a=b")],
    ["mul", L.machine({ id: "mul0", name: "Times zero", stmt: "a*0=0" })],
    ["mul", L.machine({ id: "mulS", name: "Times a successor", stmt: "a*S(b)=a*b+a" })],
    ["pow", L.machine({ id: "pow0", name: "Power zero", stmt: "a^0=1" })],
    ["pow", L.machine({ id: "powS", name: "Power of a successor", stmt: "a^S(b)=a^b*a" })],
  ].map(([w, m]) => ({ ...m, w }));
  const WORLDS = [["add", "Addition"], ["prop", "Implication"], ["eq", "Equality"], ["logic", "Logic"], ["iff", "Equivalence"], ["quant", "Quantifiers"], ["peano", "Successors"], ["ord", "Order"], ["mul", "Multiplication"], ["pow", "Powers"]];
  const SEES = { add: ["add", "eq"], prop: ["prop"], eq: ["eq", "prop"], logic: ["prop", "logic"], iff: ["prop", "logic", "iff", "eq"], quant: ["prop", "logic", "iff", "add", "eq", "quant"], peano: ["add", "eq", "prop", "logic", "iff", "peano"], ord: ["add", "eq", "prop", "logic", "iff", "quant", "peano", "ord"], mul: ["add", "mul", "eq"], pow: ["add", "mul", "eq", "pow"] };
  /* does a quest in `world` see things from world w? (no world = bounties and the playground: everything) */
  const sees = (world, w) => !world || w === "any" || SEES[world].includes(w);
  /* tactics open workshops instead of stating something */
  const TACTICS = ["induct", "assume", "apply", "have", "byc", "cases", "fix", "spec", "witness", "obtain"];

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
  const byc = at => ({ op: "byc", at });
  const fix = at => ({ op: "fix", at });
  const spec = (at, b, t) => ({ op: "spec", at, b, t });
  const witness = (at, t) => ({ op: "witness", at, t });
  const obtain = (at, b) => ({ op: "obtain", at, b });
  const both = (m, a, b) => [make("", m, a), make("", m, b), rule("", 0, "landi", [1])];   // each direction stamped, then And: make

  const QUESTS = [
    {
      id: "refl0", name: "Something from nothing", pay: 2, goal: "0=0", guide: true,
      intro: "Of course $0 = 0$. But here nothing counts as true until you have crafted it, and machines are all you may use. Your first machine is <b>refl</b>: anything equals itself, so it closes any goal whose two sides read the same.",
      hint: "Open refl and press <b>close the goal</b>.",
      proof: [refl("", "0")],
    },
    {
      id: "zz", name: "Zero plus zero", pay: 3, needs: ["add0"], goal: "0+0=0", guide: true,
      intro: "A new machine: <i>Adding zero</i>, an axiom. It rewrites a part of the goal: set its lever, then tap the part (or drag the machine onto it). Most equations go the same way: rewrite the goal until both sides read the same, then refl closes it.",
      hint: "Open <i>Adding zero</i>, set its lever to $a+0 \\to a$, and tap the $0+0$ in the goal. The goal becomes $0 = 0$, and refl closes it.",
      proof: [refl("", "0+0"), rw("", [1], "add0")],
    },
    /* ---- equality: Symmetry and Transitivity in the logic world's framing (airetho). They sit here in the list
       so the number worlds can use them as rules, but they open after Identity. ---- */
    {
      id: "sym", world: "eq", after: ["pid"], name: "Symmetry", pay: 2, goal: "a=b->b=a",
      intro: "Equations can be assumed too. To craft $a = b \\to b = a$, run Assume: you get a workshop that holds $a = b$, for two numbers you know nothing else about. What you hold sits on the bench as a pinned block, and a block that is an equation is a machine (its <b>use</b> button): it rewrites $a$ into $b$, or $b$ back into $a$, but only this $a$ and this $b$.",
      hint: "Assume. The assumption $a = b$ is on the bench, pinned. Press its <b>use</b> button: it is a machine now. Run it backwards ($b \\to a$) on the $b$ in the goal, and refl closes $a = a$.",
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
      intro: "Addition is defined by two axioms only, both about a number on the <i>right</i>: $a+0 = a$ and $a+S(b) = S(a+b)$. That is Peano arithmetic: every number is $0$ or a successor, and everything else has to be proved. $0+a = a$ looks the same as <i>Adding zero</i>, but it isn't: nobody has proved yet that a sum can be swapped round. A new machine does it: <b>Induction</b>. Craft the goal for $0$, then for $S(a)$ while <i>holding</i> it for $a$. What you hold there is on the bench as a pinned block, and it is a machine too, but only for this $a$.",
      hint: "Induct on $a$. Each workshop then goes like <i>Zero plus zero</i>: rewrite the left side of the goal until it reads like the right side, then refl. In the step, <i>Adding a successor</i> turns $0+S(a)$ into $S(0+a)$, and now there is a $0+a$ inside for the induction hypothesis to work on: it is the pinned block on the bench, and its <b>use</b> button makes it a machine.",
      proof: [{ op: "induct", at: "", v: "a" }, refl("b", "0+0"), rw("b", [1], "add0"), refl("s", "0+S(a)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0")],
    },
    {
      id: "sadd", name: "Successor on the left", pay: 3, goal: "S(a)+b=S(a+b)",
      intro: "The mirror image of <i>Adding a successor</i>. Two numbers now: pick the one to induct on with care.",
      hint: "Induct on $b$. Machines also run backwards: $a$ can become $a+0$, and $S(a+b)$ can become $a+S(b)$.",
      proof: [{ op: "induct", at: "", v: "b" },
        refl("b", "S(a)+0"), rw("b", [1], "add0"), rw("b", [1, 0], "add0", "rl"),
        refl("s", "S(a)+S(b)"), rw("s", [1], "addS"), rw("s", [1, 0], "h0"), rw("s", [1, 0], "addS", "rl")],
    },
    {
      id: "comm", name: "Commutativity of +", pay: 4, goal: "a+b=b+a",
      intro: "The order of a sum doesn't matter. The one everyone knows.",
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
      intro: "A new kind of block: statements, written with capital letters, joined by $\\to$ (\"implies\"). Nothing is known about $P$. To craft $P \\to Q$ there is a new machine, <b>Assume</b>: it opens a workshop where $P$ is a fact, already on the bench, and the goal is $Q$.",
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
      /* Modus ponens is Identity with P → Q in its slot (airetho): a theorem, not an axiom. Its id is the old
         shop machine's, so proofs that used the bought one replay unchanged. */
      id: "mp", world: "prop", name: "Modus ponens", pay: 2, goal: "(P->Q)->(P->Q)",
      intro: "Holding $P \\to Q$ and $P$ should give $Q$. That needs no new axiom: it is <i>Identity</i> with $P \\to Q$ in its slot. A machine that came from an implication can stamp that implication as a block, with its slots filled in as you like. Once crafted, this theorem is a rule like every implication you craft: it takes its hypotheses as blocks, uses them up, and gives what they imply. Here that is the implication first, then the block that matches its left side.",
      hint: "Open <i>Identity</i> and stamp it with $P \\to Q$ for its $P$.",
      proof: [make("", "pid", { P: "P->Q" })],
    },
    {
      id: "pchain", takes: 2, world: "prop", name: "Chain", pay: 4, guide: true, goal: "(P->Q)->((Q->R)->(P->R))",
      intro: "Implications compose: from $P$ to $Q$ and from $Q$ to $R$ makes from $P$ to $R$. <i>Modus ponens</i> does each step.",
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
      id: "lnn", world: "logic", after: ["pchain"], name: "Double negation in", pay: 2, goal: "P->((P->false)->false)",
      intro: "$\\bot$ is the statement that is simply false, and $\\lnot P$, \"not $P$\", is short for $P \\to \\bot$. So this says $P \\to \\lnot\\lnot P$. Nothing new is needed: $\\bot$ is a statement like any other.",
      hint: "Assume twice. What you hold fits Modus ponens.",
      proof: [assume(""), assume("a"), mp("aa", 1, 0)],
      short: { hint: "stamping <i>Modus ponens</i> with $\\bot$ in it and swapping its assumptions", proof: [make("", "mp", { P: "P", Q: "false" }), rule("", 0, "pswap")] },
    },
    {
      id: "lefq", world: "logic", name: "From false, anything", pay: 3, needs: ["dne"], goal: "false->P",
      intro: "The other direction, $\\lnot\\lnot P \\to P$, can't be crafted from implication alone. It is the one axiom of classical logic, and it is on your floor now: <b>Double negation</b>. First use: once you hold $\\bot$, you can craft anything.",
      hint: "Assume. <i>Weakening</i> turns $\\bot$ into $\\lnot P \\to \\bot$, which is $\\lnot\\lnot P$. Then Double negation.",
      proof: [assume(""), rule("a", 0, "pk", [], { Q: "P->false" }), rule("a", 0, "dne")],
    },
    {
      id: "lcp", takes: 1, world: "logic", name: "Contrapositive", pay: 3, goal: "(P->Q)->((Q->false)->(P->false))",
      intro: "If $P$ gives $Q$, then not $Q$ gives not $P$. Once crafted it is a rule: it turns a block $P \\to Q$ into $\\lnot Q \\to \\lnot P$.",
      hint: "Assume twice: you hold $P \\to Q$ and $\\lnot Q$, which is $Q \\to \\bot$, and the goal is $P \\to \\bot$. One of your Implication theorems joins the two.",
      proof: [assume(""), assume("a"), rule("aa", 0, "pchain", [1])],
      short: { hint: "stamping a theorem from Implication with $\\bot$ in one of its slots", proof: [make("", "pchain", { P: "P", Q: "Q", R: "false" })] },
    },
    {
      id: "le", world: "logic", name: "Or: from the left", pay: 3, goal: "P->P|Q",
      intro: "$P \\lor Q$ is short for $\\lnot P \\to Q$: if it isn't $P$, it's $Q$. A block or goal with $\\lor$ behaves like its definition wherever an implication is wanted, so Assume works on $P \\lor Q$ straight away. The other way round needs unfolding: tap a part of a block with the Scanner (or open <i>Unfold</i>) to fold or unfold a definition, for free.",
      hint: "Assume twice: you hold $P$ and $\\lnot P$. That's $\\bot$, and $\\bot$ gives anything.",
      proof: [assume(""), assume("a"), mp("aa", 1, 0), rule("aa", 0, "lefq", [], { P: "Q" })],
    },
    {
      id: "lre", world: "logic", name: "Or: from the right", pay: 2, goal: "Q->P|Q",
      intro: "The other half.",
      hint: "Assume twice: you hold $Q$, and the goal is $Q$.",
      proof: [assume(""), assume("a")],
      short: { hint: "unfolding the goal and stamping a theorem you already have", proof: [make("", "pk", { P: "Q", Q: "P->false" })] },
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
      id: "lore", world: "logic", name: "Or: by cases", pay: 5, needs: ["byc"], goal: "(P->R)->((Q->R)->(P|Q->R))",
      intro: "If $P$ gives $R$ and $Q$ gives $R$, then $P \\lor Q$ gives $R$. The longest craft in logic, and a new machine for it: <b>Contradiction</b>. Applying Double negation and then assuming $\\lnot P$ is what you did in both $\\land$ proofs. That is proof by contradiction, and the tactic does it in one step: on a goal $P$ you get a workshop that holds $\\lnot P$, with the goal $\\bot$.",
      hint: "Assume three times, then Contradiction: you hold $\\lnot R$ and the goal is $\\bot$. Keep a copy of $\\lnot R$, then work backwards: $\\lnot R$, then $Q \\to R$, then $P \\lor Q$ leave the goal $\\lnot P$.",
      proof: [assume(""), assume("a"), assume("aa"), byc("aaa"), dup("aaax", 3), applyB("aaax", 3), applyB("aaax1", 1), applyB("aaax11", 1), assume("aaax111"), mp("aaax111a", 0, 2), mp("aaax111a", 1, 0)],
    },
    {
      id: "la", world: "logic", name: "And commutes", pay: 3, needs: ["cases"], goal: "P&Q->Q&P",
      intro: "You have earned the familiar way of using $\\land$ and $\\lor$. A new machine: <b>Cases</b> takes a block apart. A block $P \\land Q$ becomes the two blocks $P$ and $Q$ (that is <i>And: left</i> and <i>And: right</i> in one move). A block $P \\lor Q$ splits the workshop in two, one where you hold $P$ and one where you hold $Q$, with the same goal in both (that is <i>Or: by cases</i>).",
      hint: "Assume, take the assumption apart with Cases, and feed $Q$ and $P$ to <i>And: make</i>, in that order.",
      proof: [assume(""), cases("a", 0), rule("a", 1, "landi", [0])],
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
      hint: "Assume twice. Take $P \\land Q$ apart, then modus ponens twice.",
      proof: [assume(""), assume("a"), cases("aa", 1), mp("aa", 0, 1), mp("aa", 0, 1)],
    },
    {
      id: "lo", world: "logic", name: "Or commutes", pay: 4, goal: "P|Q->Q|P",
      intro: "The first craft by cases: whichever of $P$ and $Q$ you hold, you can make $Q \\lor P$.",
      hint: "Assume, then Cases on $P \\lor Q$. In each workshop one of the two <i>Or</i> machines finishes; it has to be told the other side.",
      proof: [assume(""), cases("a", 0), rule("ap", 0, "lre", [], { P: "Q" }), rule("aq", 0, "le", [], { Q: "P" })],
    },
    {
      id: "lt", world: "logic", name: "True can be dropped", pay: 2, goal: "(true->P)->P",
      intro: "$\\top$, the statement that is simply true, is short for $\\bot \\to \\bot$.",
      hint: "Assume. Make $\\top$: it is <i>Identity</i> stamped with $\\bot$, folded with <i>Unfold</i>. Then modus ponens.",
      proof: [assume(""), make("a", "pid", { P: "false" }), { op: "unfold", at: "a", b: 1, path: [], as: "⊤" }, mp("a", 0, 1)],
    },
    {
      id: "lk", takes: 1, world: "logic", name: "Modus tollens", pay: 4, goal: "(P->Q)&(Q->false)->(P->false)",
      intro: "If $P$ implies $Q$ and $Q$ is false, then $P$ is false.",
      hint: "Assume and take the $\\land$ apart. The goal $\\lnot P$ is an implication too: assume $P$, then modus ponens twice.",
      proof: [assume(""), cases("a", 0), assume("a"), mp("aa", 0, 2), mp("aa", 1, 0)],
      short: { hint: "stamping <i>Chain</i> and working backwards with <i>Uncurrying</i>", proof: [make("", "pchain", { P: "P", Q: "Q", R: "false" }), applyR("", "lu")] },
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
      hint: "Assume, then Contradiction: you hold $\\lnot P$ and the goal is $\\bot$. Keep a copy of $\\lnot P$. Apply $\\lnot P$, then the assumption: the goal becomes $P \\to Q$.",
      proof: [assume(""), byc("a"), dup("ax", 1), applyB("ax", 1), applyB("ax1", 0), assume("ax11"), mp("ax11a", 0, 1), rule("ax11a", 0, "lefq", [], { P: "Q" })],
    },

    /* ---- equivalence (airetho): A ↔ B is (A → B) ∧ (B → A), and a proved ↔ rewrites statements the way an equation
       rewrites numbers. The laws of logic, most of them crafted by rewriting instead of by assuming. ---- */
    {
      id: "ir", world: "iff", after: ["lo"], name: "If and only if", pay: 2, goal: "P<->P", guide: true,
      intro: "$P \\leftrightarrow Q$, \"$P$ if and only if $Q$\", is short for $(P \\to Q) \\land (Q \\to P)$: each gives the other. The $\\land$ machines see through it, so a $\\leftrightarrow$ is crafted like an $\\land$: one workshop for each direction. Once crafted, a $\\leftrightarrow$ is a machine with a lever, like an equation: it rewrites any part of a block that reads like one side into the other. This first one, $P \\leftrightarrow P$, is the refl of statements: stamp it with any statement to start from.",
      hint: "Each direction is $P \\to P$, and you have a theorem that says exactly that. A block made before a workshop splits comes along into every part.",
      proof: [make("", "pid", { P: "P" }), applyR("", "landi")],
    },
    {
      id: "idn", world: "iff", name: "Double negation", pay: 2, goal: "not not P<->P",
      intro: "Double negation as a machine with a lever: it adds or removes $\\lnot\\lnot$ anywhere inside a block.",
      hint: "You have each direction already, as two separate machines: stamp each and join them.",
      amog: "Each direction is a machine you already have. Stamping them is shorter than any workshop.",
      proof: both("dne", { P: "P" }, { P: "P" }).map((st, k) => (k === 1 ? { ...st, m: "lnn" } : st)),
    },
    {
      id: "idm", world: "iff", name: "De Morgan: not or", pay: 3, goal: "not (P|Q)<->not P&not Q",
      intro: "Now the new way of crafting: start from a block that says a statement is equivalent to itself, then rewrite one side until it is the goal. Unfolding is free, so the only real step is one rewrite.",
      hint: "Start from a block that says $\\lnot(P \\lor Q)$ is equivalent to itself, and try unfolding the and/or statements. Written out, how do the two sides of the goal differ?",
      amog: "Start from a block that says one side is equivalent to itself, and change only that side. Unfolded, the two sides differ by a single double negation.",
      proof: [make("", "ir", { P: "not (P|Q)" }), unf("", [1, 0]), rw("", [1, 0, 1], "idn", "rl")],
    },
    {
      id: "idm2", world: "iff", name: "De Morgan: not and", pay: 3, goal: "not (P&Q)<->not P|not Q",
      intro: "The other De Morgan law, the same way.",
      hint: "The same idea as the first De Morgan law: unfold the $\\land$ and compare with the $\\lor$ written out.",
      amog: "As for the first De Morgan law. Unfolded, the two sides differ only in where one double negation sits: take it away in one place and put it in another.",
      proof: [make("", "ir", { P: "not (P&Q)" }), unf("", [1, 0]), rw("", [1], "idn"), rw("", [1, 0], "idn", "rl")],
    },
    {
      id: "iac", world: "iff", name: "And commutes", pay: 2, goal: "P&Q<->Q&P",
      intro: "<i>And commutes</i> is an implication, so it only works on a whole block. As a $\\leftrightarrow$ it swaps an $\\land$ anywhere inside one.",
      hint: "Each direction is a theorem you have, with the letters the other way round.",
      amog: "No workshop is needed: each direction can be stamped.",
      proof: both("la", { P: "P", Q: "Q" }, { P: "Q", Q: "P" }),
    },
    {
      id: "ioc", world: "iff", name: "Or commutes", pay: 2, goal: "P|Q<->Q|P",
      intro: "And the same for $\\lor$.",
      hint: "As for $\\land$.",
      amog: "No workshop is needed: each direction can be stamped.",
      proof: both("lo", { P: "P", Q: "Q" }, { P: "Q", Q: "P" }),
    },
    {
      id: "isym", world: "iff", name: "Symmetry", pay: 2, goal: "a=b<->b=a",
      intro: "Equations are statements too, so a $\\leftrightarrow$ can be about them. <i>Symmetry</i> turns a whole block round; this one turns an equation round anywhere inside a block.",
      hint: "Each direction is a theorem from Equality.",
      proof: [...both("sym", { a: "a", b: "b" }, { a: "b", b: "a" })],
    },
    {
      id: "icur", world: "iff", name: "Currying", pay: 2, goal: "(P&Q->R)<->(P->(Q->R))",
      intro: "The machine that moves an $\\land$ in and out of an implication.",
      hint: "Two theorems you have are the two directions.",
      amog: "Two theorems you have are the two directions. No workshop is needed.",
      proof: both("lc", { P: "P", Q: "Q", R: "R" }, { P: "P", Q: "Q", R: "R" }).map((st, k) => (k === 1 ? { ...st, m: "lu" } : st)),
    },
    {
      id: "iaa", world: "iff", name: "And associates", pay: 4, goal: "(P&Q)&R<->P&(Q&R)",
      intro: "Brackets in a chain of $\\land$ don't matter.",
      hint: "Apply <i>And: make</i> for the two directions and Assume in each. Cases twice gives you $P$, $Q$ and $R$ as three blocks; <i>And: make</i> twice builds the other bracketing.",
      proof: [applyR("", "landi"),
        assume("1"), cases("1a", 0), cases("1a", 0), rule("1a", 1, "landi", [2]), rule("1a", 0, "landi", [1]),
        assume("2"), cases("2a", 0), cases("2a", 1), rule("2a", 0, "landi", [1]), rule("2a", 0, "landi", [1])],
      short: { hint: "unfolding the outer $\\land$ on one side and currying inside it", proof: [make("", "ir", { P: "(P&Q)&R" }), unf("", [1]), rw("", [1, 0], "icur"), rw("", [1, 0, 1], "icur", "rl")] },
    },
    {
      id: "ioa", world: "iff", name: "Or associates", pay: 4, goal: "(P|Q)|R<->P|(Q|R)",
      intro: "The same for $\\lor$, and shorter than it looks.",
      hint: "Stamp <i>If and only if</i> and unfold the outer $\\lor$ on one side. Unfolded, the two sides are a De Morgan law and a currying apart.",
      amog: "Unfold only the outer $\\lor$ on one side and leave the inner one folded. Two machines you have each do one step from there.",
      proof: [make("", "ir", { P: "(P|Q)|R" }), unf("", [1]), rw("", [1, 0], "idm"), rw("", [1], "icur")],
    },
    {
      id: "iof", world: "iff", name: "Or with false", pay: 2, goal: "P|false<->P",
      intro: "The simplification laws: $\\bot$ does nothing to an $\\lor$.",
      hint: "Unfold $P \\lor \\bot$ in your head. What is it short for?",
      amog: "After unfolding, find a way to stamp the conclusion.",
      proof: [make("", "idn", { P: "P" })],
    },
    {
      id: "iat", world: "iff", name: "And with true", pay: 3, goal: "P&true<->P",
      intro: "And $\\top$ does nothing to an $\\land$.",
      hint: "Unfold $P \\land \\top$ all the way, the $\\top$ too. What is $\\lnot\\top$ short for?",
      amog: "Written out, the goal is one double negation away from a theorem you can stamp.",
      proof: [make("", "idn", { P: "P" }), rw("", [0, 0, 1], "idn", "rl")],
    },
    {
      id: "idist", world: "iff", name: "Distributivity", pay: 6, goal: "P&(Q|R)<->(P&Q)|(P&R)",
      intro: "The law that ties $\\land$ to $\\lor$, and the longest craft in logic.",
      hint: "Apply <i>And: make</i> for the two directions and Assume in each. Left to right: take $P \\land (Q \\lor R)$ apart, then the $\\lor$; in each case make the $\\land$ you can and put it into an $\\lor$ with <i>Or: from the left</i> or <i>from the right</i>. Right to left: take the $\\lor$ apart first, then the $\\land$ in each case.",
      proof: [applyR("", "landi"),
        assume("1"), cases("1a", 0), cases("1a", 1),
        rule("1ap", 0, "landi", [1]), rule("1ap", 0, "le", [], { Q: "P&R" }),
        rule("1aq", 0, "landi", [1]), rule("1aq", 0, "lre", [], { P: "P&Q" }),
        assume("2"), cases("2a", 0),
        cases("2ap", 0), rule("2ap", 1, "le", [], { Q: "R" }), rule("2ap", 0, "landi", [1]),
        cases("2aq", 0), rule("2aq", 1, "lre", [], { P: "Q" }), rule("2aq", 0, "landi", [1])],
    },

    /* ---- quantifiers (airetho): ∀ and ∃ over numbers, and predicates P(a). ∃a. A is short for ¬∀a. ¬A. Four tactics:
       Fix and Specialise for ∀, Witness and Take a witness for ∃. ---- */
    {
      id: "qa", world: "quant", after: ["idn", "zadd"], name: "For every number", pay: 3, needs: ["fix"], goal: "forall a. a+0=a", guide: true,
      intro: "$\\forall a$ reads \"for every number $a$\". Every theorem about numbers so far was secretly for every $a$; now the block says so, and the $a$ belongs to the $\\forall$: nothing outside it is called $a$. To craft a $\\forall$ there is a new machine, <b>Fix</b>. It opens a workshop about one number, fixed but arbitrary: nothing is known about it, so whatever you craft for it holds for all of them.",
      hint: "Run Fix. In the workshop the goal is $a+0 = a$ about one number $a$, and you have had a machine for that since quest 1.",
      proof: [fix(""), refl("f", "a+0"), rw("f", [1], "add0")],
    },
    {
      id: "qs", world: "quant", name: "A right identity is zero", pay: 3, needs: ["spec"], goal: "(forall a. a+b=a)->b=0", guide: true,
      intro: "The other direction: using a $\\forall$ you hold. <b>Specialise</b> turns a block $\\forall a.\\ \\ldots$ into the same statement about one number of your choice. Here $b$ leaves every number alone when added to it; which number should you ask it about?",
      hint: "Assume. Specialise the assumption to $0$: it says $0+b = 0$, and <i>Zero on the left</i> turns $0+b$ into $b$.",
      proof: [assume(""), spec("a", 0, "0"), rw("a", [0], "zadd")],
    },
    {
      id: "qsw", world: "quant", name: "The order of ∀", pay: 4, goal: "(forall a. forall b. R(a,b))->forall b. forall a. R(a,b)",
      intro: "$R(a, b)$ is a predicate: some statement about $a$ and $b$, you are not told which. Like $P$ and $Q$ in Implication it stands for anything, and what you craft with it becomes a machine for every statement of that shape.",
      hint: "Assume, then Fix twice: the goal is $R(a, b)$ for two fixed numbers. Specialise the assumption to $a$, then to $b$.",
      proof: [assume(""), fix("a"), fix("af"), spec("aff", 0, "a"), spec("aff", 0, "b")],
    },
    {
      id: "qand", world: "quant", name: "∀ and ∧", pay: 4, goal: "(forall a. P(a)&Q(a))->(forall a. P(a))&(forall a. Q(a))",
      intro: "A $\\forall$ over an $\\land$ splits in two. Everything from Logic works on quantified blocks: they are statements like any other.",
      hint: "Assume, then Apply <i>And: make</i> for the two halves. In each: Fix, Specialise the assumption to the fixed number, and take the $\\land$ apart with Cases.",
      proof: [assume(""), applyR("a", "landi"), fix("a1"), spec("a1f", 0, "a"), cases("a1f", 0), fix("a2"), spec("a2f", 0, "a"), cases("a2f", 0)],
    },
    {
      id: "qex", world: "quant", name: "There is one", pay: 4, goal: "exists a. a+a=a",
      intro: "$\\exists a$ reads \"there is a number $a$\". It is a definition, just as $\\lor$ is. $\\exists a.\\ A$ is short for $\\lnot \\forall a.\\ \\lnot A$, \"not every number fails\". So Assume works on it: you hold that every number fails, and the goal is $\\bot$. Find one that doesn't.",
      hint: "Assume. Specialise what you hold to $0$: it says $\\lnot(0+0 = 0)$. Craft $0+0 = 0$ and feed both to modus ponens.",
      proof: [assume(""), spec("a", 0, "0"), refl("a", "0+0"), { ...rw("a", [1], "add0"), b: 1 }, mp("a", 0, 1)],
    },
    {
      id: "qw", world: "quant", name: "Every number has a next one", pay: 3, needs: ["witness"], goal: "forall a. exists b. b=S(a)",
      intro: "That was the long way. A new machine: <b>Witness</b>. On a goal $\\exists b.\\ \\ldots$ you name the number, and the goal becomes the statement about it.",
      hint: "Fix, then give $S(a)$ as the witness. What is left is refl.",
      proof: [fix(""), witness("f", "S(a)"), refl("fw", "S(a)")],
    },
    {
      id: "qzs", world: "quant", name: "Zero or a successor", pay: 5, goal: "forall a. a=0|exists b. a=S(b)",
      intro: "Every number is $0$ or comes after another. Induction works inside a Fix: the fixed number is arbitrary, so it can be the one to induct on.",
      hint: "Fix, then induct on $a$ (oddly, the step never needs its hypothesis). Base: $0 = 0$, put into an $\\lor$ from the left. Step: Apply <i>Or: from the right</i> to the goal, so that what is left is $\\exists b.\\ S(a) = S(b)$, and give $a$ as the witness.",
      proof: [fix(""), { op: "induct", at: "f", v: "a" }, refl("fb", "0"), rule("fb", 0, "le", [], { Q: "exists b. 0=S(b)" }), applyR("fs", "lre"), witness("fs1", "a"), refl("fs1w", "S(a)")],
    },
    {
      id: "qo", world: "quant", name: "Whoever it is", pay: 4, needs: ["obtain"], goal: "(exists a. P(a))->exists a. P(a)|Q(a)",
      intro: "Using an $\\exists$ you hold: you know some number does it, but not which. A new machine: <b>Take a witness</b> gives that number a name. You get a workshop that holds the statement about it, and nothing else is known about that number.",
      hint: "Assume, take a witness from the assumption, and give the same number as the witness for the goal. <i>Or: from the left</i> finishes.",
      proof: [assume(""), obtain("a", 0), witness("ao", "a"), rule("aow", 0, "le", [], { Q: "Q(a)" })],
    },
    {
      id: "qdm", world: "quant", name: "Not all", pay: 4, goal: "not (forall a. P(a))<->exists a. not P(a)",
      intro: "De Morgan for quantifiers: \"not all are $P$\" is \"one is not $P$\". Equivalences rewrite inside a $\\forall$ too.",
      hint: "Write out $\\exists a.\\ \\lnot P(a)$ with its definition and compare it with the left side. They differ by a double negation.",
      amog: "Stamp <i>If and only if</i> and change one side. Unfolded, $\\exists$ and $\\lnot\\forall$ differ by one double negation under the $\\forall$.",
      proof: [make("", "ir", { P: "not forall a. P(a)" }), rw("", [1, 0, 0], "idn", "rl")],
    },
    {
      id: "qen", world: "quant", name: "None", pay: 3, goal: "not (exists a. P(a))<->forall a. not P(a)",
      intro: "And the other one: \"there is no $P$\" is \"every one is not $P$\".",
      hint: "Written out, $\\lnot \\exists a.\\ P(a)$ is $\\lnot\\lnot \\forall a.\\ \\lnot P(a)$. You have a machine that says exactly this.",
      proof: [make("", "idn", { P: "forall a. not P(a)" })],
    },

    /* ---- successors (airetho): the two Peano axioms that tell numbers apart. Nothing before them can craft 0 ≠ 1. ---- */
    {
      id: "sn10", world: "peano", after: ["lefq", "zadd"], name: "One is not zero", pay: 2, needs: ["szero"], goal: "1=0->false", guide: true,
      intro: "Everything so far would still hold if every number were $0$. Two axioms rule that out. The first: <b>Zero comes first</b>, nothing comes before $0$, so a block $S(a) = 0$ gives $\\bot$. Remember that $1$ is short for $S(0)$.",
      hint: "Assume, and feed what you hold to the new machine.",
      proof: [assume(""), rule("a", 0, "szero")],
      short: { hint: "stamping the axiom", proof: [make("", "szero", { a: "0" })] },
    },
    {
      id: "sn01", world: "peano", name: "Zero is not one", pay: 2, goal: "0=1->false",
      intro: "The same the other way round.",
      hint: "Zero comes first wants the successor on the left: turn the equation round first.",
      proof: [assume(""), rule("a", 0, "sym"), rule("a", 0, "szero")],
      short: { hint: "stamping the axiom and turning the equation inside round with <i>Symmetry</i>", proof: [make("", "szero", { a: "0" }), rw("", [0], "isym")] },
    },
    {
      id: "sn21", world: "peano", name: "Two is not one", pay: 3, needs: ["sinj"], goal: "2=1->false",
      intro: "The second axiom: <b>Successors cancel</b>. If $S(a) = S(b)$ then $a = b$, so different numbers have different successors.",
      hint: "$2 = 1$ is $S(1) = S(0)$: cancel, and you are back at a quest you have done.",
      proof: [assume(""), rule("a", 0, "sinj"), rule("a", 0, "szero")],
    },
    {
      id: "snself", world: "peano", name: "Never its own successor", pay: 4, goal: "S(a)=a->false",
      intro: "No number comes right after itself. Induction works on a goal that is a $\\lnot$: it is an implication like any other.",
      hint: "Induct on $a$. The base is the last quest again. In the step, cancel what you assumed and feed it to the induction hypothesis.",
      proof: [induct("a"), assume("b"), rule("ba", 0, "szero"), assume("s"), rule("sa", 0, "sinj"), hyp("sa", 0), mp("sa", 1, 0)],
      short: { hint: "stamping everything and chaining, with no Assume at all", proof: [induct("a"), make("b", "szero", { a: "0" }), hyp("s", 0), make("s", "sinj", { a: "S(a)", b: "a" }), rule("s", 1, "pchain", [0])] },
    },
    {
      id: "scancel", world: "peano", name: "Adding cancels", pay: 5, goal: "a+c=b+c->a=b",
      intro: "Cancelling a term from both sides is the first thing anyone does with an equation. A word on induction: if the workshop holds something about the letter you induct on, that fact goes back into the goal first (holding $a + c = b + c$, inducting on $c$ proves $a + c = b + c \\to a = b$), since it is only about one $c$.",
      hint: "Induct on $c$. In the step, peel the $S$ off both sides of what you assume, cancel, then the induction hypothesis.",
      proof: [induct("c"), assume("b"), rw("ba", [0], "add0"), rw("ba", [1], "add0"),
        assume("s"), rw("sa", [0], "addS"), rw("sa", [1], "addS"), rule("sa", 0, "sinj"), hyp("sa", 0), mp("sa", 1, 0)],
    },
    {
      id: "szsum", world: "peano", name: "Nothing adds up to zero", pay: 4, goal: "a+b=0->b=0",
      intro: "If a sum is $0$, so is what was added.",
      hint: "Induct on $b$. In the step, what you assume says a successor is $0$. That can't happen, and $\\bot$ gives anything.",
      proof: [induct("b"), assume("b"), refl("ba", "0"), assume("s"), rw("sa", [0], "addS"), rule("sa", 0, "szero"), rule("sa", 0, "lefq", [], { P: "S(b)=0" })],
    },

    /* ---- order (#33): a ≤ b is a definition, ∃c. a + c = b. Witness and Take a witness read it as that ∃. The
       world leans on everything before it: quantifiers, both Peano axioms, Adding cancels. ---- */
    {
      id: "ole", world: "ord", after: ["qo", "szsum"], name: "No bigger than itself", pay: 3, goal: "a<=a", guide: true,
      intro: "A new sign, and no new axiom. $a \\le b$ is a definition: it is short for $\\exists c.\\ a + c = b$, \"something added to $a$ gives $b$\". Unfold shows it written out, but you rarely need to: <b>Witness</b> and <b>Take a witness</b> read a $\\le$ as its $\\exists$. So to craft $a \\le b$, name the number that fills the gap.",
      hint: "What do you add to $a$ to get $a$? Give it as the witness; what is left is an equation from quest 1.",
      proof: [witness("", "0"), refl("w", "a+0"), rw("w", [1], "add0")],
    },
    {
      id: "ozero", world: "ord", name: "Zero is the least", pay: 3, goal: "0<=a",
      intro: "Nothing is below $0$.",
      hint: "The gap between $0$ and $a$ is $a$ itself. <i>Zero on the left</i> does the rest.",
      proof: [witness("", "a"), refl("w", "0+a"), rw("w", [1], "zadd")],
    },
    {
      id: "osucc", world: "ord", name: "The next one is no smaller", pay: 3, goal: "a<=S(a)",
      intro: "Every number is at most its successor.",
      hint: "The gap is $S(0)$. Then $a + S(0)$ becomes $S(a+0)$, and that becomes $S(a)$.",
      proof: [witness("", "S(0)"), refl("w", "a+S(0)"), rw("w", [1], "addS"), rw("w", [1, 0], "add0")],
    },
    {
      id: "otrans", world: "ord", name: "≤ is transitive", pay: 5, goal: "a<=b->(b<=c->a<=c)",
      intro: "Using a $\\le$ you hold: <b>Take a witness</b> gives the gap a name. Here there are two gaps, and the one from $a$ to $c$ is made of both.",
      hint: "Assume twice, and take a witness from each: you hold $a + d = b$ and $b + e = c$. Give $d + e$ as the witness. Then put $a + d$ for the $b$ in $b + e = c$ and move the brackets.",
      proof: [assume(""), assume("a"), obtain("aa", 0), obtain("aao", 0), witness("aaoo", "d+e"),
        { ...rw("aaoow", [0, 0], "h2", "rl"), b: 1 }, { ...rw("aaoow", [0], "assoc"), b: 1 }],
    },
    {
      id: "oadd", world: "ord", name: "Adding keeps the order", pay: 5, goal: "a<=b->a+c<=b+c",
      intro: "Add the same number to both sides and the order stays.",
      hint: "Assume and take a witness: $a + d = b$. The same $d$ is the gap between $a + c$ and $b + c$. Shuffle the goal's $(a+c)+d$ into $(a+d)+c$: brackets, swap, brackets back.",
      proof: [assume(""), obtain("a", 0), witness("ao", "d"), refl("aow", "(a+c)+d"),
        { ...rw("aow", [1], "assoc"), b: 1 }, { ...rw("aow", [1, 1], "comm"), b: 1 }, { ...rw("aow", [1], "assoc", "rl"), b: 1 }, { ...rw("aow", [1, 0], "h1"), b: 1 }],
      short: { hint: "a careful stamp of <i>Associativity of +</i> in place of refl", proof: [assume(""), obtain("a", 0), witness("ao", "d"), make("aow", "assoc", { a: "a", b: "c", c: "d" }),
        { ...rw("aow", [1, 1], "comm"), b: 1 }, { ...rw("aow", [1], "assoc", "rl"), b: 1 }, { ...rw("aow", [1, 0], "h1"), b: 1 }] },
    },
    {
      id: "oz", world: "ord", name: "Only zero is below zero", pay: 4, goal: "a<=0->a=0",
      intro: "If $a \\le 0$ then $a$ is $0$. This is where the Successors world pays off: it is false in a world where numbers wrap around.",
      hint: "Assume and take a witness: $a + c = 0$. <i>Nothing adds up to zero</i> tells you about the number on the right of the $+$, so swap the sum round first.",
      proof: [assume(""), obtain("a", 0), rw("ao", [0], "comm"), rule("ao", 0, "szsum")],
    },
    {
      id: "onil", world: "ord", name: "Adding nothing", pay: 4, goal: "a+b=a->b=0",
      intro: "A detour without a $\\le$ in it, needed for the next quest: if adding $b$ changes nothing, $b$ is $0$.",
      hint: "Assume. Write the lone $a$ on the right as $a + 0$, swap both sums round, and <i>Adding cancels</i> takes the $a$ off both sides.",
      proof: [assume(""), rw("a", [1], "add0", "rl"), rw("a", [0], "comm"), rw("a", [1], "comm"), rule("a", 0, "scancel")],
      short: { hint: "writing the lone $a$ as $0 + a$ straight away, so that only one sum has to be swapped round", proof: [assume(""), rw("a", [1], "zadd", "rl"), rw("a", [0], "comm"), rule("a", 0, "scancel")] },
    },
    {
      id: "oanti", world: "ord", name: "Squeezed", pay: 6, goal: "a<=b->(b<=a->a=b)", pin: true,
      intro: "If $a \\le b$ and $b \\le a$ then $a = b$: the two gaps add up to nothing, so each is nothing. A block that is an equation works like a machine too: open it with its <b>use</b> button and it rewrites other blocks.",
      hint: "Assume twice and take both witnesses: $a + c = b$ and $b + d = a$. Put $a + c$ for the $b$ in $b + d = a$: now $a + (c + d) = a$, so <i>Adding nothing</i> gives $c + d = 0$, and after a swap <i>Nothing adds up to zero</i> gives $c = 0$. Use that block on $a + c = b$.",
      proof: [assume(""), assume("a"), obtain("aa", 0), obtain("aao", 1),
        { ...rw("aaoo", [0, 0], "b2", "rl"), b: 3 }, { ...rw("aaoo", [0], "assoc"), b: 4 }, rule("aaoo", 4, "onil"), { ...rw("aaoo", [0], "comm"), b: 4 }, rule("aaoo", 4, "szsum"),
        { ...rw("aaoo", [0, 1], "b4"), b: 2 }, { ...rw("aaoo", [0], "add0"), b: 3 }],
    },
    {
      id: "ostep", world: "ord", name: "Equal or a step below", pay: 6, goal: "a<=b->a=b|S(a)<=b",
      intro: "If $a \\le b$, then either $a$ is $b$ or even $S(a) \\le b$. It depends on the gap: it is $0$, or it comes after some number.",
      hint: "Assume and take a witness: $a + c = b$. Stamp <i>Zero or a successor</i>, specialise it to $c$ and take the $\\lor$ apart with Cases. If $c = 0$ you get $a = b$. If $c = S(d)$, the gap from $S(a)$ to $b$ is $d$.",
      proof: [assume(""), obtain("a", 0), make("ao", "qzs", {}), spec("ao", 1, "c"), cases("ao", 1),
        rw("aop", [0, 1], "h2"), rw("aop", [0], "add0"), rule("aop", 0, "le", [], { Q: "S(a)<=b" }),
        obtain("aoq", 1), applyR("aoqo", "lre"), witness("aoqo1", "d"), rw("aoqo1w", [0, 1], "h3"), rw("aoqo1w", [0], "addS"), rw("aoqo1w", [0], "sadd", "rl")],
    },
    {
      id: "ototal", world: "ord", name: "One way or the other", pay: 8, goal: "a<=b|b<=a",
      intro: "Any two numbers can be compared. The first induction of this world, and the reason for the last quest.",
      hint: "Induct on $a$. Base: $0 \\le b$. In the step, put the induction hypothesis on the bench and take it apart with Cases. If $b \\le a$, then $b \\le S(a)$ by transitivity. If $a \\le b$, <i>Equal or a step below</i> gives two more cases: $a = b$, so $b \\le S(a)$; or $S(a) \\le b$, which is the goal's left side.",
      proof: [induct("a"), make("b", "ozero", { a: "b" }), rule("b", 0, "le", [], { Q: "b<=0" }),
        hyp("s", 0), cases("s", 0),
        rule("sp", 0, "ostep"), cases("sp", 0),
        make("spp", "osucc", { a: "a" }), { ...rw("spp", [0], "h2"), b: 1 }, rule("spp", 1, "lre", [], { P: "S(a)<=b" }),
        rule("spq", 0, "le", [], { Q: "b<=S(a)" }),
        make("sq", "osucc", { a: "a" }), rule("sq", 0, "otrans", [1]), rule("sq", 0, "lre", [], { P: "S(a)<=b" })],
    },

    /* ---- multiplication: two more axioms, on top of all of addition ---- */
    {
      id: "mz", world: "mul", after: ["assoc"], name: "Zero times", pay: 3, needs: ["mul0", "mulS"], goal: "0*a=0",
      intro: "Multiplication is two more axioms: $a \\cdot 0 = 0$ and $a \\cdot S(b) = a \\cdot b + a$. As with addition, the zero on the left needs induction.",
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
      hint: "Induct on $c$. In the base case it is easier to work on the right-hand side of the goal.",
      proof: [induct("c"),
        refl("b", "a*b+a*0"), rw("b", [0, 1], "mul0"), rw("b", [0], "add0"), rw("b", [0, 1], "add0", "rl"),
        refl("s", "a*(b+S(c))"), rw("s", [1, 1], "addS"), rw("s", [1], "mulS"), rw("s", [1, 0], "h0"), rw("s", [1], "assoc"), rw("s", [1, 1], "mulS", "rl")],
    },
    {
      id: "mcomm", world: "mul", name: "Commutativity of ·", pay: 4, goal: "a*b=b*a",
      intro: "The order of a product doesn't matter either.",
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
      intro: "Two more axioms: $a^0 = 1$ and $a^{S(b)} = a^b \\cdot a$. Type a power as a^b.",
      hint: "$a^{S(0)}$ is $a^0 \\cdot a$, which is $S(0) \\cdot a$. Swap it round and <i>Times one</i> finishes.",
      proof: [refl("", "a^1"), rw("", [1], "powS"), rw("", [1, 0], "pow0"), rw("", [1], "mcomm"), rw("", [1], "t1")],
    },
    {
      id: "p1", world: "pow", name: "One to any power", pay: 3, goal: "1^a=1",
      intro: "One times itself, any number of times, is still one.",
      hint: "Induct on $a$, the exponent. In the step, $S(0)^{S(a)}$ is $S(0)^a \\cdot S(0)$: <i>Times one</i>, then the induction hypothesis.",
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

  /* Stamping (the Block press) turns refl t followed by one rewrite of the right side into one step, which beats
     the par of most arithmetic quests by a step or two (airetho). Amog's proofs stay the natural ones and these are
     the best known: [the workshop of the refl, the slots of the machine the rewrite right after it uses]. */
  const PRESSED = {
    zz: [["", { a: "0" }]],
    zadd: [["b", { a: "0" }], ["s", { a: "0", b: "a" }]],
    sadd: [["b", { a: "S(a)" }], ["s", { a: "S(a)", b: "b" }]],
    comm: [["b", { a: "a" }], ["s", { a: "a", b: "b" }]],
    assoc: [["b", { a: "a+b" }], ["s", { a: "a+b", b: "c" }]],
    qa: [["f", { a: "a" }]],
    qex: [["a", { a: "0" }]],
    ole: [["w", { a: "a" }]],
    ozero: [["w", { a: "a" }]],
    mz: [["b", { a: "0" }], ["s", { a: "0", b: "a" }]],
    ms: [["b", { a: "S(a)" }], ["s", { a: "S(a)", b: "b" }]],
    mcomm: [["b", { a: "a" }], ["s", { a: "a", b: "b" }]],
    massoc: [["b", { a: "a*b" }], ["s", { a: "a*b", b: "c" }]],
    p1: [["b", { a: "1" }], ["s", { a: "1", b: "a" }]],
    ppow: [["b", { a: "a^b" }], ["s", { a: "a^b", b: "c" }]],
  };
  for (const q of QUESTS) {
    const at = PRESSED[q.id];
    if (!at || q.short) continue;
    const proof = q.proof.slice();
    for (const [w, fill] of at) {
      const k = proof.findIndex((st, i) => st.op === "refl" && st.at === w && proof[i + 1] && proof[i + 1].op === "rw" && proof[i + 1].at === w);
      proof.splice(k, 2, make(w, proof[k + 1].m, fill));
    }
    q.short = { hint: "stamping with the Block press", proof };
  }

  /* First hints (airetho, #33): a nudge that says where to look, not what to tap. The written `hint` is the second
     one ("more"), and "what do I do next?" the third. A quest without an entry here has a hint that is a nudge already. */
  const NUDGE = {
    zz: "Change the goal until both of its sides read the same.",
    sym: "An equation on your bench is a machine. What could it rewrite?",
    trans: "You hold two equations. One of them can rewrite the other.",
    zadd: "No machine fits while $a$ could be any number. Which machine is for that?",
    sadd: "There are two letters to induct on, and only one of them works. Machines also run backwards.",
    comm: "Induction, and the two theorems you have just crafted.",
    assoc: "Induct on the letter the axioms can reach: the one on the far right.",
    pk: "An implication inside an implication: assume more than once.",
    pchain: "Assume everything you can, then walk from $P$ to $R$.",
    pswap: "Assume until the goal is $R$. You then hold all you need.",
    pdist: "Assume until the goal is $R$. One of the things you hold is needed twice.",
    lnn: "Remember what $\\lnot$ is short for. The goal is two implications deep.",
    lefq: "You need $P$ from nothing useful. The only way to conjure a statement is the new axiom, so aim for $\\lnot\\lnot P$.",
    lcp: "Assume twice and look at what you hold: it is two links of a chain.",
    le: "Unfold the $\\lor$ in your head. After assuming, what you hold contradicts itself.",
    lre: "Unfold the $\\lor$ in your head. Is there anything left to do after assuming?",
    landi: "Unfold the $\\land$ in your head: it is a $\\lnot$, so assume once more than you expect.",
    landl: "There is no direct way out of an $\\land$ yet. Work backwards from the goal instead.",
    landr: "The same route as the last quest, for the other side.",
    lore: "Suppose $R$ were false, and work backwards from the contradiction.",
    la: "Take the $\\land$ apart and put it together the other way.",
    lc: "Assume until the goal is $R$, then build what the first assumption wants.",
    lu: "Assume until the goal is $R$, then take apart what you hold.",
    lo: "An $\\lor$ you hold splits the work in two.",
    lt: "You need a block that says $\\top$. What is $\\top$ short for?",
    lk: "Take the $\\land$ apart. The goal is an implication in disguise.",
    lpeirce: "Suppose $P$ were false. Then what you hold lets you ask for something much easier.",
    idn: "A $\\leftrightarrow$ is two implications. You have both.",
    iac: "A $\\leftrightarrow$ is two implications, and one theorem gives you both.",
    isym: "A $\\leftrightarrow$ is two implications, and one theorem gives you both.",
    icur: "A $\\leftrightarrow$ is two implications. You have crafted both.",
    iaa: "Prove each direction by taking everything apart and rebuilding it.",
    ioa: "Start from a block that is equivalent to itself and change one side. Unfolding shows what the two sides share.",
    idist: "Prove each direction separately. Wherever you hold an $\\lor$, split into cases.",
    qa: "The goal starts with $\\forall$. There is a new machine for exactly that.",
    qs: "A $\\forall$ you hold can be asked about any number. Which number makes the $a$ disappear?",
    qsw: "Fix what the goal quantifies over, then ask the assumption about those same numbers.",
    qand: "Prove the two halves separately. In each, fix a number and ask the assumption about it.",
    qex: "Remember what $\\exists$ is short for, and find one number that works.",
    qw: "Which number comes after $a$? Name it.",
    qzs: "Fix, then induct. In each case, decide which side of the $\\lor$ is the true one.",
    qo: "The number that does it for the assumption does it for the goal.",
    qdm: "Write both sides out with their definitions. How do they differ?",
    sn10: "What is $1$ short for?",
    sn01: "The axiom wants the successor on the other side.",
    sn21: "Write the numerals out. One layer of $S$ can go.",
    snself: "Induction. The step needs both new axioms' worth of ideas: cancel, then use what you hold.",
    scancel: "Induct on the letter being cancelled.",
    szsum: "Induct on $b$. In the step, what you assume is impossible.",
    ole: "We need to take a witness $c$ such that $a + c = a$.",
    ozero: "We need to take a witness $c$ such that $0 + c = a$.",
    osucc: "We need to take a witness $c$ such that $a + c = S(a)$.",
    otrans: "Start with two assumptions, and take a witness from each one. Then choose the right witness for the goal.",
    oadd: "After assuming and taking a witness, the same witness can be used for the goal. From there, it's a matter of some manipulation with brackets and order.",
    oz: "Take the witness. You have a theorem about sums that are $0$, but it speaks about the other number.",
    onil: "You want to cancel $a$ from both sides, but the right side has nothing left over. Give it something.",
    oanti: "Take both witnesses. Together the two gaps add up to nothing: show that one of them is $0$, and use that.",
    ostep: "Take the witness. The gap is either $0$ or it comes after some number: treat the two cases separately.",
    ototal: "Induct on $a$. In the step, what the induction hypothesis says splits into cases.",
    mz: "Induction, as with <i>Zero on the left</i>.",
    ms: "Induct on the letter the axioms can reach. Both sides can be pushed to the same shape.",
    mdist: "Induct on $c$. Either side of the goal can be the one you rewrite.",
    mcomm: "Induction, with the two theorems before this one for the two cases.",
    massoc: "Induct on $c$. The step needs the distributive law.",
    t1: "Write the $1$ out and let the axioms eat it.",
    pone: "Write the $1$ out. The power axioms take it from there.",
    p1: "Induct on the exponent.",
    padd: "Induct on $c$, the letter the axioms can reach.",
    ppow: "Induct on $c$. The step is the last quest backwards.",
  };
  for (const q of QUESTS) if (NUDGE[q.id]) q.nudge = NUDGE[q.id];

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
      proof: [assume(""), assume("a"), make("aa", "mp", { P: "P", Q: "false" }), rule("aa", 2, "pswap"), mp("aa", 2, 1), mp("aa", 0, 1)] },
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
    { id: "bimp", name: "Implication as or", goal: "(P->Q)<->(not P|Q)", pay: 3,
      proof: [make("", "ir", { P: "P->Q" }), rw("", [1, 0], "idn", "rl")] },
    { id: "bcontra", name: "A contradiction is false", goal: "P&not P<->false", pay: 3,
      proof: [applyR("", "landi"), assume("1"), cases("1a", 0), mp("1a", 1, 0), make("2", "lefq", { P: "P&not P" })] },
    { id: "bdist", name: "The other distributivity", goal: "P|(Q&R)<->(P|Q)&(P|R)", pay: 5,
      intro: "$\\lor$ distributes over $\\land$ too. No cases needed: it is <i>Distributivity</i> seen through De Morgan's laws.",
      proof: [make("", "ir", { P: "P|(Q&R)" }), rw("", [1], "idn", "rl"), rw("", [1, 0], "idm"), rw("", [1, 0, 1], "idm2"), rw("", [1, 0], "idist"),
        rw("", [1, 0, 0], "idm", "rl"), rw("", [1, 0, 1], "idm", "rl"), rw("", [1, 0], "idm2", "rl"), rw("", [1], "idn")] },
  ].map(b => ({ ...b, bounty: true }));

  const EVERY = [...GATES, ...QUESTS.map(L.questMachine)], PIN = { pin: true };
  /* The proofs above are written in the old bench rules; the game now plays with pins (airetho, #33): what a
     workshop holds starts on its bench, pinned, and is never used up. `modern` replays a proof in both rules side
     by side and moves each block number over to the bench as it is with pins. A `hyp` step falls away (the fact is
     on the bench already), and so does a `dup` of a pinned block (it is never used up). */
  function modern(q, proof) {
    const old = L.start(q, EVERY), neu = L.start(q, EVERY, PIN), out = [];
    const idx = (at, i) => {
      const a = L.ctxAt(old, at).bench, b = L.ctxAt(neu, at).bench, used = new Set();
      let hit = -1;
      for (let k = 0; k <= i; k++) {
        const text = L.show(a[k].s);
        let j = b.findIndex((x, n) => !x.pin && !used.has(n) && L.show(x.s) === text);
        if (j < 0) j = b.findIndex(x => x.pin && L.show(x.s) === text);
        if (j < 0) throw new Error(q.id + ": block " + text + " is missing with pins");
        used.add(j); hit = j;
      }
      return hit;
    };
    for (const st of proof) {
      let t = st;
      if (st.op === "hyp") {
        const text = L.show(L.ctxAt(old, st.at).hyps[st.i]);
        if (L.ctxAt(neu, st.at).bench.some(x => x.pin && L.show(x.s) === text)) { L.step(old, st); continue; }
      } else {
        if (typeof st.b === "number") t = { ...t, b: idx(st.at, st.b) };
        if (st.others) t = { ...t, others: st.others.map(o => idx(st.at, o)) };
        if (st.op === "dup" && L.ctxAt(neu, st.at).bench[t.b].pin) { L.step(old, st); continue; }
      }
      L.step(neu, t); L.step(old, st); out.push(t);
    }
    return out;
  }
  /* Amog proves an equation goal-first now (airetho): where a proof made t = t with refl from one side of the goal
     and rewrote the other side of that block until it was the goal, it rewrites that side of the goal instead and
     lets refl close it. The same machines in the same order, and as many steps. */
  function goalFirst(q, proof) {
    const done = p => { try { return L.replay(q, EVERY, L.withQed(q, EVERY, p, PIN), PIN).root.done; } catch (e) { return false; } };
    for (let k = 0; k < proof.length; k++) {
      const st = proof[k];
      if (st.op !== "refl") continue;
      let c, side;
      try { c = L.ctxAt(L.replay(q, EVERY, proof.slice(0, k), PIN), st.at); } catch (e) { continue; }
      if (c.kids || c.goal[0] !== "=") continue;
      const t = L.term(st.t), b = c.bench.length;
      if (L.same(t, c.goal[1])) side = 0; else if (L.same(t, c.goal[2])) side = 1; else continue;
      let n = k + 1;
      while (n < proof.length && proof[n].at === st.at && proof[n].op === "rw" && proof[n].b === b && proof[n].path[0] === 1 - side && !/^b\d+$/.test(proof[n].m)) n++;
      if (proof.slice(n).some(x => x.at === st.at)) continue;              // the block was used for something else
      const run = proof.slice(k + 1, n).map(x => { const { b: _, ...rest } = x; return { ...rest, op: "rwg", path: [side, ...x.path.slice(1)] }; });
      const next = [...proof.slice(0, k), ...run, { op: "reflg", at: st.at }, ...proof.slice(n)];
      if (done(next)) { proof = next; k += run.length; }
    }
    return proof;
  }
  for (const q of [...QUESTS, ...BOUNTIES]) q.proof = goalFirst(q, q.pin ? q.proof : modern(q, q.proof));   // `pin: true`: written for the new rules already
  for (const q of QUESTS) if (q.short) q.short.proof = modern(q, q.short.proof);
  /* a workshop finishes only when the player says so (a qed step, free): add those to the reference proofs */
  for (const q of [...QUESTS, ...BOUNTIES]) q.proof = L.withQed(q, EVERY, q.proof, PIN);
  for (const q of QUESTS) if (q.short) q.short.proof = L.withQed(q, EVERY, q.short.proof, PIN);
  /* a bounty opens once the machines Amog's proof of it uses are there (airetho): shop machines owned, theorems crafted */
  for (const b of BOUNTIES) b.tools = [...new Set(b.proof.flatMap(s => [TACTICS.includes(s.op) ? s.op : null, s.m]).filter(m => m && !/^[hb]\d+$/.test(m)))];

  const PAR_BONUS = 1;
  /* Machines are free (airetho): every `gate` costs ∎0 and the page hands it over the moment it goes on sale, so
     ∎ only buys the upgrades. The buying rules below still hold for those.
     Once its ↔ is crafted, a one-way machine is replaced on the floor by the ↔, in its place and under its name
     (airetho): the ↔ rewrites a whole block
     either way and stamps either direction, so it does both jobs. Old proofs still use the old machines. */
  const SUPERSEDES = { idn: ["lnn", "dne"], ir: ["pid"], iac: ["la"], ioc: ["lo"], icur: ["lc", "lu"], isym: ["sym"] };
  const SHOP = [
    { id: "add0", gate: true, price: 0, after: ["refl0"] },
    { id: "addS", gate: true, price: 0, after: ["zz"] },
    { id: "induct", gate: true, price: 0, after: ["zz"] },
    { id: "assume", gate: true, price: 0, after: ["zz"] },
    { id: "have", gate: true, extra: true, price: 0, after: ["pchain"] },
    { id: "dne", gate: true, price: 0, after: ["lnn"] },
    { id: "apply", gate: true, price: 0, after: ["landi"] },
    { id: "byc", gate: true, price: 0, after: ["landr"] },
    { id: "cases", gate: true, price: 0, after: ["lore"] },
    { id: "fix", gate: true, price: 0, after: ["idn", "zadd"] },
    { id: "spec", gate: true, price: 0, after: ["qa"] },
    { id: "witness", gate: true, price: 0, after: ["qex"] },
    { id: "obtain", gate: true, price: 0, after: ["qzs"] },
    { id: "szero", gate: true, price: 0, after: ["lefq", "zadd"] },
    { id: "sinj", gate: true, price: 0, after: ["sn01"] },
    { id: "mul0", gate: true, price: 0, after: ["assoc"] },
    { id: "mulS", gate: true, price: 0, after: ["assoc"] },
    { id: "pow0", gate: true, price: 0, after: ["t1"] },
    { id: "powS", gate: true, price: 0, after: ["t1"] },
    // Block press and the Goal lever used to be sold here; everyone has them from the start now (airetho, #33), and
    // a save that bought them gets its ∎ back (the balance is derived from what is still on this list)
    { id: "autofill", name: "Autofill", price: 3, text: "The Block press of refl offers the two sides of the goal, and Induction offers the letters, so you type less." },
    { id: "quick", name: "Goal buttons", price: 4, text: "When the goal reads t = t (or P ↔ P), a refl button on it closes it. When the goal is an implication or a ¬, an assume button runs Assume; when it is a ∀, a fix button runs Fix. One tap instead of opening the machine." },
    { id: "scanner", name: "Scanner", price: 6, text: "Tap a part of a block or of the goal with no machine open to list every machine that fits it, and see where the open machine fits." },
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
  /* quests taken out of the game (airetho: Using an implication was modus ponens stamped): finished ones keep paying */
  const RETIRED = { pmp: { pay: 3, par: 3 }, beq: { pay: 2, par: -1 } };   // beq: the bounty that the Symmetry ↔ quest replaced (no par bonus)
  function earned(done) {
    let n = 0;
    for (const [id, r] of Object.entries(RETIRED)) if (id in done) n += r.pay + (done[id] <= r.par ? PAR_BONUS : 0);
    for (const q of QUESTS) if (q.id in done) n += q.pay + (done[q.id] <= par(q) ? PAR_BONUS : 0);
    for (const b of BOUNTIES) if (b.id in done) n += b.pay;
    return n;
  }
  const balance = (done, owned) => earned(done) - [...owned].reduce((a, id) => a + price(id), 0);
  /* what the machines a quest still needs would cost */
  const missing = (q, owned) => (q.needs || []).filter(id => !owned.has(id)).reduce((a, id) => a + price(id), 0);
  /* Can every quest still be finished from here, even with no bonuses and no bounties? done = the quests finished,
     mask = gates owned, bal = ∎ in hand. Upgrades only ever cost, so they don't appear. Finishing a quest never
     hurts (it pays, and only ever opens things), so every quest that can be done is done first; what is left to
     search is the order of purchases. */
  const GATE_IDS = SHOP.filter(x => x.gate).map(x => x.id);
  const NEEDED = new Set(QUESTS.flatMap(q => q.needs || []));
  const memo = new Map();
  function alive(done, mask, bal) {
    done = { ...done };
    const owns = id => mask >> GATE_IDS.indexOf(id) & 1;
    for (let moved = true; moved;) {
      moved = false;
      for (const q of QUESTS) if (!(q.id in done) && isOpen(q, done) && (q.needs || []).every(owns)) { done[q.id] = 1; bal += q.pay; moved = true; }
    }
    if (QUESTS.every(q => q.id in done)) return true;
    const key = QUESTS.map(q => (q.id in done ? 1 : 0)).join("") + "|" + mask + "|" + bal;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    for (let k = 0; k < GATE_IDS.length && !ok; k++) {
      const id = GATE_IDS[k];
      if (!(mask >> k & 1) && NEEDED.has(id) && onSale(id, done) && price(id) <= bal) ok = alive(done, mask | 1 << k, bal - price(id));
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
    const fin = {};
    for (const q of QUESTS) if (q.id in done) fin[q.id] = 1;
    const mask = GATE_IDS.reduce((m, g, k) => m | (owned.has(g) || g === id ? 1 << k : 0), 0);
    if (!alive(fin, mask, have - it.price)) return "that would leave too little for the machines the quests ahead need";
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

  root.MathcraftQuests = { GATES, WORLDS, SEES, sees, TACTICS, QUESTS, BOUNTIES, SHOP, PAR_BONUS, SUPERSEDES, RETIRED, PIN, gate, machinesFor, playMachines, par, price, isOpen, bountyOpen, numeric, onSale, missing, earned, balance, canBuy };
})(typeof window !== "undefined" ? window : globalThis);
