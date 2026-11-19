import type { Settings } from '../platform/settings';

/**
 * Credits score, composed in code with Web Audio (no download, loops forever):
 *   slow vi–IV–I–V in D (Bm–G–D–A) at 66 bpm, string pads, soft bass, a plucked guitar arpeggio
 *   that enters on the second pass, and the "Closing Call" motif (a two-note descent) as a bell.
 * If game/public/assets/audio/credits-theme.mp3 exists, that recording is played instead.
 */
const RECORDED = 'assets/audio/credits-theme.mp3';
const BPM = 66;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const CHORD_BARS = 2;

// MIDI note numbers. Each chord: bass root + pad voicing + arpeggio tones.
const CHORDS = [
  { root: 35, pad: [59, 62, 66, 71], arp: [71, 74, 78, 83, 78, 74, 71, 66] }, // Bm
  { root: 31, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79, 74, 71, 67, 62] }, // G
  { root: 38, pad: [57, 62, 66, 69], arp: [69, 74, 78, 81, 78, 74, 69, 66] }, // D
  { root: 33, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81, 76, 73, 69, 64] }, // A
];
// Closing Call: descends two notes; answered on the next phrase.
const MOTIF = [
  [78, 74],
  [79, 74],
  [78, 73],
  [76, 69],
];
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class CreditsMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private timer = 0;
  private nextChordTime = 0;
  private chordIndex = 0;
  private cycles = 0;
  private recorded: HTMLAudioElement | null = null;
  private recordedChecked = false;
  private playing = false;
  private unlock = () => void this.ctx?.resume();

  constructor(private readonly settings: () => Settings) {}

  private get volume(): number {
    const s = this.settings();
    return 0.8 * s.masterVolume * s.musicVolume;
  }

  /** Start (or resume) with a fade-in. Call from a user gesture where possible. */
  async start(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    if (await this.startRecorded()) return;
    this.ensureGraph();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* resumed by the first gesture below */
      }
      // Autoplay policy: if the page had no gesture yet, start on the first one.
      window.addEventListener('pointerdown', this.unlock, { once: true });
      window.addEventListener('keydown', this.unlock, { once: true });
    }
    ctx.destination.channelCount = this.settings().audioOutput === 'mono' ? 1 : 2;
    const now = ctx.currentTime;
    this.master!.gain.cancelScheduledValues(now);
    this.master!.gain.setValueAtTime(this.master!.gain.value, now);
    this.master!.gain.linearRampToValueAtTime(this.volume, now + 3.5);
    this.chordIndex = 0;
    this.cycles = 0;
    this.nextChordTime = now + 0.15;
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(), 40);
    this.schedule();
  }

  /** Fade out and stop scheduling. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    if (this.recorded) {
      const a = this.recorded;
      const fade = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - 0.08);
        if (a.volume <= 0) {
          a.pause();
          window.clearInterval(fade);
        }
      }, 80);
      return;
    }
    window.clearInterval(this.timer);
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 1.2);
    const ctx = this.ctx;
    window.setTimeout(() => {
      if (!this.playing) void ctx.suspend();
    }, 1400);
  }

  /** Live volume changes from Settings while credits are playing. */
  refreshVolume(): void {
    if (this.recorded) this.recorded.volume = Math.min(1, this.volume / 0.8);
    if (this.ctx && this.master && this.playing) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.3);
    }
  }

  // ---------------------------------------------------------------- recorded track (optional)
  private async startRecorded(): Promise<boolean> {
    if (!this.recordedChecked) {
      this.recordedChecked = true;
      try {
        const res = await fetch(import.meta.env.BASE_URL + RECORDED, { method: 'HEAD' });
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && type.startsWith('audio')) {
          this.recorded = new Audio(import.meta.env.BASE_URL + RECORDED);
          this.recorded.loop = true;
        }
      } catch {
        /* no recording: use the composed score */
      }
    }
    if (!this.recorded) return false;
    this.recorded.currentTime = 0;
    this.recorded.volume = Math.min(1, this.volume / 0.8);
    await this.recorded.play().catch(() => {
      window.addEventListener('pointerdown', () => void this.recorded?.play(), { once: true });
      window.addEventListener('keydown', () => void this.recorded?.play(), { once: true });
    });
    return true;
  }

  // ---------------------------------------------------------------- synth graph
  private ensureGraph(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.bus = ctx.createGain();
    this.bus.gain.value = 0.85;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.bus.connect(this.master);
    this.bus.connect(this.reverb).connect(wet).connect(this.master);
  }

  /** Hall-like impulse response: stereo noise with an exponential tail. */
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

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    while (this.nextChordTime < ctx.currentTime + 0.3) {
      const t = this.nextChordTime;
      const c = CHORDS[this.chordIndex]!;
      const len = BAR * CHORD_BARS;
      this.pad(c.pad, t, len);
      this.bass(c.root, t, len);
      if (this.cycles >= 1) this.arpeggio(c.arp, t, len);
      if (this.cycles >= 1 || this.chordIndex >= 2) this.motif(MOTIF[this.chordIndex]!, t);
      if (this.chordIndex === 3) this.swell(t + len - BAR, BAR);
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      if (this.chordIndex === 0) this.cycles++;
      this.nextChordTime += len;
    }
  }

  /** String pad: two detuned saws per note through a breathing low-pass. */
  private pad(notes: number[], t: number, len: number): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.linearRampToValueAtTime(1400, t + len * 0.55);
    filter.frequency.linearRampToValueAtTime(700, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 2.2);
    g.gain.setValueAtTime(0.06, t + len - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 2.4);
    filter.connect(g).connect(this.bus!);
    for (const n of notes) {
      for (const detune of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n);
        o.detune.value = detune;
        o.connect(filter);
        o.start(t);
        o.stop(t + len + 2.6);
      }
    }
  }

  private bass(root: number, t: number, len: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(root);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.8);
    g.gain.setValueAtTime(0.16, t + len - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.4);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + len + 0.5);
  }

  /** Plucked guitar: bright attack, fast decay, eighth notes. */
  private arpeggio(notes: number[], t: number, len: number): void {
    const step = BEAT / 2;
    const count = Math.round(len / step);
    for (let i = 0; i < count; i++) {
      const n = notes[i % notes.length]!;
      this.pluck(n, t + i * step, i % 8 === 0 ? 0.09 : 0.06);
    }
  }

  private pluck(note: number, t: number, level: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(4200, t);
    tone.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    tone.connect(g).connect(this.bus!);
    for (const [mult, type] of [
      [1, 'triangle'],
      [2, 'sine'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(note) * mult;
      o.connect(tone);
      o.start(t);
      o.stop(t + 1.5);
    }
  }

  /** The Closing Call motif on a soft bell, high in the mix with long reverb. */
  private motif(notes: number[], t: number): void {
    notes.forEach((n, i) => this.bell(n, t + BAR + i * BEAT * 1.5, 0.05));
  }

  private bell(note: number, t: number, level: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    g.connect(this.bus!);
    for (const [mult, amp] of [
      [1, 1],
      [2.01, 0.35],
      [3.98, 0.12],
    ]) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      og.gain.value = amp;
      o.type = 'sine';
      o.frequency.value = hz(note) * mult;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 3.6);
    }
  }

  /** Filtered-noise swell into the next phrase (a soft suspended cymbal). */
  private swell(t: number, len: number): void {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2500, t);
    f.frequency.linearRampToValueAtTime(7000, t + len);
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + len * 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.4);
    n.connect(f).connect(g).connect(this.bus!);
    n.start(t);
    n.stop(t + len + 0.5);
  }
}
