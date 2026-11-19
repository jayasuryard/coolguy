import type { ContentBundle, MissionDef, VersionId } from '@content/types';
import type { DomainEvent } from '../sim/events';

/**
 * Quest facts and world-version state. Every award is an idempotent fact; rank is derived,
 * never stored. Reducers ignore events whose award is already complete.
 */
export interface StorySnapshot {
  facts: string[];
  unlockedVersions: VersionId[];
  activeVersion: VersionId;
  lastSafePad: string;
}

export class StoryState {
  readonly facts = new Set<string>();
  readonly unlockedVersions = new Set<VersionId>(['timetable']);
  activeVersion: VersionId = 'timetable';
  lastSafePad: string;

  constructor(private readonly content: ContentBundle) {
    this.lastSafePad = content.world.spawnPad;
  }

  /** Adds a fact. Returns false if it was already known. */
  grant(fact: string): boolean {
    if (this.facts.has(fact)) return false;
    this.facts.add(fact);
    return true;
  }

  has(fact: string): boolean {
    return this.facts.has(fact);
  }

  /** Highest rank whose required set — and every lower rank's set — is complete. */
  get rank(): { rank: number; title: string } {
    let current = { rank: 0, title: 'Busker' };
    for (const r of this.content.ranks) {
      if (!r.requires.every((f) => this.facts.has(f))) break;
      current = { rank: r.rank, title: r.title };
    }
    return current;
  }

  get learnedPhrases(): string[] {
    return this.content.phrases.filter((p) => this.facts.has(p.fact)).map((p) => p.id);
  }

  setActiveVersion(v: VersionId): boolean {
    if (!this.unlockedVersions.has(v)) return false;
    this.activeVersion = v;
    return true;
  }

  /** Feed a domain event; returns the missions it completed (usually none). */
  handle(event: DomainEvent): MissionDef[] {
    const completed: MissionDef[] = [];
    if (event.type !== 'phraseReleased' || event.judgement !== 'hit') return completed;

    for (const m of this.content.missions) {
      const t = m.trigger;
      if (t.receiver !== event.receiver || t.phrase !== event.phrase) continue;
      if (m.effects.facts.every((f) => this.facts.has(f))) continue; // already awarded
      if (!m.requires.every((f) => this.facts.has(f))) continue;

      // Commit all effects together.
      m.effects.facts.forEach((f) => this.facts.add(f));
      m.effects.unlockVersions.forEach((v) => this.unlockedVersions.add(v));
      if (m.effects.activateVersion) this.activeVersion = m.effects.activateVersion;
      if (m.effects.returnPad) this.lastSafePad = m.effects.returnPad;
      completed.push(m);
    }
    return completed;
  }

  snapshot(): StorySnapshot {
    return {
      facts: [...this.facts].sort(),
      unlockedVersions: [...this.unlockedVersions],
      activeVersion: this.activeVersion,
      lastSafePad: this.lastSafePad,
    };
  }

  restore(s: StorySnapshot): void {
    this.facts.clear();
    s.facts.forEach((f) => this.facts.add(f));
    this.unlockedVersions.clear();
    this.unlockedVersions.add('timetable');
    s.unlockedVersions.forEach((v) => this.unlockedVersions.add(v));
    this.activeVersion = this.unlockedVersions.has(s.activeVersion) ? s.activeVersion : 'timetable';
    this.lastSafePad = s.lastSafePad;
  }
}
