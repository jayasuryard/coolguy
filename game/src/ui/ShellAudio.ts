import type { Settings } from '../platform/settings';

/**
 * Shell audio: one AudioContext for menus, pause, credits and UI sounds.
 *  - Music cues are composed in code (see SCORES below) and crossfade when the screen changes.
 *  - Drop a recording at game/public/assets/audio/<cue>-theme.mp3 to replace any cue.
 *  - Browsers only allow audio after a user gesture; requests before that wait for the first
 *    key press or click.
 */
export type Cue = 'menu' | 'pause' | 'credits';

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ================================================================ synth toolkit
type Out = AudioNode;

function env(
  ctx: AudioContext,
  out: Out,
  t: number,
  a: number,
  peak: number,
  hold: number,
  r: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.linearRampToValueAtTime(0.0001, t + a + hold + r);
  g.connect(out);
  return g;
}

function osc(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  t: number,
  end: number,
  out: Out,
  detune = 0,
) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(out);
  o.start(t);
  o.stop(end);
  return o;
}

/** Warm pad: detuned saws through a breathing low-pass. */
function pad(
  ctx: AudioContext,
  out: Out,
  notes: number[],
  t: number,
  len: number,
  level = 0.05,
  cut: [number, number] = [500, 1400],
) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 0.6;
  f.frequency.setValueAtTime(cut[0], t);
  f.frequency.linearRampToValueAtTime(cut[1], t + len * 0.55);
  f.frequency.linearRampToValueAtTime(cut[0] * 1.3, t + len);
  f.connect(env(ctx, out, t, Math.min(2.2, len * 0.3), level, Math.max(0, len - 2.8), 2.4));
  for (const n of notes)
    for (const d of [-8, 7]) osc(ctx, 'sawtooth', hz(n), t, t + len + 2.6, f, d);
}

function bass(
  ctx: AudioContext,
  out: Out,
  note: number,
  t: number,
  len: number,
  level = 0.15,
  type: OscillatorType = 'triangle',
) {
  osc(
    ctx,
    type,
    hz(note),
    t,
    t + len + 0.5,
    env(ctx, out, t, 0.08, level, Math.max(0, len - 0.6), 0.5),
  );
}

/** Plucked guitar: bright attack, filter closes, natural decay. */
function pluck(
  ctx: AudioContext,
  out: Out,
  note: number,
  t: number,
  level = 0.07,
  decay = 1.3,
  bright = 4200,
) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(bright, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(500, bright * 0.2), t + decay * 0.4);
  f.connect(g).connect(out);
  osc(ctx, 'triangle', hz(note), t, t + decay + 0.1, f);
  osc(ctx, 'sine', hz(note) * 2, t, t + decay + 0.1, f);
}

/** Bell / chime: inharmonic-ish partials, exponential decay. */
function bell(ctx: AudioContext, out: Out, note: number, t: number, level = 0.05, decay = 3) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  g.connect(out);
  for (const [m, a] of [
    [1, 1],
    [2.01, 0.32],
    [3.98, 0.1],
  ]) {
    const og = ctx.createGain();
    og.gain.value = a;
    og.connect(g);
    osc(ctx, 'sine', hz(note) * m, t, t + decay + 0.05, og);
  }
}

function noise(ctx: AudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Short filtered-noise hit: hats, shakers, clock ticks, UI clicks. */
function hit(
  ctx: AudioContext,
  out: Out,
  t: number,
  level: number,
  freq: number,
  len = 0.05,
  type: BiquadFilterType = 'highpass',
) {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx, len + 0.02);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = type === 'bandpass' ? 4 : 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.connect(f).connect(g).connect(out);
  n.start(t);
  n.stop(t + len + 0.02);
}

/** Soft felt kick. */
function kick(ctx: AudioContext, out: Out, t: number, level = 0.22) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.4);
}

function swell(ctx: AudioContext, out: Out, t: number, len: number, level = 0.03) {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx, len + 0.5);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(2500, t);
  f.frequency.linearRampToValueAtTime(7000, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + len * 0.95);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.4);
  n.connect(f).connect(g).connect(out);
  n.start(t);
  n.stop(t + len + 0.5);
}

// ================================================================ scores
interface Score {
  bpm: number;
  /** Bars per scheduling step. */
  barsPerStep: number;
  /** Called once per step with its start time; `step` counts up from 0 forever. */
  step(ctx: AudioContext, out: Out, t: number, step: number, bar: number): void;
}

/** Main menu — "Golden Hour": G major, I–vi–IV–V, Kit's clean guitar over brushed drums. */
const MENU: Score = (() => {
  const C = [
    {
      root: 43,
      pad: [55, 59, 62, 66],
      arp: [67, 71, 74, 79, 74, 71, 74, 71],
      lead: [71, 74, 76, 74],
    }, // Gmaj7
    {
      root: 40,
      pad: [52, 55, 59, 62],
      arp: [64, 67, 71, 76, 71, 67, 71, 67],
      lead: [76, 74, 71, 74],
    }, // Em7
    {
      root: 36,
      pad: [52, 55, 60, 64],
      arp: [64, 67, 72, 76, 72, 67, 72, 67],
      lead: [72, 76, 79, 76],
    }, // C
    {
      root: 38,
      pad: [54, 57, 62, 64],
      arp: [66, 69, 74, 78, 74, 69, 74, 69],
      lead: [78, 76, 74, 69],
    }, // Dsus/D
  ];
  return {
    bpm: 84,
    barsPerStep: 2,
    step(ctx, out, t, step) {
      const beat = 60 / this.bpm;
      const len = beat * 4 * this.barsPerStep;
      const c = C[step % 4]!;
      const cycle = Math.floor(step / 4);
      pad(ctx, out, c.pad, t, len, 0.035, [600, 1700]);
      bass(ctx, out, c.root, t, beat * 3.5, 0.14);
      bass(ctx, out, c.root + 7, t + beat * 4, beat * 3.5, 0.1);
      // guitar: quarters on the first pass, swung eighths after
      const eighth = beat / 2;
      const count = cycle === 0 ? 8 : 16;
      for (let i = 0; i < count; i++) {
        const swing = cycle === 0 ? 0 : i % 2 ? eighth * 0.16 : 0;
        const at = t + i * (cycle === 0 ? beat : eighth) + swing;
        pluck(ctx, out, c.arp[i % 8]!, at, i % 4 === 0 ? 0.07 : 0.05, 1.2, 4800);
      }
      if (cycle >= 1) {
        for (let b = 0; b < 8; b++) {
          const at = t + b * beat;
          if (b % 2 === 0) kick(ctx, out, at, 0.16);
          hit(ctx, out, at + eighth * 1.16, 0.035, 7000, 0.04);
          for (let s = 0; s < 4; s++) hit(ctx, out, at + s * (beat / 4), 0.012, 9000, 0.025);
        }
      }
      if (cycle >= 2 && cycle % 2 === 0) {
        c.lead.forEach((n, i) =>
          pluck(ctx, out, n + 12, t + beat * (2 + i * 1.5), 0.055, 2.2, 3600),
        );
      }
      if (step % 4 === 3) {
        bell(ctx, out, 86, t + beat * 6, 0.03, 3.5); // the tram bell
        bell(ctx, out, 81, t + beat * 6.5, 0.025, 3.5);
        swell(ctx, out, t + len - beat * 4, beat * 4, 0.02);
      }
    },
  };
})();

/** Pause — "Inside the Clock Room": hushed D, drone, tick-tock, distant bells. */
const PAUSE: Score = (() => {
  const C = [
    { root: 38, pad: [50, 57, 62, 64], bell: 74 }, // Dsus2
    { root: 35, pad: [47, 54, 57, 61], bell: 73 }, // Bm(add9)
    { root: 31, pad: [43, 55, 57, 62], bell: 69 }, // G(add9)
    { root: 33, pad: [45, 57, 62, 64], bell: 76 }, // Asus4
  ];
  return {
    bpm: 52,
    barsPerStep: 2,
    step(ctx, out, t, step) {
      const beat = 60 / this.bpm;
      const len = beat * 4 * this.barsPerStep;
      const c = C[step % 4]!;
      pad(ctx, out, c.pad, t, len, 0.03, [320, 760]);
      bass(ctx, out, c.root, t, len, 0.09, 'sine');
      for (let b = 0; b < 8; b++) {
        hit(ctx, out, t + b * beat, 0.025, b % 2 ? 2600 : 3400, 0.035, 'bandpass'); // tick… tock
      }
      bell(ctx, out, c.bell, t + beat * 1, 0.022, 5);
      if (step % 2 === 1) bell(ctx, out, c.bell - 5, t + beat * 5, 0.016, 5);
    },
  };
})();

/** Credits — "Closing Call": Bm–G–D–A at 66 bpm, strings, guitar, the two-note motif. */
const CREDITS: Score = (() => {
  const C = [
    { root: 35, pad: [59, 62, 66, 71], arp: [71, 74, 78, 83, 78, 74, 71, 66], motif: [78, 74] },
    { root: 31, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79, 74, 71, 67, 62], motif: [79, 74] },
    { root: 38, pad: [57, 62, 66, 69], arp: [69, 74, 78, 81, 78, 74, 69, 66], motif: [78, 73] },
    { root: 33, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81, 76, 73, 69, 64], motif: [76, 69] },
  ];
  return {
    bpm: 66,
    barsPerStep: 2,
    step(ctx, out, t, step) {
      const beat = 60 / this.bpm;
      const len = beat * 4 * this.barsPerStep;
      const c = C[step % 4]!;
      const cycle = Math.floor(step / 4);
      pad(ctx, out, c.pad, t, len, 0.06);
      bass(ctx, out, c.root, t, len, 0.16);
      if (cycle >= 1)
        for (let i = 0; i < 16; i++)
          pluck(ctx, out, c.arp[i % 8]!, t + i * (beat / 2), i % 8 === 0 ? 0.09 : 0.06, 1.4);
      if (cycle >= 1 || step % 4 >= 2)
        c.motif.forEach((n, i) => bell(ctx, out, n, t + beat * 4 + i * beat * 1.5, 0.05, 3.5));
      if (step % 4 === 3) swell(ctx, out, t + len - beat * 4, beat * 4, 0.035);
    },
  };
})();

const SCORES: Record<Cue, Score> = { menu: MENU, pause: PAUSE, credits: CREDITS };
const CUE_LEVEL: Record<Cue, number> = { menu: 0.85, pause: 0.7, credits: 0.8 };

// ================================================================ engine
interface Voice {
  cue: Cue;
  gain: GainNode;
  timer: number;
  next: number;
  step: number;
  media: HTMLAudioElement | null;
}

export class ShellAudio {
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private voice: Voice | null = null;
  private recordings = new Map<Cue, string | null>();
  private wanted: Cue | null = null;
  private unlocked = false;

  constructor(private readonly settings: () => Settings) {
    const unlock = () => {
      this.unlocked = true;
      this.ensure();
      void this.ctx!.resume().then(() => {
        if (this.wanted && !this.voice) void this.play(this.wanted);
      });
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  /** Crossfade to a music cue (null fades the music out). */
  async play(cue: Cue | null): Promise<void> {
    this.wanted = cue;
    if (this.voice?.cue === cue) return;
    this.fadeOut(this.voice);
    this.voice = null;
    if (!cue || !this.unlocked) return;
    this.ensure();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (this.wanted !== cue) return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicBus!);
    const v: Voice = { cue, gain, timer: 0, next: ctx.currentTime + 0.1, step: 0, media: null };
    this.voice = v;
    gain.gain.linearRampToValueAtTime(
      CUE_LEVEL[cue],
      ctx.currentTime + (cue === 'pause' ? 1.6 : 3),
    );

    const url = await this.recording(cue);
    if (this.voice !== v) return;
    if (url) {
      v.media = new Audio(url);
      v.media.loop = true;
      ctx.createMediaElementSource(v.media).connect(gain);
      void v.media.play().catch(() => {});
      return;
    }
    const score = SCORES[cue];
    const stepLen = (60 / score.bpm) * 4 * score.barsPerStep;
    const tick = () => {
      while (v.next < ctx.currentTime + 0.35) {
        score.step(ctx, gain, v.next, v.step, v.step * score.barsPerStep);
        v.step++;
        v.next += stepLen;
      }
    };
    tick();
    v.timer = window.setInterval(tick, 50);
  }

  /** Live volume / output changes from Settings. */
  refresh(): void {
    if (!this.ctx) return;
    const s = this.settings();
    const t = this.ctx.currentTime;
    this.musicBus!.gain.setTargetAtTime(0.9 * s.masterVolume * s.musicVolume, t, 0.2);
    this.sfxBus!.gain.setTargetAtTime(0.9 * s.masterVolume * s.effectsVolume, t, 0.05);
    this.ctx.destination.channelCount = s.audioOutput === 'mono' ? 1 : 2;
  }

  // ---------------------------------------------------------------- UI sounds
  /** Highlight moved to item `index` in a list: a ting that rises down the list. */
  move(index = 0): void {
    const steps = [84, 86, 88, 91, 93, 96, 98];
    this.sfx((ctx, out, t) => bell(ctx, out, steps[index % steps.length]!, t, 0.045, 0.45));
  }
  select(): void {
    this.sfx((ctx, out, t) => {
      bell(ctx, out, 79, t, 0.05, 0.6);
      bell(ctx, out, 86, t + 0.07, 0.055, 0.9);
      pluck(ctx, out, 67, t, 0.04, 0.6);
    });
  }
  back(): void {
    this.sfx((ctx, out, t) => {
      bell(ctx, out, 86, t, 0.045, 0.5);
      bell(ctx, out, 79, t + 0.07, 0.04, 0.7);
    });
  }
  tab(): void {
    this.sfx((ctx, out, t) => {
      hit(ctx, out, t, 0.16, 3200, 0.035, 'bandpass');
      bell(ctx, out, 88, t + 0.01, 0.04, 0.35);
    });
  }
  /** Slider moved: pitch follows the value (0–1). */
  slide(value: number): void {
    this.sfx((ctx, out, t) => {
      const g = env(ctx, out, t, 0.004, 0.035, 0.02, 0.05);
      osc(ctx, 'sine', hz(72 + Math.round(value * 24)), t, t + 0.1, g);
    });
  }
  toggle(on = true): void {
    this.sfx((ctx, out, t) => {
      bell(ctx, out, on ? 81 : 88, t, 0.04, 0.35);
      bell(ctx, out, on ? 88 : 81, t + 0.06, 0.04, 0.45);
    });
  }
  confirm(): void {
    this.sfx((ctx, out, t) =>
      [79, 83, 86, 91].forEach((n, i) => bell(ctx, out, n, t + i * 0.055, 0.045, 1.1)),
    );
  }
  denied(): void {
    this.sfx((ctx, out, t) => {
      const g = env(ctx, out, t, 0.005, 0.09, 0.03, 0.15);
      osc(ctx, 'sine', 70, t, t + 0.25, g);
      hit(ctx, out, t, 0.04, 400, 0.08, 'lowpass');
    });
  }
  pauseIn(): void {
    this.sfx((ctx, out, t) => {
      bell(ctx, out, 74, t, 0.045, 1.2);
      bell(ctx, out, 69, t + 0.09, 0.035, 1.4);
    });
  }
  pauseOut(): void {
    this.sfx((ctx, out, t) => {
      bell(ctx, out, 69, t, 0.035, 0.8);
      bell(ctx, out, 76, t + 0.08, 0.045, 1.0);
    });
  }

  // ---------------------------------------------------------------- internals
  private sfx(play: (ctx: AudioContext, out: Out, t: number) => void): void {
    if (!this.unlocked) return;
    this.ensure();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') void ctx.resume();
    play(ctx, this.sfxBus!, ctx.currentTime + 0.005);
  }

  private ensure(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(3, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    reverb.connect(wet).connect(comp);

    this.musicBus = ctx.createGain();
    this.musicBus.connect(comp);
    this.musicBus.connect(reverb);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(comp);
    const sfxVerb = ctx.createGain();
    sfxVerb.gain.value = 0.35;
    this.sfxBus.connect(sfxVerb).connect(reverb);
    this.refresh();
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  private fadeOut(v: Voice | null): void {
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + 1.4);
    window.clearInterval(v.timer);
    window.setTimeout(() => {
      v.media?.pause();
      v.gain.disconnect();
    }, 3500);
  }

  /** URL of a recorded replacement for this cue, if one exists. */
  private async recording(cue: Cue): Promise<string | null> {
    if (this.recordings.has(cue)) return this.recordings.get(cue)!;
    const url = `${import.meta.env.BASE_URL}assets/audio/${cue}-theme.mp3`;
    let found: string | null = null;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok && (res.headers.get('content-type') ?? '').startsWith('audio')) found = url;
    } catch {
      /* use the composed score */
    }
    this.recordings.set(cue, found);
    return found;
  }

  /** Dev/QA: current cue and output level. */
  get debug() {
    return {
      cue: this.voice?.cue ?? null,
      ctx: this.ctx,
      music: this.musicBus,
      sfx: this.sfxBus,
      unlocked: this.unlocked,
    };
  }
}
