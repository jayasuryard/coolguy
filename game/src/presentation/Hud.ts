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
  private readonly objective = $('hud-objective');
  private readonly enemy = $('hud-enemy');
  private readonly enemyName = $('hud-enemy-name');
  private readonly enemyPips = $('hud-enemy-pips');
  private readonly card = $('story-card');
  private judgeTimer = 0;
  private objectiveText = '';
  private enemyKey = '';
  private readonly queue: string[] = [];
  private sayTimer = 0;

  /** Chapter title, objective and distance to it (metres; null = no waypoint). */
  setObjective(chapter: string, text: string | null, metres: number | null): void {
    const key = text ? `${chapter}|${text}|${metres === null ? '' : Math.round(metres)}` : '';
    if (key === this.objectiveText) return;
    this.objectiveText = key;
    this.objective.hidden = !text;
    if (!text) return;
    const b = document.createElement('b');
    b.textContent = chapter;
    this.objective.replaceChildren(
      b,
      metres !== null && metres > 4 ? `${text}  ·  ${Math.round(metres)} m` : text,
    );
  }

  setEnemy(name: string | null, hp = 0, max = 0): void {
    const key = name ? `${name}|${hp}|${max}` : '';
    if (key === this.enemyKey) return;
    this.enemyKey = key;
    this.enemy.hidden = !name;
    if (!name) return;
    this.enemyName.textContent = name;
    this.enemyPips.replaceChildren(
      ...Array.from({ length: max }, (_, i) => {
        const pip = document.createElement('i');
        if (i >= hp) pip.className = 'off';
        return pip;
      }),
    );
  }

  /** Queue story lines; they appear one at a time. "Speaker: text" highlights the speaker. */
  say(lines: string[]): void {
    this.queue.push(...lines);
  }

  /** Full-screen title card: fades in, holds, fades out. `midway` runs while it is opaque. */
  showCard(title: string, sub: string, midway: () => void, holdMs = 2600): void {
    $('story-card-title').textContent = title;
    $('story-card-sub').textContent = sub;
    this.card.hidden = false;
    void this.card.offsetWidth;
    this.card.classList.add('on');
    setTimeout(midway, 700);
    setTimeout(() => this.card.classList.remove('on'), 700 + holdMs);
    setTimeout(() => {
      if (!this.card.classList.contains('on')) this.card.hidden = true;
    }, 1500 + holdMs);
  }

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
    if ((this.sayTimer -= dt) <= 0 && this.queue.length) {
      const line = this.queue.shift()!;
      this.caption(line);
      this.sayTimer = Math.min(4.2, 1.6 + line.length * 0.045);
    }
  }

  /** True while story lines are still waiting to be shown. */
  get speaking(): boolean {
    return this.queue.length > 0;
  }

  caption(text: string): void {
    const line = document.createElement('p');
    const m = /^([A-Z][\w’' ]{1,22}): (.*)$/s.exec(text);
    if (m) {
      const b = document.createElement('b');
      b.textContent = `${m[1]}  `;
      line.append(b, m[2]!);
    } else line.textContent = text;
    this.captions.append(line);
    setTimeout(() => line.remove(), 5500);
  }
}
