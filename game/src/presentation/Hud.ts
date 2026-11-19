import type { VersionDef } from '@content/types';

const $ = (id: string) => document.getElementById(id)!;

/**
 * Semantic HTML HUD: one actionable prompt, version icon, current phrase, beat lamp,
 * and a live caption region for cue sources and feedback.
 */
export class Hud {
  private readonly root = $('hud');
  private readonly prompt = $('hud-prompt');
  private readonly version = $('hud-version');
  private readonly phrase = $('hud-phrase');
  private readonly lamp = $('hud-lamp');
  private readonly judge = $('hud-judge');
  private readonly rank = $('hud-rank');
  private readonly captions = $('captions');
  private judgeTimer = 0;

  show(v: boolean): void {
    this.root.hidden = !v;
  }

  setPrompt(text: string | null): void {
    this.prompt.textContent = text ?? '';
    this.prompt.hidden = !text;
  }

  setVersion(v: VersionDef): void {
    this.version.textContent = `${v.icon} ${v.name}`;
    this.version.title = v.description;
  }

  setPhrase(name: string | null, strumming: boolean): void {
    this.phrase.textContent = name ? `${strumming ? '♫ ' : ''}${name}` : 'No phrase learned';
  }

  setRank(title: string): void {
    this.rank.textContent = title;
  }

  /** beat: heard beat position (float). Negative = count-in. */
  setBeat(beat: number, beatsPerBar: number, reducedMotion: boolean): void {
    const phase = beat - Math.floor(beat);
    const downbeat = ((Math.floor(beat) % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
    const glow = reducedMotion ? (phase < 0.2 ? 1 : 0.3) : Math.max(0.25, 1 - phase * 1.6);
    this.lamp.style.opacity = String(glow);
    this.lamp.dataset.downbeat = String(downbeat);
    this.lamp.dataset.countin = String(beat < 0);
  }

  flashJudgement(text: string, dt = 0): void {
    this.judge.textContent = text;
    this.judgeTimer = 1.5 + dt;
  }

  tick(dt: number): void {
    if (this.judgeTimer > 0 && (this.judgeTimer -= dt) <= 0) this.judge.textContent = '';
  }

  caption(text: string): void {
    const line = document.createElement('p');
    line.textContent = text;
    this.captions.append(line);
    setTimeout(() => line.remove(), 5000);
  }
}
