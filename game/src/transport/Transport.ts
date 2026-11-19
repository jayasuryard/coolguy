import { beatAt, timeOfBeat, type Grid } from './timing';

/**
 * Musical reference clock. AudioContext time while audio runs; monotonic time in silent mode.
 * Both expose the same interface so judgement code never cares which is active.
 */
export interface TimeSource {
  readonly kind: 'audio' | 'silent';
  /** Scheduling time, seconds. */
  now(): number;
  /** Map a performance.now()-based input timestamp onto the timeline the player hears. */
  perfToTime(perfMs: number): number;
}

export class SilentTimeSource implements TimeSource {
  readonly kind = 'silent';
  now(): number {
    return performance.now() / 1000;
  }
  perfToTime(perfMs: number): number {
    return perfMs / 1000;
  }
}

export class AudioTimeSource implements TimeSource {
  readonly kind = 'audio';
  private pair = { ctx: 0, perf: 0 };
  private lastRefresh = -Infinity;

  constructor(readonly ctx: AudioContext) {}

  now(): number {
    return this.ctx.currentTime;
  }

  perfToTime(perfMs: number): number {
    if (performance.now() - this.lastRefresh > 500) this.refresh();
    return this.pair.ctx + (perfMs - this.pair.perf) / 1000;
  }

  /** Refresh the (context time, performance time) pair. getOutputTimestamp includes output latency. */
  refresh(): void {
    const ts = this.ctx.getOutputTimestamp?.();
    if (
      ts?.contextTime !== undefined &&
      ts.performanceTime !== undefined &&
      ts.performanceTime > 0
    ) {
      this.pair = { ctx: ts.contextTime, perf: ts.performanceTime };
    } else {
      this.pair = { ctx: this.ctx.currentTime, perf: performance.now() };
    }
    this.lastRefresh = performance.now();
  }
}

type BeatListener = (beat: number, time: number) => void;

/**
 * Beat grid + lookahead scheduler (25 ms timer, 100 ms horizon).
 * Pausing suspends cues; resuming counts in one bar before judgement restarts.
 */
export class Transport {
  readonly grid: Grid;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private readonly listeners = new Set<BeatListener>();
  private _paused = true;

  constructor(
    readonly source: TimeSource,
    bpm: number,
    readonly beatsPerBar: number,
    private readonly intervalMs = 25,
    private readonly aheadS = 0.1,
  ) {
    this.grid = { origin: 0, bpm };
  }

  get paused(): boolean {
    return this._paused;
  }

  /** Start (or restart) with a count-in; beats are negative during the count-in. */
  start(countInBars = 1): void {
    this.grid.origin =
      this.source.now() + 0.05 + countInBars * this.beatsPerBar * (60 / this.grid.bpm);
    this.nextBeat = Math.ceil(beatAt(this.grid, this.source.now()));
    this._paused = false;
    this.timer ??= setInterval(() => this.schedule(), this.intervalMs);
    this.schedule();
  }

  pause(): void {
    this._paused = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.source instanceof AudioTimeSource) void this.source.ctx.suspend().catch(() => {});
  }

  async resume(): Promise<void> {
    if (this.source instanceof AudioTimeSource) {
      await this.source.ctx.resume().catch(() => {});
      this.source.refresh();
    }
    this.start(1);
  }

  onBeat(fn: BeatListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Beat position (float) of what the player is hearing right now. */
  heardBeat(): number {
    return beatAt(this.grid, this.source.perfToTime(performance.now()));
  }

  /** Judgement is suspended while paused or counting in. */
  get judging(): boolean {
    return !this._paused && this.heardBeat() >= 0;
  }

  timeOfBeat(beat: number): number {
    return timeOfBeat(this.grid, beat);
  }

  dispose(): void {
    this.pause();
    this.listeners.clear();
  }

  private schedule(): void {
    if (this._paused) return;
    const horizon = this.source.now() + this.aheadS;
    while (timeOfBeat(this.grid, this.nextBeat) < horizon) {
      const t = timeOfBeat(this.grid, this.nextBeat);
      for (const fn of this.listeners) fn(this.nextBeat, t);
      this.nextBeat++;
    }
  }
}

/** Placeholder cue sound until recorded motifs exist: a short click, accented on downbeats. */
export function scheduleClick(
  ctx: AudioContext,
  time: number,
  accent: boolean,
  volume: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1320 : 880;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.25 * volume, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.08);
}
