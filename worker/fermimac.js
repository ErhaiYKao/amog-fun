/* Fermimac on the shared leaderboard (worker/leaderboard.js). Ranked: every preset at every duration.
 * The replay: problems come from gen.js seeded with the token's seed. They don't depend on the guesses (one guess
 * each, then the next problem), so the server recomputes the score itself: hits within the preset's tolerance, or in
 * FermiGuessr the points for each of its fixed rounds (the run ends early once every round is answered). */
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
  const P = run && F.preset(run.p), full = run ? run.d * 1000 : 0;
  // a FermiGuessr run that answered every round ended at its last guess; anything else ran the whole clock
  const done = P && P.rounds && Array.isArray(answers) && Array.isArray(times) && answers.length === P.rounds && times.length === P.rounds;
  const ms = done ? Math.min(full, times[times.length - 1]) : full;
  const bad = checkRun(game, run, answers, times, ms, now);
  if (bad) return { ok: false, why: bad };
  if (P.rounds ? answers.length > P.rounds || times[times.length - 1] > full + 1000 : answers.length > run.d * PER_SECOND) return { ok: false, why: "too many answers" };
  const r = F.makeRun(run.p, run.s);
  let score = 0;
  for (const a of answers) {
    if (typeof a !== "string" || a.length > 40) return { ok: false, why: "bad answers" };
    score += F.score(run.p, r.next(), a);
  }
  return { ok: true, score, ms };
}
