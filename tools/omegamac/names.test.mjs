// node --test tools/omegamac/names.test.mjs — leaderboard name checks (worker/names.js) and moderation (worker/admin.js)
import test from "node:test";
import assert from "node:assert/strict";
import { nameProblem, aiVerdict, checkName } from "../../worker/names.js";
import { authorized, handleAdmin } from "../../worker/admin.js";

const rot13 = s => s.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97));

// just enough of D1 for lb_names and lb_best, keyed case-insensitively like COLLATE NOCASE
function fakeDB(best = []) {
  const names = new Map(), key = s => s.toLowerCase();
  const db = {
    names, best,
    prepare(sql) {
      let args = [];
      const st = {
        bind(...a) { args = a; return st; },
        async first() {
          if (/FROM lb_names/.test(sql)) return names.get(key(args[0])) ?? null;
          throw new Error("unexpected first: " + sql);
        },
        async run() {
          if (/INSERT OR IGNORE INTO lb_names/.test(sql)) { if (!names.has(key(args[0]))) names.set(key(args[0]), { ok: args[1], why: args[2] }); }
          else if (/INSERT INTO lb_names/.test(sql)) names.set(key(args[0]), { ok: args[1], why: "admin" });
          else if (/DELETE FROM lb_best/.test(sql)) {
            const before = db.best.length;
            db.best = db.best.filter(r => key(r.name) !== key(args[0]));
            return { meta: { changes: before - db.best.length } };
          } else throw new Error("unexpected run: " + sql);
          return { meta: { changes: 1 } };
        },
        async all() { return { results: db.best.map(r => ({ ...r, ...(names.get(key(r.name)) ?? { ok: null, why: null }) })) }; },
      };
      return st;
    },
  };
  return db;
}
const fakeAI = (answer, calls = []) => ({ async run(model, input) { calls.push(input.messages[1].content); if (answer instanceof Error) throw answer; return { response: answer }; } });

test("the wordlist sees through disguises but not into harmless words", () => {
  const slur = rot13("avttre"), word = rot13("phag");
  for (const n of [slur, slur.toUpperCase(), "xX_" + slur + "_Xx", "n1gg3r", "n!gger", "niiiigger", "ñigger", "n.i.g.g.e.r", "Big" + rot13("pbpx").replace(/^./, c => c.toUpperCase()), word, word + " 42", "c u n t"])
    assert.equal(nameProblem(n), "wordlist", n);
  for (const n of ["Pope Amog", "Scunthorpe", "analysis", "Dickens", "torpedo", "peacock", "Niger", "cocktail", "shiitake", "Amog Magnussen", "ℵ₀", "0x1337", "Λ-calculus", ""])
    assert.equal(nameProblem(n), null, n);
  assert.equal(nameProblem("big" + rot13("pbpx")), null); // whole-word entries glued on in lowercase: left to the model
});

test("the model's answer is read strictly, and a broken model counts as no answer", async () => {
  assert.equal(await aiVerdict(fakeAI("ALLOW"), "x"), true);
  assert.equal(await aiVerdict(fakeAI(" block."), "x"), false);
  assert.equal(await aiVerdict(fakeAI("Sure! The name is fine."), "x"), null);
  assert.equal(await aiVerdict(fakeAI(new Error("down")), "x"), null);
  assert.equal(await aiVerdict({ run: () => new Promise(() => {}) }, "x", 20), null); // hangs: timed out
});

test("each new name is asked about once; admin verdicts win", async () => {
  const calls = [], DB = fakeDB();
  let env = { DB, AI: fakeAI("ALLOW", calls) };
  assert.equal(await checkName(env, "Pope Amog"), true);
  assert.equal(await checkName(env, "pope amog"), true); // same name, cached
  assert.equal(calls.length, 1);
  assert.equal(await checkName(env, rot13("phag")), false); // the wordlist never reaches the model
  assert.equal(calls.length, 1);

  env = { DB, AI: fakeAI("BLOCK", calls) };
  assert.equal(await checkName(env, "Bad Idea"), false);
  assert.equal(await checkName(env, "Bad Idea"), false);
  assert.equal(calls.length, 2);

  env = { DB, AI: fakeAI(new Error("down"), calls) };
  assert.equal(await checkName(env, "Fresh"), true);     // fails open...
  assert.equal(DB.names.has("fresh"), false);             // ...and isn't cached, so it's asked again later
  assert.equal(await checkName({ DB }, "No AI binding"), true);

  DB.names.set("scunthorpe united", { ok: 0, why: "admin" });
  DB.names.set(rot13("phag"), { ok: 1, why: "admin" });
  assert.equal(await checkName(env, "Scunthorpe United"), false);
  assert.equal(await checkName(env, rot13("phag")), true); // an admin allow beats the wordlist
});

test("admin: needs the secret, blocks and allows names", async () => {
  const req = (route, auth, body) => new Request(`https://amog.fun/api/admin/${route}`, {
    method: body ? "POST" : "GET", headers: auth ? { authorization: "Bearer " + auth } : {}, body: body && JSON.stringify(body) });
  const DB = fakeDB([{ name: "Rude", score: 50 }, { name: "rude", score: 40 }, { name: "Nice", score: 30 }]);
  const env = { DB, ADMIN_SECRET: "hunter2" };

  assert.equal((await handleAdmin(req("names"), { DB }, "names")).status, 404); // no secret set: no admin routes
  assert.equal((await handleAdmin(req("names"), env, "names")).status, 401);
  assert.equal((await handleAdmin(req("names", "hunter3"), env, "names")).status, 401);
  assert.equal(await authorized(req("names", "hunter2"), "hunter2"), true);

  const list = await (await handleAdmin(req("names", "hunter2"), env, "names")).json();
  assert.equal(list.names.length, 3);
  assert.deepEqual(await (await handleAdmin(req("block", "hunter2", { name: " RUDE " }), env, "block")).json(), { removed: 2 });
  assert.deepEqual(DB.best.map(r => r.name), ["Nice"]);
  assert.equal(await checkName({ DB, AI: fakeAI("ALLOW") }, "rude"), false);
  await handleAdmin(req("allow", "hunter2", { name: "Rude" }), env, "allow");
  assert.equal(await checkName({ DB }, "rude"), true);
  assert.equal((await handleAdmin(req("block", "hunter2", {}), env, "block")).status, 400);
});
