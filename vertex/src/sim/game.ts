// One run of the tower: owns the world, the player, enemies, targets, checkpoints and the clock.
// step(input) advances exactly one 120 Hz tick and is the only way state changes.
import type { V3 } from './math.ts';
import type { LevelDef, CheckpointDef } from './defs.ts';
import { pathAt } from './defs.ts';
import { World } from './world.ts';
import type { Ev, Input, Player } from './player.ts';
import { makePlayer, placePlayer, stepPlayer, feetOf } from './player.ts';
import type { Enemy, Shot } from './enemies.ts';
import { makeEnemy, stepEnemies } from './enemies.ts';
import type { Arena, Target } from './weapons.ts';
import { fire, pullTo } from './weapons.ts';
import { DT, T, SHOTGUN } from './tuning.ts';

export type Mode = 'practice' | 'run';

export const TARGET = { anchorCool: 1.2, chargeWindow: 2.6, chargeRearm: 8 };

export class Game implements Arena {
  level: LevelDef;
  world: World;
  player: Player = makePlayer();
  prev: V3 = { x: 0, y: 0, z: 0 };          // player position one tick ago (render interpolation)
  enemies: Enemy[] = [];
  targets: Target[] = [];
  shots: Shot[] = [];
  events: Ev[] = [];
  mode: Mode;
  tick = 0;
  time = 0;            // run clock (seconds); starts with the first input
  started = false;
  finished = false;
  deaths = 0;
  checkpoint = 0;      // index into level.checkpoints
  stage = 0;           // 0-based
  best = 0;            // highest stage reached this run
  splits: number[] = [];
  killShot = false;    // set by damage() when the current shot killed something
  hurtT = 9;           // seconds since last damage

  constructor(level: LevelDef, mode: Mode) {
    this.level = level;
    this.mode = mode;
    this.world = new World(level.boxes);
    this.restartRun();
  }

  private resetWorld(): void {
    this.world.reset();
    this.enemies = this.level.enemies.map(makeEnemy);
    this.targets = this.level.targets.map((def, id) => ({ id, def, pos: { ...def.pos }, lit: 0, cool: 0 }));
    this.shots.length = 0;
  }

  private spawnAt(cp: CheckpointDef): void {
    const p = this.player;
    placePlayer(p, cp.feet, cp.yaw);
    p.health = T.maxHealth; p.charges = 0; p.shells = SHOTGUN.shells; p.reloadT = 0;
    p.cool = [0, 0, 0]; p.alive = true;
    p.prevFire = p.prevJump = p.prevDash = true;   // held keys must be released before they count again
    this.prev = { ...p.pos };
    this.hurtT = 9;
    this.events.push({ type: 'respawn' });
  }

  /** Back to the very start: clock, splits and progress cleared. */
  restartRun(): void {
    this.resetWorld();
    this.checkpoint = 0; this.stage = 0; this.best = 0;
    this.time = 0; this.started = false; this.finished = false; this.splits = [];
    this.spawnAt(this.level.checkpoints[0]);
  }

  /** Practice: back to the last checkpoint. Tower Run: there are no checkpoints, so the run restarts. */
  respawn(): void {
    if (this.mode === 'run') { this.restartRun(); return; }
    this.resetWorld();
    this.finished = false;
    this.spawnAt(this.level.checkpoints[this.checkpoint]);
  }

  /** Practice: back to the first checkpoint of the current stage. */
  restartStage(): void {
    if (this.mode === 'run') { this.restartRun(); return; }
    const st = this.level.checkpoints[this.checkpoint].stage;
    this.checkpoint = this.level.checkpoints.findIndex((c) => c.stage === st && c.start);
    this.respawn();
  }

  /** Practice helper: jump straight to a checkpoint. */
  warp(index: number): void {
    this.checkpoint = Math.max(0, Math.min(this.level.checkpoints.length - 1, index));
    this.resetWorld();
    this.finished = false;
    this.spawnAt(this.level.checkpoints[this.checkpoint]);
  }

  addCharge(reason: string): void {
    const p = this.player;
    if (p.charges >= T.maxCharges) { this.events.push({ type: 'charge', delta: 0, reason }); return; }
    p.charges++;
    this.events.push({ type: 'charge', delta: 1, reason });
  }

  hurt(amount: number, from: V3): void {
    const p = this.player;
    if (!p.alive || this.finished) return;
    p.health -= amount;
    this.hurtT = 0;
    this.events.push({ type: 'hurt', amount, from: { ...from } });
    if (p.health <= 0) this.die('shot down');
  }

  die(reason: string): void {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false; p.health = 0;
    this.deaths++;
    this.events.push({ type: 'death', reason });
    this.respawn();
  }

  /** Is the player standing inside any checkpoint's volume? */
  inCheckpoint(): boolean {
    const p = this.player.pos;
    for (const c of this.level.checkpoints) {
      if (p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z) return true;
    }
    return false;
  }

  // --- Arena -------------------------------------------------------------------------------------
  damage(e: Enemy, amount: number, weak: boolean, _weapon: number): boolean {
    if (!e.alive) return false;
    e.hp -= amount; e.flash = 0;
    if (e.hp > 0) return false;
    e.alive = false; e.deadT = 0;
    const p = this.player;
    const airborne = !p.grounded;
    this.events.push({ type: 'kill', pos: { ...e.pos }, kind: e.def.kind, airborne, weak });
    p.health = Math.min(T.maxHealth, p.health + T.killHeal);
    if (airborne) {
      this.addCharge('air kill');
      if (p.shells < SHOTGUN.shells) { p.shells++; this.events.push({ type: 'reload' }); }
    }
    if (weak) this.addCharge('weak point');
    if (e.def.signal) {
      this.world.setSignal(e.def.signal, true);
      this.events.push({ type: 'switch', pos: { ...e.pos }, signal: e.def.signal, seconds: 0 });
    }
    return true;
  }

  trip(t: Target, _weapon: number): boolean {
    const d = t.def;
    if (t.cool > 0) return false;
    if (d.kind === 'anchor') {
      pullTo(this.player, t.pos);
      t.cool = TARGET.anchorCool;
      this.events.push({ type: 'anchor', pos: { ...t.pos } });
    } else if (d.kind === 'switch') {
      this.world.setSignal(d.signal!, true, d.seconds ?? 0);
      t.cool = d.seconds ? d.seconds : 1e9;
      this.events.push({ type: 'switch', pos: { ...t.pos }, signal: d.signal!, seconds: d.seconds ?? 0 });
    } else {
      if (t.lit > 0) return false;
      const group = this.targets.filter((o) => o.def.kind === 'charge' && o.def.group === d.group);
      t.lit = d.window ?? TARGET.chargeWindow;
      const done = group.every((o) => o.lit > 0);
      this.events.push({ type: 'target', pos: { ...t.pos }, done, ok: true });
      if (done) {
        for (const o of group) { o.lit = 0; o.cool = TARGET.chargeRearm; }
        this.addCharge('targets');
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------------------------------
  step(inp: Input): void {
    const p = this.player;
    this.tick++;
    if (!this.started && (inp.moveX !== 0 || inp.moveZ !== 0 || inp.jump || inp.fire || inp.dash)) this.started = true;
    if (this.started && !this.finished) this.time += DT;
    this.hurtT += DT;

    this.prev.x = p.pos.x; this.prev.y = p.pos.y; this.prev.z = p.pos.z;
    this.world.update();
    for (const t of this.targets) {
      pathAt(t.def.pos, t.def.path, this.world.time, t.pos);
      if (t.cool > 0) t.cool -= DT;
      if (t.lit > 0) { t.lit -= DT; if (t.lit <= 0) { t.lit = 0; this.events.push({ type: 'target', pos: { ...t.pos }, done: false, ok: false }); } }
    }

    stepPlayer(this.world, p, inp, this.events);
    if (!this.finished) fire(this, p, inp, this.events);
    else p.prevFire = inp.fire;
    stepEnemies(this.world, p, this.stage, this.inCheckpoint(), this.enemies, this.shots, this.events, (n, from) => this.hurt(n, from));
    if (!p.alive) return;

    // hazards
    if (this.world.touchesLethal(p.pos, p.half)) { this.die('disintegrated'); return; }
    if (p.pos.y < this.world.floorY - T.voidDepth) { this.die('the void'); return; }

    // stage by height
    const feet = feetOf(p);
    let st = 0;
    for (let i = 0; i < this.level.stages.length; i++) if (feet >= this.level.stages[i].y - 0.5) st = i;
    if (st !== this.stage) {
      this.stage = st;
      if (st > this.best) {
        this.best = st;
        this.splits[st - 1] = this.time;
        this.events.push({ type: 'stage', stage: st });
        if (this.mode === 'run') p.health = T.maxHealth;
      }
    }

    // checkpoints (forward only)
    const cps = this.level.checkpoints;
    for (let i = this.checkpoint + 1; i < cps.length; i++) {
      const c = cps[i];
      if (p.pos.x > c.min.x && p.pos.x < c.max.x && p.pos.y > c.min.y && p.pos.y < c.max.y && p.pos.z > c.min.z && p.pos.z < c.max.z) {
        this.checkpoint = i;
        if (this.mode === 'practice') p.health = T.maxHealth;
        this.events.push({ type: 'checkpoint', index: i, stage: c.stage });
        break;
      }
    }

    const f = this.level.finish;
    if (!this.finished && p.pos.x > f.min.x && p.pos.x < f.max.x && p.pos.y > f.min.y && p.pos.y < f.max.y && p.pos.z > f.min.z && p.pos.z < f.max.z) {
      this.finished = true;
      this.splits[this.level.stages.length - 1] = this.time;
      this.events.push({ type: 'finish' });
    }
  }
}
