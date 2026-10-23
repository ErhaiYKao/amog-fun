// node --test tools/omegamac/api.test.mjs — leaderboard tokens (worker/leaderboard.js) and Omegamac's replay (worker/omegamac.js)
import test from "node:test";
import assert from "node:assert/strict";
import { makeToken, readToken, newRun, cleanName, LIMITS } from "../../worker/leaderboard.js";
import { game, verifyRun, PER_SECOND } from "../../worker/omegamac.js";
const O = globalThis.Omegamac;

// play a run the way the page does: same seed, same generator, answer every problem right (null = skip)
function play(run, n, gap = 400, skipAt = []) {
  const S = O.presetSettings(run.p), rng = O.mulberry32(run.s), answers = [], times = [];
  let prob = O.next(S, rng);
  for (let i = 0; i < n; i++) { answers.push(skipAt.includes(i) ? null : String(prob.answer)); times.push(500 + i * gap); prob = O.next(S, rng, prob); }
  return { answers, times };
}
const over = run => run.iat + run.d * 1000 + 500;

test("tokens round-trip and reject tampering", async () => {
  const run = newRun(game, "basic", 120, 1000);
  assert.equal(run.g, "omegamac");
  const tok = await makeToken("s3cret", run);
  assert.deepEqual(await readToken("s3cret", tok), run);
  assert.equal(await readToken("other", tok), null);
  const [body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ ...run, s: run.s + 1 })).toString("base64url");
  assert.equal(await readToken("s3cret", `${forged}.${sig}`), null);
  assert.equal(await readToken("s3cret", body), null);
  assert.equal(await readToken("s3cret", "junk"), null);
  assert.equal(newRun(game, "custom", 120), null);
  assert.equal(newRun(game, "basic", 45), null);
});

test("a fair run replays to its score, for every built-in preset", () => {
  for (const p of O.PRESETS) {
    const run = newRun(game, p.id, 60, 0), { answers, times } = play(run, 80, 600);
    assert.deepEqual(verifyRun(run, answers, times, over(run)), { ok: true, score: 80, ms: 60000 }, p.id);
    assert.equal(verifyRun(run, [], [], over(run)).score, 0);
  }
});

test("skips: the replay skips too, and each one takes 5 s off the run", () => {
  const run = newRun(game, "everything", 60, 0), { answers, times } = play(run, 40, 600, [3, 4, 20]);
  const v = verifyRun(run, answers, times, run.iat + 45500);
  assert.deepEqual(v, { ok: true, score: 37, ms: 45000 });
  const late = play(run, 100, 500, [0]).times.slice(0, 40); // last answer at 20 s: fine
  assert.ok(verifyRun(run, answers, late, run.iat + 46000).ok);
  const tooLate = [...times.slice(0, -1), 47000]; // after the shortened clock ran out
  assert.equal(verifyRun(run, answers, tooLate, run.iat + 48000).ok, false);
});

test("cheats are caught", () => {
  const run = newRun(game, "everything", 120, 0), { answers, times } = play(run, 50);
  const bad = (a, t, now = over(run), r = run) => verifyRun(r, a, t, now);
  const wrong = [...answers]; wrong[20] = String(+wrong[20] + 1);
  assert.equal(bad(wrong, times).ok, false);                                   // a wrong answer
  assert.equal(bad(answers.slice(1), times.slice(1)).ok, false);               // missed a problem without skipping
  assert.equal(bad(answers, times, run.iat + 60e3).ok, false);                 // submitted before the time was up
  assert.equal(bad(answers, times, over(run) + LIMITS.expires + 1).ok, false); // stale
  assert.equal(bad(answers, times.map((t, i) => i * 10)).ok, false);          // inhumanly quick
  assert.equal(bad(answers, [...times.slice(0, -1), 130e3]).ok, false);       // answered after the clock ran out
  assert.equal(bad(answers, times, over(run), { ...run, s: run.s ^ 1 }).ok, false); // answers from another seed
  assert.equal(bad(answers, times, over(run), { ...run, g: "fermimac" }).ok, false); // another game's token
  const flood = play(run, run.d * PER_SECOND + 1, 101);
  assert.equal(bad(flood.answers, flood.times).ok, false);                     // more than PER_SECOND on average
});

test("names are cleaned", () => {
  assert.equal(cleanName("  Pope\u0000  Amog \n"), "Pope Amog");
  assert.equal(cleanName("ｆｕｌｌｗｉｄｔｈ"), "fullwidth");
  assert.equal([...cleanName("ℵ".repeat(50))].length, LIMITS.name);
  assert.equal(cleanName(null), "");
});
