# VERTEX

A first-person precision platformer where the shotgun is a jump button. Five stages wound around one tower;
shooting changes where you can go, and where you are changes what you can shoot. Built for amog.fun/vertex
(issue #34).

```bash
npm install
npm run dev          # http://localhost:5183/vertex/
npm test             # node --test ../tools/vertex/*.test.ts
npm run build        # typecheck + bundle into dist/
npm run build:site   # bundle into ../public/vertex (what wrangler deploy publishes)
```

Three.js `WebGPURenderer` with TSL materials; falls back to WebGL 2 on its own (`?webgl` forces it).
No backend, no assets: geometry, shaders and sound are all generated.

## Layout

| | |
|---|---|
| `src/sim/` | The game, with no DOM and no three.js. Runs in Node (tests) and in the page. |
| `src/sim/tuning.ts` | Every gameplay number. |
| `src/sim/world.ts` | Axis-aligned boxes: swept collision, rays, movers, signals, dissolving platforms. |
| `src/sim/player.ts` | The character controller (120 Hz fixed step). |
| `src/sim/weapons.ts`, `enemies.ts` | Hitscan weapons; sentinel, warden, conductor. |
| `src/sim/game.ts` | One run: checkpoints, modes, charges, clock. `step(input)` is the only way state changes. |
| `src/sim/level.ts`, `tower.ts` | Level builder and the tower itself. |
| `src/render/` | Scene, materials, effects, weapon models. Reads the game, never writes it. |
| `src/input.ts`, `audio.ts`, `ui.ts`, `main.ts` | Controls, synthesised sound, HUD, menus and the loop. |
| `../tools/vertex/` | Tests: physics invariants, and a bot that plays every stage. |

## Movement, in numbers

Walk 8 m/s, sprint 11, jump 1.65 m, gravity 25 m/s². Coyote time 80 ms, jump buffer 100 ms.

- **Air control**: below walking speed, 24 m/s² in any direction. Above it the same push only turns your
  velocity (or brakes it), and every radian turned adds 1.5 m/s: that is the air strafe.
- **Bunnyhop**: a jump on the landing tick skips friction.
- **Slide** (C / Ctrl): low friction, and entering one tops your speed up towards 13.5 m/s.
- **Wall kick**: jump while touching a wall. Free off the first wall and off any wall facing the last one;
  otherwise it costs a charge.
- **Shotgun**: 8 m/s of recoil opposite the barrel. Two shells, reloaded while grounded (sliding counts).
- **Dash**: one charge; all your speed (at least 17 m/s) goes where you look.
- **Charges** (max 2): airborne kill, weak-point kill, target sequence. An airborne kill also refunds a shell.
- **Anchors** (pistol): 30 m/s² towards the node for half a second, gravity off while it pulls.

## Editing the tower

`tower.ts` places everything in side coordinates (see the top of `level.ts`). After any change run the tests:
`tools/vertex/routes.ts` holds the intended route through each stage and a bot replays it, so a jump that has
become impossible fails the build. `node tools/vertex/trace.ts <stage> verbose` prints where a route breaks.

## Debugging in a background tab

`?nolock&debug` plays without pointer lock and exposes `__vertex`; `__vertex.advance(seconds, input)` steps
the simulation and renders once, without waiting for animation frames.
