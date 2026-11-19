/**
 * Fixed-timestep accumulator.
 * - Catch-up is capped (default 4 steps); any extra elapsed time is discarded, so an
 *   overloaded frame never advances a puzzle by several beats at once.
 * - While paused (hidden tab, pause menu) nothing accumulates, and resuming discards wall time.
 */
export class FixedStepLoop {
  private acc = 0;
  private _paused = false;

  constructor(
    readonly step: number,
    readonly maxSteps = 4,
  ) {}

  get paused(): boolean {
    return this._paused;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this.acc = 0;
  }

  /** Returns how many fixed steps to run now and the render interpolation factor. */
  advance(elapsedSeconds: number): { steps: number; alpha: number } {
    if (this._paused) return { steps: 0, alpha: 0 };
    this.acc += Math.max(0, elapsedSeconds);
    let steps = Math.floor(this.acc / this.step + 1e-9);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.acc = this.step * steps; // drop the backlog
    }
    this.acc = Math.max(0, this.acc - steps * this.step);
    return { steps, alpha: this.acc / this.step };
  }
}
