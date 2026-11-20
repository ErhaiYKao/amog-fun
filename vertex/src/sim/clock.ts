// Fixed-step clock: turns uneven frame times into whole 120 Hz ticks plus an interpolation fraction.
import { DT } from './tuning.ts';

export class Stepper {
  acc = 0;
  alpha = 0;
  /** Seconds of real time in, number of ticks to run out. Long gaps (a suspended tab) are dropped, not replayed. */
  advance(seconds: number): number {
    if (!(seconds > 0)) return 0;
    this.acc += Math.min(seconds, 0.1);
    let n = 0;
    while (this.acc >= DT) { this.acc -= DT; n++; }
    this.alpha = this.acc / DT;
    return n;
  }
  reset(): void { this.acc = 0; this.alpha = 0; }
}
