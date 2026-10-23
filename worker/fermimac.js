/* Fermimac on the shared leaderboard (worker/leaderboard.js). Ranked: every preset at every duration.
 * The replay: problems come from gen.js seeded with the token's seed. They don't depend on the guesses (one guess
 * each, then the next problem), so the score is simply how many guesses were within the preset's tolerance. */
import "../public/fermimac/gen.js";
import { checkRun } from "./leaderboard.js";

const F = globalThis.Fermimac;
export const PER_SECOND = 3; // more guesses per second than this, on average, isn't a person

export const game = {
  id: "fermimac",
  presets: F.PRESETS.map(p => p.id),
  durations: F.DURATIONS,
  minGap: 250, // ms between two guesses
  verify: (run, answers, times, now = Date.now()) => verifyRun(run, answers, times, now),
};

export function verifyRun(run, answers, times, now = Date.now()) {
  const ms = run ? run.d * 1000 : 0;
  const bad = checkRun(game, run, answers, times, ms, now);
  if (bad) return { ok: false, why: bad };
  if (answers.length > run.d * PER_SECOND) return { ok: false, why: "too fast" };
  const r = F.makeRun(run.p, run.s);
  let score = 0;
  for (const a of answers) {
    if (typeof a !== "string" || a.length > 40) return { ok: false, why: "bad answers" };
    if (F.check(run.p, r.next(), a)) score++;
  }
  return { ok: true, score, ms };
}
