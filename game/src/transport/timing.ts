/** Pure musical-timing math. All times are in seconds on the transport timeline. */

export interface Grid {
  /** Transport time of beat 0. */
  origin: number;
  bpm: number;
}

export const secondsPerBeat = (bpm: number): number => 60 / bpm;

export const beatAt = (g: Grid, t: number): number => (t - g.origin) / secondsPerBeat(g.bpm);

export const timeOfBeat = (g: Grid, beat: number): number =>
  g.origin + beat * secondsPerBeat(g.bpm);

/** Nearest beat index that is a multiple of `every` (every = beatsPerBar → downbeats). */
export function nearestMarkedBeat(g: Grid, t: number, every = 1): number {
  return Math.round(beatAt(g, t) / every) * every;
}

export type Judgement = 'hit' | 'early' | 'late';

export interface JudgeResult {
  judgement: Judgement;
  /** Negative = early. */
  offsetMs: number;
}

/**
 * Judge a release against its target beat time.
 * `calibrationMs` compensates output latency (positive = player hears audio later).
 * Assisted release grants an identical outcome (Design doc).
 */
export function judgeRelease(
  releaseTime: number,
  targetTime: number,
  opts: { windowMs: number; calibrationMs?: number; assisted?: boolean },
): JudgeResult {
  const offsetMs = (releaseTime - targetTime) * 1000 - (opts.calibrationMs ?? 0);
  if (opts.assisted || Math.abs(offsetMs) <= opts.windowMs) return { judgement: 'hit', offsetMs };
  return { judgement: offsetMs < 0 ? 'early' : 'late', offsetMs };
}
