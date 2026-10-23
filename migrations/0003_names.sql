-- Leaderboard name verdicts (worker/names.js): one row per name, case-insensitive.
-- why = 'ai' (Workers AI, asked once per new name) or 'admin' (set by hand through worker/admin.js; beats the wordlist).
CREATE TABLE lb_names (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  ok INTEGER NOT NULL,
  why TEXT NOT NULL,
  checked INTEGER NOT NULL
);
