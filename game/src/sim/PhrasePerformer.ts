import type { ActionEvent } from '../input/InputSystem';
import { judgeRelease, nearestMarkedBeat, type JudgeResult } from '../transport/timing';
import type { Transport } from '../transport/Transport';

export interface PhraseOptions {
  windowMs: number;
  calibrationMs: number;
  assisted: boolean;
  holdAsTwoTaps: boolean;
}

/**
 * "Hold Play to strum, release on the marked beat."
 * Judgement uses the input event's own timestamp mapped onto the audio timeline, so it is
 * independent of render frame rate. The marked beat is the nearest bar downbeat.
 */
export class PhrasePerformer {
  strumming = false;

  constructor(private readonly transport: Transport) {}

  /** Returns a judgement when a phrase is released, otherwise null. */
  handle(
    press: ActionEvent | null,
    release: ActionEvent | null,
    opts: PhraseOptions,
  ): (JudgeResult & { targetBeat: number }) | null {
    if (opts.holdAsTwoTaps) {
      if (!press) return null;
      if (!this.strumming) {
        this.strumming = true;
        return null;
      }
      return this.finish(press, opts);
    }

    if (press && !this.strumming) this.strumming = true;
    if (release && this.strumming) {
      if (release.cancelled) {
        this.strumming = false; // focus lost mid-hold: cancel, don't judge
        return null;
      }
      return this.finish(release, opts);
    }
    return null;
  }

  cancel(): void {
    this.strumming = false;
  }

  private finish(e: ActionEvent, opts: PhraseOptions) {
    this.strumming = false;
    if (!this.transport.judging) return null;
    const t = this.transport.source.perfToTime(e.time);
    const beat = nearestMarkedBeat(this.transport.grid, t, this.transport.beatsPerBar);
    const target = this.transport.timeOfBeat(beat);
    return { ...judgeRelease(t, target, opts), targetBeat: beat };
  }
}
