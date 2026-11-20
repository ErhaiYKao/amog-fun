// HUD: plain DOM over the canvas. Reads the Game each frame and reacts to its events.
import type { Game } from './sim/game.ts';
import type { Ev } from './sim/player.ts';
import { feetOf, hspeed } from './sim/player.ts';
import { T, WEAPONS, SHOTGUN } from './sim/tuning.ts';
import { formatTime } from './settings.ts';
import type { Save } from './settings.ts';

const $ = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

export class Hud {
  private el = {
    hud: $('hud'), stageN: $('stage-n'), stageName: $('stage-name'), mode: $('mode-tag'), timer: $('timer'), split: $('split'),
    deaths: $('deaths'), speed: $('speed'), height: $('height'), healthBar: $('health-bar'), healthN: $('health-n'),
    charges: $('charges'), cross: $('cross-charges'), ammo: $('ammo'), weapon: $('weapon-name'), slots: $('slots'),
    hint: $('hint'), toast: $('toast'), warn: $('warn'), vignette: $('vignette'), speedlines: $('speedlines'),
    hit: document.querySelector<HTMLElement>('#crosshair .hit')!, fade: $('fade'),
  };
  private last: Record<string, string | number> = {};
  private hintText = '';
  private splitT = 0;
  private save: Save;

  constructor(save: Save) { this.save = save; }

  show(on: boolean): void { this.el.hud.hidden = !on; }

  private set(key: string, el: HTMLElement, value: string | number): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = String(value);
  }

  private cls(key: string, el: HTMLElement, name: string, on: boolean): void {
    if (this.last[key] === (on ? 1 : 0)) return;
    this.last[key] = on ? 1 : 0;
    el.classList.toggle(name, on);
  }

  toast(text: string, kind: '' | 'big' | 'bad' = ''): void {
    const t = this.el.toast;
    t.textContent = text;
    t.className = '';
    void t.offsetWidth;        // restart the animation
    t.className = `on ${kind}`;
  }

  flash(kind: 'flash' | 'death'): void {
    const f = this.el.fade;
    f.className = '';
    void f.offsetWidth;
    f.className = kind;
  }

  handle(ev: Ev, game: Game): void {
    switch (ev.type) {
      case 'shot':
        if (ev.hit) {
          const h = this.el.hit;
          h.className = 'hit';
          void h.offsetWidth;
          h.className = ev.kill ? 'hit kill' : 'hit on';
        }
        break;
      case 'charge':
        if (ev.delta > 0) {
          this.toast(`+1 CHARGE · ${ev.reason.toUpperCase()}`);
          this.el.charges.classList.remove('gain'); void this.el.charges.offsetWidth; this.el.charges.classList.add('gain');
        } else if (ev.delta === 0) this.toast('CHARGES FULL');
        break;
      case 'nocharge':
        this.el.charges.classList.remove('deny'); void this.el.charges.offsetWidth; this.el.charges.classList.add('deny');
        break;
      case 'checkpoint': if (game.mode === 'practice') this.toast('CHECKPOINT'); break;
      case 'stage': {
        const s = game.level.stages[ev.stage];
        this.toast(`STAGE ${String(ev.stage + 1).padStart(2, '0')} · ${s.name.toUpperCase()}`, 'big');
        this.el.split.textContent = `STAGE ${ev.stage} IN ${formatTime(game.splits[ev.stage - 1] ?? game.time)}`;
        this.splitT = 5;
        this.flash('flash');
        break;
      }
      case 'switch': if (ev.seconds > 0) this.toast(`GATE OPEN · ${ev.seconds.toFixed(1)} s`); else this.toast('PATH CHANGED'); break;
      case 'death': this.toast(ev.reason.toUpperCase(), 'bad'); this.flash('death'); break;
      case 'finish': this.flash('flash'); break;
      default: break;
    }
  }

  update(game: Game, dt: number): void {
    const p = game.player, e = this.el;
    const st = game.level.stages[game.stage];
    this.set('sn', e.stageN, String(game.stage + 1).padStart(2, '0'));
    this.set('sname', e.stageName, st.name.toUpperCase());
    this.set('mode', e.mode, game.mode === 'run' ? 'TOWER RUN' : 'PRACTICE');
    this.set('timer', e.timer, formatTime(game.time));
    this.set('deaths', e.deaths, game.deaths);
    this.set('speed', e.speed, hspeed(p).toFixed(1));
    this.set('height', e.height, `${Math.max(0, Math.round(feetOf(p)))} m`);
    const hp = Math.max(0, Math.ceil(p.health));
    this.set('hp', e.healthN, hp);
    if (this.last.hpw !== hp) { this.last.hpw = hp; e.healthBar.style.width = `${(hp / T.maxHealth) * 100}%`; }
    this.cls('low', e.healthBar, 'low', hp <= 35);
    for (let i = 0; i < T.maxCharges; i++) {
      this.cls(`c${i}`, e.charges.children[i] as HTMLElement, 'on', i < p.charges);
      this.cls(`x${i}`, e.cross.children[i] as HTMLElement, 'on', i < p.charges);
    }
    // ammo: shells for the shotgun, a recharge bar for the rail, nothing to count for the pistol
    const w = p.weapon;
    const ammoKey = w === 0 ? `s${p.shells}` : w === 1 ? 'p' : `r${Math.round(Math.max(0, 1 - Math.max(0, p.cool[2]) / WEAPONS[2].cycle) * 20)}`;
    if (this.last.ammo !== ammoKey) {
      this.last.ammo = ammoKey;
      if (w === 0) e.ammo.innerHTML = Array.from({ length: SHOTGUN.shells }, (_, i) => `<i class="${i < p.shells ? 'on' : ''}"></i>`).join('');
      else if (w === 1) e.ammo.innerHTML = '';
      else e.ammo.innerHTML = `<i class="bar"><b style="width:${Number(ammoKey.slice(1)) * 5}%"></b></i>`;
    }
    this.set('wname', e.weapon, WEAPONS[w].name.toUpperCase());
    if (this.last.slot !== w) {
      this.last.slot = w;
      [...e.slots.children].forEach((c, i) => c.classList.toggle('on', i === w));
    }
    // damage / low health vignette, speed tint
    const v = Math.max(0, 1 - game.hurtT / 0.6) * 0.9 + (hp <= 35 ? 0.35 : 0);
    e.vignette.style.opacity = v.toFixed(2);
    const total = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    e.speedlines.style.opacity = Math.min(1, Math.max(0, (total - 14) / 16)).toFixed(2);
    // a warden has you locked
    let locked = false;
    for (const en of game.enemies) if (en.alive && en.def.kind === 'warden' && en.state === 'lock') locked = true;
    this.cls('warn', e.warn, 'on', locked);
    // hints
    let text = '';
    if (this.save.hints && !game.finished) {
      for (const h of game.level.hints) {
        if (Math.abs(h.pos.y - feetOf(p)) < 2.5 && Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z) < h.r) { text = h.text; break; }
      }
    }
    if (text !== this.hintText) {
      this.hintText = text;
      if (text) e.hint.textContent = text;
      e.hint.classList.toggle('on', !!text);
    }
    if (this.splitT > 0) { this.splitT -= dt; if (this.splitT <= 0) e.split.textContent = ''; }
  }
}
