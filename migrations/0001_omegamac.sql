-- Omegamac leaderboard (worker/omegamac.js)
-- every accepted run id, so a run can't be submitted twice
CREATE TABLE omegamac_runs (
  id TEXT PRIMARY KEY,
  created INTEGER NOT NULL
);
-- best score per name on each board (built-in preset × duration)
CREATE TABLE omegamac_best (
  preset TEXT NOT NULL,
  dur INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  score INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (preset, dur, name)
);
CREATE INDEX omegamac_best_rank ON omegamac_best (preset, dur, score DESC, created);
