// node --test tools/cgt/cgt.test.mjs — the CGT playground engine against known values
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/cgt/cgt.js";
const C = globalThis.CGT;
const G = (t, env) => C.sum(C.parse(t, env));
const val = (t, env) => C.show(C.canon(G(t, env)));
const out = (t, env) => C.outcome(C.canon(G(t, env)));

test("numbers, nimbers, ups and switches get their names", () => {
  const cases = {
    "0": "0", "{|}": "0", "1": "1", "{0|}": "1", "{1|}": "2", "{|0}": "-1", "{0|1}": "1/2", "{1/2|1}": "3/4", "-3/4": "-3/4",
    "{0|0}": "*", "*": "*", "{0,*|0,*}": "*2", "*3": "*3", "{1|1}": "1*", "1*": "1*", "{0|*}": "↑", "^": "↑", "v": "↓",
    "^+^": "⇑", "^^": "⇑", "{0,*|0}": "↑*", "^*": "↑*", "{1|-1}": "±1", "±2": "±2", "{0|2}": "1", "{-1|1}": "0", "{1/2|2}": "1",
    "{0, * | 1}": "1/2", "* + *": "0", "*2 + *3": "*", "1/2 + 1/2": "1", "{1|0} + {1|0}": "1",
  };
  for (const [t, name] of Object.entries(cases)) assert.equal(val(t), name, t);
});

test("outcomes", () => {
  const cases = { "0": "zero", "1": "positive", "-1": "negative", "*": "fuzzy", "^": "positive", "v": "negative", "^*": "fuzzy",
    "{1|-1}": "fuzzy", "*+*": "zero", "^+v": "zero", "{0||0|-1}": "positive", "dom(2,2)": "fuzzy", "dom(1,2)": "negative", "dom(2,1)": "positive" };
  for (const [t, o] of Object.entries(cases)) assert.equal(out(t), o, t);
});

test("relations, and the classics: ↑ is positive but smaller than every positive number, tiny is smaller still", () => {
  const P = t => C.canon(G(t));
  assert.equal(C.compare(P("^"), P("0")), ">");
  assert.equal(C.compare(P("^"), P("1/64")), "<");
  assert.equal(C.compare(P("^"), P("*")), "∥");
  assert.equal(C.compare(P("{0||0|-1}"), P("^")), "<");    // tiny-1 < ↑
  assert.equal(C.compare(P("{0||0|-1}"), P("0")), ">");
  assert.equal(C.compare(P("{2|-1}"), P("1/2")), "∥");     // a hot game is confused with its mean
  assert.equal(C.compare(P("*2"), P("*3")), "∥");
  assert.equal(C.compare(P("1/2 + 1/2"), P("1")), "=");
  // G - G = 0 for anything
  for (const t of ["{2|-1}", "dom(2,3)", "^*", "{0||0|-1}", "*7"]) assert.equal(out(`(${t}) - (${t})`), "zero", t);
});

test("canonical forms are canonical: equal games get the same id, and the forms are stable", () => {
  const P = t => C.canon(G(t));
  assert.equal(P("{0, -1 | 2, 5}"), P("{0|2}"));      // dominated options go
  assert.equal(P("{0|2}"), P("1"));
  assert.equal(P("^ + ^ + *"), P("{0|^}"));            // ⇑* = {0 | ↑}
  assert.equal(P("{*|*}"), P("0"));                    // reversible through 0
  for (const t of ["dom(2,2)", "dom(2,3)", "dom(3,3)", "{2|-1} + *", "^ + {1|0}"]) { const c = P(t); assert.equal(C.canon(c), c, t); }
  // Domineering values from the literature
  assert.equal(val("dom(2,2)"), "±1");
  assert.equal(val("dom(1,4)"), "-2");
});

test("names from the library, nim(n), dom(r,c), parse errors", () => {
  const env = { up: [C.UP], hot: C.parse("{2|-1}") };
  assert.equal(val("up + up", env), "⇑");
  assert.equal(val("hot - hot", env), "0");
  assert.equal(val("nim(5)"), "*5");
  for (const bad of ["", "{0}", "1/3", "foo", "{0||1||2}", "dom(5,5)", "1 +"]) assert.throws(() => C.parse(bad), /./, bad);
});

test("budgets abort cleanly and the work done so far is kept", () => {
  const g = C.parse("dom(4,4) + dom(4,4) + dom(3,4)");
  assert.equal(C.analyse(g, 50), null);                 // far too little
  const r = C.analyse(g, 1e9, 60e3);
  assert.ok(r && r.name, "Domineering sums, given time");
  assert.equal(r.name, C.analyse(C.parse("dom(3,4)"), 1e9).name);    // 4×4 is symmetric (transposing swaps the players), so dom(4,4) = -dom(4,4) and the two cancel
  assert.equal(C.parse("^ + * + dom(2,2)").length, 3);            // sums stay as their terms
});
