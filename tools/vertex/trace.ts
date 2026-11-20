// Debug helper: node tools/vertex/trace.ts <stage 1..5> [verbose]   plays one stage's bot route and reports.
import { Game } from '../../vertex/src/sim/game.ts';
import { buildTower } from '../../vertex/src/sim/tower.ts';
import { Bot } from './bot.ts';
import { ROUTES } from './routes.ts';

const level = buildTower();
const i = Number(process.argv[2] ?? 1) - 1;
const g = new Game(level, 'practice');
g.warp(level.checkpoints.findIndex((c) => c.stage === i && c.start));
const b = new Bot(g);
b.verbose = process.argv[3] === 'verbose';
try {
  ROUTES[i](b);
  console.log(`stage ${i + 1} ok in ${g.time.toFixed(2)} s at ${b.where()}`);
} catch (e) {
  console.log(String((e as Error).message));
  console.log('events:', b.events.slice(-14).map((e) => e.type).join(' '));
  process.exitCode = 1;
}
