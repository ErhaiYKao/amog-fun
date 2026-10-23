-- One leaderboard for every game (worker/leaderboard.js). The omegamac_* tables are folded in and dropped.
CREATE TABLE lb_runs (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  created INTEGER NOT NULL
);
-- best score per name on each board (game × preset × duration)
CREATE TABLE lb_best (
  game TEXT NOT NULL,
  board TEXT NOT NULL,
  dur INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  score INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (game, board, dur, name)
);
CREATE INDEX lb_best_rank ON lb_best (game, board, dur, score DESC, created);

INSERT INTO lb_runs (id, game, created) SELECT id, 'omegamac', created FROM omegamac_runs;
INSERT INTO lb_best (game, board, dur, name, score, created) SELECT 'omegamac', preset, dur, name, score, created FROM omegamac_best;
DROP TABLE omegamac_runs;
DROP TABLE omegamac_best;
