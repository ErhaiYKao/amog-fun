// Keyboard + mouse -> the simulation's Input. Looking is applied immediately; everything else is sampled per tick.
import type { Input } from './sim/player.ts';
import { emptyInput } from './sim/player.ts';
import { clamp } from './sim/math.ts';
import type { Save } from './settings.ts';

const RAD_PER_COUNT = 0.0012;   // at sensitivity 1: about 5200 mouse counts per full turn

export class Controls {
  input: Input = emptyInput();
  keys = new Set<string>();
  locked = false;
  noLock = false;       // automated testing: accept keys without pointer lock
  wheel = 0;            // pending wheel jumps
  private wheelPhase = 0;
  mouseDX = 0;          // look deltas this frame, for weapon sway
  mouseDY = 0;
  onCommand: (cmd: 'checkpoint' | 'stage' | 'restart' | 'pause') => void = () => {};
  private save: Save;
  private el: HTMLElement;

  constructor(el: HTMLElement, save: Save) {
    this.el = el;
    this.save = save;
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => this.release());
    document.addEventListener('pointerlockchange', () => {
      if (this.noLock) return;
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.release(); this.onCommand('pause'); }
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // some browsers report a huge delta on the first event after locking: ignore anything absurd
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.look(e.movementX, e.movementY);
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.keys.add('Mouse0');
      if (e.button === 2) this.keys.add('Mouse2');
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.keys.delete('Mouse0');
      if (e.button === 2) this.keys.delete('Mouse2');
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.locked) { this.wheel = Math.min(this.wheel + 1, 2); e.preventDefault(); } }, { passive: false });
  }

  look(dx: number, dy: number): void {
    const k = RAD_PER_COUNT * this.save.sens;
    this.input.yaw -= dx * k;
    this.input.pitch = clamp(this.input.pitch - dy * k * (this.save.invertY ? -1 : 1), -1.55, 1.55);
    this.mouseDX += dx; this.mouseDY += dy;
  }

  lock(): void {
    if (this.noLock) { this.locked = true; return; }
    // unadjustedMovement gives raw counts (no OS acceleration) where the browser supports it
    const el = this.el as HTMLElement & { requestPointerLock(o?: { unadjustedMovement: boolean }): Promise<void> | void };
    const attempt = (raw: boolean): Promise<void> => {
      try { return Promise.resolve(raw ? el.requestPointerLock({ unadjustedMovement: true }) : el.requestPointerLock()); }
      catch (e) { return Promise.reject(e); }
    };
    // raw input is refused on some systems: fall back to the ordinary lock, and if that is refused too stay paused
    attempt(true).catch(() => attempt(false)).catch(() => { /* no pointer lock here */ });
  }

  unlock(): void { if (document.pointerLockElement) document.exitPointerLock(); }

  /**
   * Fullscreen with the game keys captured. Outside fullscreen the browser keeps Ctrl+W (slide + forward) for
   * itself and closes the tab; inside it, the Keyboard Lock API (Chrome, Edge) hands those keys to the page.
   */
  fullscreen(on: boolean): void {
    if (this.noLock) return;
    type Kb = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
    const kb = (navigator as Navigator & { keyboard?: Kb }).keyboard;
    if (on) {
      if (document.fullscreenElement) return;
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
        .then(() => kb?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'Space', 'ControlLeft', 'ShiftLeft', 'Tab', 'Backspace']))
        .catch(() => { /* fullscreen refused: the game still works windowed */ });
    } else if (document.fullscreenElement) { kb?.unlock?.(); void document.exitFullscreen().catch(() => {}); }
  }

  release(): void { this.keys.clear(); this.wheel = 0; }

  private key(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!this.locked) return;
    if (['Space', 'Tab', 'ControlLeft', 'KeyC', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Backspace'].includes(e.code)) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Digit1') this.input.weapon = 0;
      if (e.code === 'Digit2') this.input.weapon = 1;
      if (e.code === 'Digit3') this.input.weapon = 2;
      if (e.code === 'KeyR') this.onCommand('checkpoint');
      if (e.code === 'KeyT') this.onCommand('stage');
      if (e.code === 'Backspace') this.onCommand('restart');
    } else this.keys.delete(e.code);
  }

  /** Fill in the held-key part of the input for the next tick. */
  sample(): Input {
    const k = this.keys, i = this.input;
    i.moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    i.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    i.sprint = this.save.autoSprint ? !shift : shift;
    i.crouch = k.has('ControlLeft') || k.has('KeyC');
    i.fire = k.has('Mouse0');
    i.dash = k.has('Mouse2') || k.has('KeyQ') || k.has('KeyE');
    // a wheel notch is a one-tick press followed by a one-tick release, so each notch is a fresh jump press
    let jump = k.has('Space');
    if (this.wheel > 0) {
      if (this.wheelPhase === 0) { jump = true; this.wheelPhase = 1; }
      else { jump = false; this.wheelPhase = 0; this.wheel--; }
    }
    i.jump = jump;
    return i;
  }
}
