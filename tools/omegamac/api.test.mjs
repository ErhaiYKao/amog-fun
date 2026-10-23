// node --test tools/omegamac/api.test.mjs — the leaderboard's run tokens and server-side replay (worker/omegamac.js)
import test from "node:test";
import assert from "node:assert/strict";
import { makeToken, readToken, newRun, verifyRun, cleanName, LIMITS } from "../../worker/omegamac.js";
const O = globalThis.Omegamac;

// play a run the way the page does: same seed, same generator, answer every problem right
function play(run, n, gap = 400) {
  const S = O.presetSettings(run.p), rng = O.mulberry32(run.s), answers = [], times = [];
  let prob = O.next(S, rng);
  for (let i = 0; i < n; i++) { answers.push(String(prob.answer)); times.push(500 + i * gap); prob = O.next(S, rng, prob); }
  return { answers, times };
}
const over = run => run.iat + run.d * 1000 + 500;

test("tokens round-trip and reject tampering", async () => {
  const run = newRun("basic", 120, 1000);
  const tok = await makeToken("s3cret", run);
  assert.deepEqual(await readToken("s3cret", tok), run);
  assert.equal(await readToken("other", tok), null);
  const [body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ ...run, s: run.s + 1 })).toString("base64url");
  assert.equal(await readToken("s3cret", `${forged}.${sig}`), null);
  assert.equal(await readToken("s3cret", body), null);
  assert.equal(await readToken("s3cret", "junk"), null);
  assert.equal(newRun("custom", 120), null);
  assert.equal(newRun("basic", 45), null);
});

test("a fair run replays to its score, for every built-in preset", () => {
  for (const p of O.PRESETS) {
    const run = newRun(p.id, 60, 0), { answers, times } = play(run, 80, 600);
    assert.deepEqual(verifyRun(run, answers, times, over(run)), { ok: true, score: 80 }, p.id);
    assert.deepEqual(verifyRun(run, [], [], over(run)), { ok: true, score: 0 });
  }
});

test("cheats are caught", () => {
  const run = newRun("everything", 120, 0), { answers, times } = play(run, 50);
  const bad = (a, t, now = over(run)) => verifyRun(run, a, t, now);
  const wrong = [...answers]; wrong[20] = String(+wrong[20] + 1);
  assert.equal(bad(wrong, times).ok, false);                                   // a wrong answer
  assert.equal(bad(answers.slice(1), times.slice(1)).ok, false);               // skipped a problem
  assert.equal(bad(answers, times, run.iat + 60e3).ok, false);                 // submitted before the time was up
  assert.equal(bad(answers, times, over(run) + LIMITS.expires + 1).ok, false); // stale
  assert.equal(bad(answers, times.map((t, i) => i * 10)).ok, false);          // inhumanly quick
  assert.equal(bad(answers, [...times.slice(0, -1), 130e3]).ok, false);       // answered after the clock ran out
  const other = { ...run, s: run.s ^ 1 };
  assert.equal(verifyRun(other, answers, times, over(run)).ok, false);         // answers from a different seed
  const flood = play(run, run.d * LIMITS.perSecond + 1, 101);
  assert.equal(bad(flood.answers, flood.times).ok, false);                     // more than perSecond on average
});

test("names are cleaned", () => {
  assert.equal(cleanName("  Pope\u0000  Amog \n"), "Pope Amog");
  assert.equal(cleanName("ｆｕｌｌｗｉｄｔｈ"), "fullwidth");
  assert.equal([...cleanName("ℵ".repeat(50))].length, LIMITS.name);
  assert.equal(cleanName(null), "");
});
