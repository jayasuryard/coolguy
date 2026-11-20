import type { Cue } from '../story/Director';

/** Open-string-ish voicings per phrase (Hz). */
const CHORDS: Record<string, number[]> = {
  busk: [110, 164.81, 220, 277.18, 329.63], // A
  closing: [146.83, 220, 293.66, 369.99, 440], // D
  shutter: [164.81, 246.94, 329.63, 415.3, 493.88, 659.25], // E, rising
  spare: [196, 293.66, 392, 493.88, 587.33, 783.99], // G, bright
};

/**
 * Kit's guitar and the small gameplay stings, synthesised on the game's AudioContext so they
 * share the transport's clock. No samples: plucks are filtered saw/triangle pairs.
 */
export class Guitar {
  private readonly out: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    private volume: () => number,
  ) {
    this.out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    this.out.connect(comp).connect(ctx.destination);
  }

  private pluck(freq: number, at: number, gain: number, decay: number, bright = 3200): void {
    const { ctx } = this;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(bright, at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, bright * 0.18), at + decay);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain * this.volume() + 0.0001, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    for (const [type, detune] of [
      ['sawtooth', -4],
      ['triangle', 5],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(lp);
      o.start(at);
      o.stop(at + decay + 0.05);
    }
    lp.connect(g).connect(this.out);
  }

  /** The muted scratch when Kit starts holding. */
  mute(): void {
    const t = this.ctx.currentTime;
    [110, 146.83, 196].forEach((f, i) => this.pluck(f, t + i * 0.012, 0.1, 0.07, 900));
  }

  /** The released phrase: a full strum on a hit, a choked one otherwise. */
  release(phrase: string, hit: boolean): void {
    const notes = CHORDS[phrase] ?? CHORDS.busk!;
    const t = this.ctx.currentTime;
    if (!hit) {
      notes.slice(0, 3).forEach((f, i) => this.pluck(f, t + i * 0.015, 0.12, 0.12, 700));
      return;
    }
    const gap = phrase === 'shutter' ? 0.07 : 0.022;
    notes.forEach((f, i) => this.pluck(f, t + i * gap, 0.16, 1.6, 3600));
    if (phrase === 'spare') this.pluck(notes[notes.length - 1]! * 2, t + 0.2, 0.08, 1.2, 6000);
  }

  private ping(freq: number, at: number, gain: number, decay: number, type: OscillatorType): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain * this.volume() + 0.0001, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    o.connect(g).connect(this.out);
    o.start(at);
    o.stop(at + decay + 0.05);
  }

  /** The tram's bell: two bright strokes. */
  bell(): void {
    const t = this.ctx.currentTime + 0.02;
    for (const at of [0, 0.34]) {
      this.ping(1568, t + at, 0.11, 0.9, 'sine');
      this.ping(2349, t + at, 0.05, 0.6, 'sine');
      this.ping(3136, t + at, 0.025, 0.35, 'triangle');
    }
  }

  cue(kind: Cue): void {
    const t = this.ctx.currentTime + 0.02;
    switch (kind) {
      case 'coin':
        this.ping(2093, t + 0.25, 0.1, 0.25, 'sine');
        this.ping(2637, t + 0.33, 0.1, 0.4, 'sine');
        break;
      case 'pickup':
        [880, 1174.66, 1760].forEach((f, i) => this.ping(f, t + i * 0.07, 0.1, 0.3, 'triangle'));
        break;
      case 'step':
        [587.33, 739.99, 880].forEach((f, i) => this.ping(f, t + 0.3 + i * 0.1, 0.09, 0.5, 'sine'));
        break;
      case 'enemyHit':
        this.ping(92, t, 0.3, 0.3, 'square');
        this.ping(1480, t, 0.06, 0.12, 'square');
        break;
      case 'enemyDown':
        [392, 311.13, 233.08, 155.56, 98].forEach((f, i) =>
          this.ping(f, t + i * 0.13, 0.16, 0.5, 'sawtooth'),
        );
        break;
      case 'caught':
        [220, 207.65, 196].forEach((f, i) => this.ping(f, t + i * 0.16, 0.16, 0.35, 'square'));
        break;
    }
  }
}
