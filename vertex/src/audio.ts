// Every sound is synthesised with the Web Audio API: no assets to load.
export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private drone!: GainNode;
  volume = 0.7;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // wind: looping noise through a band-pass that opens up with speed
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = 300; filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.wind = { gain, filter };

    // a low drone for the void
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220;
    for (const f of [55, 55.4, 82.4, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    lp.connect(this.drone).connect(this.master);
  }

  setVolume(v: number): void { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  /** Called every frame: speed in m/s, whether the game is live. */
  ambient(speed: number, live: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, Math.max(0, (speed - 6) / 26));
    this.wind.gain.gain.setTargetAtTime(live ? 0.02 + k * 0.5 : 0, t, 0.08);
    this.wind.filter.frequency.setTargetAtTime(260 + k * 1800, t, 0.08);
    this.drone.gain.setTargetAtTime(live ? 0.05 : 0.025, t, 0.5);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'lowpass', q = 0.8, delay = 0): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  jump(): void { this.tone('triangle', 190, 330, 0.09, 0.12); }
  wallJump(): void { this.tone('square', 240, 520, 0.09, 0.08); this.burst(0.07, 0.15, 1800, 500); }
  land(speed: number): void { const v = Math.min(1, speed / 22); if (v > 0.12) { this.burst(0.1 + v * 0.1, 0.12 + v * 0.35, 500 + v * 500, 70); this.tone('sine', 110, 45, 0.12, v * 0.3); } }
  slide(): void { this.burst(0.35, 0.16, 2400, 500, 'bandpass', 1.2); }
  shotgun(): void { this.burst(0.28, 0.9, 5200, 180); this.tone('sine', 150, 38, 0.3, 0.9); this.tone('square', 90, 40, 0.1, 0.25); }
  pistol(): void { this.tone('sawtooth', 1300, 240, 0.09, 0.22); this.burst(0.05, 0.25, 6000, 1500, 'highpass'); }
  rail(): void { this.tone('sawtooth', 2600, 70, 0.5, 0.4); this.tone('sine', 60, 30, 0.6, 0.7); this.burst(0.4, 0.5, 9000, 300, 'bandpass', 2); }
  dryFire(): void { this.tone('square', 900, 700, 0.03, 0.08); }
  reload(): void { this.tone('square', 520, 780, 0.04, 0.05); }
  dash(): void { this.burst(0.3, 0.6, 400, 5200, 'bandpass', 1.5); this.tone('sawtooth', 160, 720, 0.2, 0.18); }
  chargeGain(): void { this.tone('sine', 660, 660, 0.12, 0.28); this.tone('sine', 990, 990, 0.2, 0.28, 0.08); this.tone('triangle', 1980, 1980, 0.25, 0.1, 0.08); }
  chargeFull(): void { this.tone('sine', 990, 990, 0.1, 0.12); }
  noCharge(): void { this.tone('square', 150, 110, 0.12, 0.14); }
  hit(): void { this.tone('square', 1500, 1200, 0.04, 0.11); }
  weakHit(): void { this.tone('triangle', 2400, 3200, 0.08, 0.2); }
  kill(): void { this.burst(0.3, 0.5, 3200, 200); this.tone('sawtooth', 500, 60, 0.3, 0.3); this.tone('sine', 1320, 1760, 0.18, 0.2, 0.03); }
  hurt(): void { this.tone('sawtooth', 220, 70, 0.22, 0.45); this.burst(0.15, 0.35, 900, 200); }
  death(): void { this.tone('sawtooth', 420, 36, 0.55, 0.5); this.burst(0.5, 0.5, 2500, 80); }
  respawn(): void { this.tone('sine', 220, 660, 0.14, 0.14); }
  checkpoint(): void { [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.16, i * 0.07)); }
  stage(): void { [392, 523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.18, i * 0.09)); }
  finish(): void { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { this.tone('triangle', f, f, 0.9, 0.2, i * 0.11); this.tone('sine', f / 2, f / 2, 0.9, 0.14, i * 0.11); }); }
  enemyShot(): void { this.tone('square', 700, 180, 0.16, 0.1); }
  telegraph(): void { this.tone('square', 1100, 1100, 0.06, 0.07); this.tone('square', 1100, 1100, 0.06, 0.07, 0.12); }
  beam(): void { this.tone('sawtooth', 1800, 90, 0.35, 0.35); this.burst(0.3, 0.4, 7000, 400, 'bandpass', 3); }
  boom(): void { this.burst(0.12, 0.12, 1400, 200); }
  switchOn(): void { this.tone('square', 440, 880, 0.08, 0.14); this.tone('sine', 1320, 1320, 0.3, 0.14, 0.06); }
  anchor(): void { this.tone('sawtooth', 180, 900, 0.3, 0.22); this.tone('sine', 1200, 600, 0.3, 0.12); }
  target(done: boolean): void { this.tone('triangle', done ? 1760 : 1175, done ? 1760 : 1175, 0.12, 0.2); }
  targetFail(): void { this.tone('square', 300, 200, 0.1, 0.06); }
  dissolve(): void { this.burst(0.4, 0.14, 3000, 6000, 'highpass'); }
  rebuild(): void { this.tone('sine', 300, 900, 0.3, 0.07); }
  ui(): void { this.tone('square', 880, 880, 0.03, 0.06); }
}
