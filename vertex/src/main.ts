// VERTEX entry point: wires the simulation to input, rendering, audio and the menus.
import { Game } from './sim/game.ts';
import type { Mode } from './sim/game.ts';
import { buildTower } from './sim/tower.ts';
import { Stepper } from './sim/clock.ts';
import type { Ev } from './sim/player.ts';
import { hspeed } from './sim/player.ts';
import { Controls } from './input.ts';
import { Sound } from './audio.ts';
import { Hud } from './ui.ts';
import { View } from './render/view.ts';
import { loadSave, storeSave, formatTime } from './settings.ts';
import type { Quality } from './settings.ts';

type State = 'menu' | 'playing' | 'paused' | 'results';
type Screen = 'menu' | 'pause' | 'settings' | 'how' | 'results';

const $ = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const params = new URLSearchParams(location.search);

const save = loadSave();
const canvas = $<HTMLCanvasElement>('view');
const level = buildTower();
let game = new Game(level, 'practice');
const view = new View(canvas, save);
const controls = new Controls(canvas, save);
const sound = new Sound();
const hud = new Hud(save);
const stepper = new Stepper();

let state: State = 'menu';
let overlayFrom: Screen = 'menu';      // where Settings / How to play return to
let resultsAt = 0;

const screens: Record<Screen, HTMLElement> = { menu: $('menu'), pause: $('pause'), settings: $('settings'), how: $('how'), results: $('results') };
function show(s: Screen | null): void {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== s;
}

// ---- menus ------------------------------------------------------------------------------------
function refreshMenu(): void {
  const parts: string[] = [];
  if (save.bestRun !== null) parts.push(`best Tower Run ${formatTime(save.bestRun)}`);
  if (save.bestPractice !== null) parts.push(`best practice climb ${formatTime(save.bestPractice)}`);
  if (save.summits) parts.push(`${save.summits} summit${save.summits === 1 ? '' : 's'}`);
  $('best').textContent = parts.join('  ·  ');
  $('backend').textContent = `renderer: ${view.backend}`;
}

function start(mode: Mode, checkpoint = 0): void {
  sound.start();
  game = new Game(level, mode);
  if (checkpoint > 0) game.warp(checkpoint);
  game.events.length = 0;
  view.attach(game);
  view.fx.clear();
  controls.input.yaw = game.player.yaw;
  controls.input.pitch = 0;
  controls.input.weapon = 0;
  stepper.reset();
  state = 'playing';
  show(null);
  hud.show(true);
  if (save.fullscreen) controls.fullscreen(true);
  controls.lock();
}

function pause(): void {
  if (state !== 'playing') return;
  state = 'paused';
  controls.release();
  $('p-cp').textContent = game.mode === 'run' ? 'Restart run' : 'Back to checkpoint';
  const sel = $('stage-select');
  sel.innerHTML = '';
  if (game.mode === 'practice') {
    level.checkpoints.forEach((c, i) => {
      if (!c.start) return;
      const b = document.createElement('button');
      b.textContent = `${c.stage + 1} · ${level.stages[c.stage].name}`;
      b.onclick = () => { game.warp(i); afterTeleport(); resume(); };
      sel.append(b);
    });
  }
  show('pause');
}

function resume(): void {
  if (state !== 'paused') return;
  state = 'playing';
  stepper.reset();
  show(null);
  if (save.fullscreen) controls.fullscreen(true);
  controls.lock();
}

function quit(): void {
  state = 'menu';
  controls.unlock();
  controls.fullscreen(false);
  hud.show(false);
  refreshMenu();
  show('menu');
}

/** After any teleport the camera must look where the checkpoint faces. */
function afterTeleport(): void {
  controls.input.yaw = game.player.yaw;
  controls.input.pitch = 0;
  view.rebind(game);
  view.snap();
}

function finish(): void {
  state = 'results';
  controls.unlock();
  const run = game.mode === 'run';
  const prev = run ? save.bestRun : save.bestPractice;
  const best = prev === null || game.time < prev;
  const oldSplits = save.bestSplits;
  save.summits++;
  if (run && best) { save.bestRun = game.time; save.bestSplits = [...game.splits]; }
  if (!run && best) save.bestPractice = game.time;
  storeSave(save);
  $('r-title').textContent = run ? 'Summit' : 'Summit (practice)';
  $('r-time').textContent = formatTime(game.time);
  $('r-best').textContent = best ? (prev === null ? 'first time on top' : `new best: ${formatTime(prev - game.time)} faster`) : `best ${formatTime(prev!)} · ${formatTime(game.time - prev!)} off`;
  const rows = level.stages.map((s, i) => {
    const t = game.splits[i], seg = t - (i ? game.splits[i - 1] : 0);
    const old = run && oldSplits[i] !== undefined ? oldSplits[i] - (i ? oldSplits[i - 1] : 0) : null;
    const diff = old === null || !Number.isFinite(seg) ? '' : `${seg <= old ? '−' : '+'}${Math.abs(seg - old).toFixed(2)}`;
    return `<tr><td>${i + 1} · ${s.name}</td><td class="r">${Number.isFinite(seg) ? formatTime(seg) : '—'}</td><td class="r">${Number.isFinite(t) ? formatTime(t) : '—'}</td><td class="r">${diff}</td></tr>`;
  });
  $('r-splits').innerHTML = rows.join('') + `<tr><td>deaths</td><td class="r">${game.deaths}</td><td></td><td></td></tr>`;
  hud.show(false);
  show('results');
}

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!btn) return;
  sound.start(); sound.ui();
  switch (btn.dataset.act) {
    case 'run': start('run'); break;
    case 'practice': start('practice'); break;
    case 'again': start(game.mode); break;
    case 'resume': resume(); break;
    case 'checkpoint': game.respawn(); afterTeleport(); resume(); break;
    case 'stage': game.restartStage(); afterTeleport(); resume(); break;
    case 'restart': game.restartRun(); afterTeleport(); resume(); break;
    case 'quit': quit(); break;
    case 'settings': overlayFrom = state === 'paused' ? 'pause' : 'menu'; show('settings'); break;
    case 'how': overlayFrom = state === 'paused' ? 'pause' : 'menu'; show('how'); break;
    case 'back': show(overlayFrom); break;
  }
});

canvas.addEventListener('click', () => { if (state === 'playing' && !controls.locked) controls.lock(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && (screens.settings.hidden === false || screens.how.hidden === false)) show(overlayFrom);
});

// ---- settings ---------------------------------------------------------------------------------
function bindSettings(): void {
  const sens = $<HTMLInputElement>('s-sens'), fov = $<HTMLInputElement>('s-fov'), vol = $<HTMLInputElement>('s-vol');
  const quality = $<HTMLSelectElement>('s-quality');
  const checks: [string, 'invertY' | 'autoSprint' | 'hints' | 'fullscreen'][] = [['s-invert', 'invertY'], ['s-autosprint', 'autoSprint'], ['s-hints', 'hints'], ['s-full', 'fullscreen']];
  const paint = () => {
    $('o-sens').textContent = save.sens.toFixed(2);
    $('o-fov').textContent = `${save.fov}°`;
    $('o-vol').textContent = `${Math.round(save.volume * 100)}%`;
  };
  sens.value = String(save.sens); fov.value = String(save.fov); vol.value = String(save.volume); quality.value = save.quality;
  sens.oninput = () => { save.sens = Number(sens.value); paint(); storeSave(save); };
  fov.oninput = () => { save.fov = Number(fov.value); paint(); storeSave(save); };
  vol.oninput = () => { save.volume = Number(vol.value); sound.setVolume(save.volume); paint(); storeSave(save); };
  quality.onchange = () => { save.quality = quality.value as Quality; view.setQuality(save.quality); storeSave(save); };
  for (const [id, key] of checks) {
    const el = $<HTMLInputElement>(id);
    el.checked = save[key];
    el.onchange = () => { save[key] = el.checked; storeSave(save); };
  }
  paint();
}

// ---- commands from the keyboard -----------------------------------------------------------------
controls.onCommand = (cmd) => {
  if (cmd === 'pause') { pause(); return; }
  if (state !== 'playing') return;
  if (cmd === 'checkpoint') game.respawn();
  else if (cmd === 'stage') game.restartStage();
  else game.restartRun();
};

// ---- events -------------------------------------------------------------------------------------
function onEvent(ev: Ev): void {
  view.handle(ev, game);
  hud.handle(ev, game);
  switch (ev.type) {
    case 'jump': sound.jump(); break;
    case 'walljump': sound.wallJump(); break;
    case 'land': sound.land(ev.speed); break;
    case 'slide': sound.slide(); break;
    case 'dash': sound.dash(); break;
    case 'nocharge': sound.noCharge(); break;
    case 'dryfire': sound.dryFire(); break;
    case 'reload': sound.reload(); break;
    case 'shot': [sound.shotgun, sound.pistol, sound.rail][ev.weapon].call(sound); if (ev.hit) sound.hit(); break;
    case 'impact': if (ev.kind === 'weak') sound.weakHit(); break;
    case 'charge': if (ev.delta > 0) sound.chargeGain(); else if (ev.delta === 0) sound.chargeFull(); break;
    case 'kill': sound.kill(); break;
    case 'hurt': sound.hurt(); break;
    case 'death': sound.death(); break;
    case 'respawn': afterTeleport(); sound.respawn(); break;
    case 'checkpoint': if (game.mode === 'practice') sound.checkpoint(); break;
    case 'stage': sound.stage(); break;
    case 'finish': sound.finish(); resultsAt = performance.now() + 1800; break;
    case 'enemyShot': sound.enemyShot(); break;
    case 'telegraph': sound.telegraph(); break;
    case 'beam': sound.beam(); break;
    case 'boom': sound.boom(); break;
    case 'switch': sound.switchOn(); break;
    case 'anchor': sound.anchor(); break;
    case 'target': if (ev.ok) sound.target(ev.done); else sound.targetFail(); break;
    case 'dissolve': sound.dissolve(); break;
    case 'rebuild': sound.rebuild(); break;
  }
}

// ---- the loop -----------------------------------------------------------------------------------
let lastT = performance.now();
function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (state === 'playing') {
    const n = stepper.advance(dt);
    for (let i = 0; i < n; i++) {
      game.step(controls.sample());
      if (game.events.length) {
        const evs = game.events.splice(0);
        for (const ev of evs) onEvent(ev);
      }
    }
    hud.update(game, dt);
    if (resultsAt && now >= resultsAt) { resultsAt = 0; finish(); }
  }
  view.sync(game, state === 'playing' ? stepper.alpha : 1, dt, { dx: controls.mouseDX, dy: controls.mouseDY, yaw: controls.input.yaw, pitch: controls.input.pitch }, state !== 'menu');
  controls.mouseDX = controls.mouseDY = 0;
  sound.ambient(state === 'playing' ? Math.hypot(hspeed(game.player), game.player.vel.y) : 0, state === 'playing');
  view.render();
}

addEventListener('resize', () => view.resize());
// Ctrl+W is slide + forward: outside fullscreen the browser would close the tab, so ask first while a run is live
addEventListener('beforeunload', (e) => { if (state === 'playing' && !controls.noLock) e.preventDefault(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !controls.noLock) pause(); lastT = performance.now(); });

async function boot(): Promise<void> {
  bindSettings();
  sound.volume = save.volume;
  await view.init();
  view.attach(game);
  refreshMenu();
  if (params.has('nolock')) controls.noLock = controls.locked = true;     // automated testing: play without pointer lock
  if (import.meta.env.DEV || params.has('debug')) {
    // Debug handle. `advance` steps the simulation and renders without waiting for animation frames, which is how
    // the game is driven when the page is in a background tab (automated checks).
    const advance = (seconds: number, input: Partial<typeof controls.input> = {}): void => {
      Object.assign(controls.input, input);
      const frames = Math.max(1, Math.round(seconds * 60));
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < 2; i++) {
          game.step(controls.input);
          for (const ev of game.events.splice(0)) onEvent(ev);
        }
        hud.update(game, 1 / 60);
        view.sync(game, 1, 1 / 60, { dx: 0, dy: 0, yaw: controls.input.yaw, pitch: controls.input.pitch }, true);
      }
      view.render();
    };
    Object.assign(window, { __vertex: { get game() { return game; }, view, controls, start, level, advance, frame, get state() { return state; } } });
  }
  void view.renderer.setAnimationLoop(frame);
}

boot().catch((err) => {
  console.error(err);
  const el = $('backend');
  el.textContent = `could not start the renderer: ${err instanceof Error ? err.message : String(err)}`;
  el.style.color = '#ff5a5f';
});
