/* Omegamac on the shared leaderboard (worker/leaderboard.js). Ranked: the built-in presets at the standard durations.
 * The replay: problems come from gen.js seeded with the token's seed, exactly as in the page; every answer has to
 * be right, in order. A null answer is a skip: the next problem comes up and the run gets 5 s shorter. */
import "../public/omegamac/gen.js";
import { checkRun } from "./leaderboard.js";

const O = globalThis.Omegamac;
export const PER_SECOND = 4; // more correct answers per second than this, on average, isn't a person

export const game = {
  id: "omegamac",
  presets: O.PRESETS.map(p => p.id),
  durations: O.DURATIONS,
  minGap: 100, // ms between two answers
  verify: (run, answers, times, now = Date.now()) => verifyRun(run, answers, times, now),
};

export function verifyRun(run, answers, times, now = Date.now()) {
  const skips = Array.isArray(answers) ? answers.filter(a => a === null).length : 0;
  const ms = run ? Math.max(0, run.d * 1000 - O.SKIP_MS * skips) : 0;
  const bad = checkRun(game, run, answers, times, ms, now);
  if (bad) return { ok: false, why: bad };
  const score = answers.length - skips;
  if (score > run.d * PER_SECOND) return { ok: false, why: "too fast" };
  const S = O.presetSettings(run.p), rng = O.mulberry32(run.s);
  let prob = O.next(S, rng);
  for (const a of answers) {
    if (!prob) return { ok: false, why: "wrong answer in the replay" };
    if (a !== null && (typeof a !== "string" || a.length > 24 || !O.check(prob, a))) return { ok: false, why: "wrong answer in the replay" };
    prob = O.next(S, rng, prob);
  }
  return { ok: true, score, ms };
}
