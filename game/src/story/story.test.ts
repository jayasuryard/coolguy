import { describe, expect, it } from 'vitest';
import { CONTENT } from '../content';
import type { DomainEvent } from '../sim/events';
import { cellAt, resolveCell } from './cells';
import { StoryState } from './StoryState';

const clockHit: DomainEvent = {
  type: 'phraseReleased',
  phrase: 'closing',
  receiver: 'receiver.quay.clock',
  judgement: 'hit',
  offsetMs: 12,
};

const PREREQS = ['rescue.tram', 'defeated.collector', 'key.quay.lower', 'phrase.closing'];

describe('StoryState / Punch Clock mission', () => {
  it('ignores the trigger until every prerequisite fact is present', () => {
    const s = new StoryState(CONTENT);
    expect(s.handle(clockHit)).toHaveLength(0);
    PREREQS.slice(0, 3).forEach((f) => s.grant(f));
    expect(s.handle(clockHit)).toHaveLength(0);
  });

  it('commits all effects together and awards Rank 1', () => {
    const s = new StoryState(CONTENT);
    PREREQS.forEach((f) => s.grant(f));
    expect(s.rank.rank).toBe(0);
    const done = s.handle(clockHit);
    expect(done.map((m) => m.id)).toEqual(['mission.quay.clock']);
    expect(s.has('machine.quay.clock')).toBe(true);
    expect(s.unlockedVersions.has('backstage')).toBe(true);
    expect(s.activeVersion).toBe('backstage');
    expect(s.lastSafePad).toBe('pad.quay.lower');
    expect(s.rank).toEqual({ rank: 1, title: 'Protector' });
  });

  it('is idempotent: a repeated unlock event awards nothing twice', () => {
    const s = new StoryState(CONTENT);
    PREREQS.forEach((f) => s.grant(f));
    s.handle(clockHit);
    s.setActiveVersion('timetable');
    expect(s.handle(clockHit)).toHaveLength(0);
    expect(s.activeVersion).toBe('timetable'); // revisit doesn't replay the mission
  });

  it('requires a hit on the right receiver with the right phrase', () => {
    const s = new StoryState(CONTENT);
    PREREQS.forEach((f) => s.grant(f));
    expect(s.handle({ ...clockHit, judgement: 'late' })).toHaveLength(0);
    expect(s.handle({ ...clockHit, receiver: 'receiver.quay.tramLamp' })).toHaveLength(0);
    expect(s.handle({ ...clockHit, phrase: 'shutter' })).toHaveLength(0);
  });

  it('round-trips through a snapshot', () => {
    const a = new StoryState(CONTENT);
    PREREQS.forEach((f) => a.grant(f));
    a.handle(clockHit);
    const b = new StoryState(CONTENT);
    b.restore(a.snapshot());
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.rank.rank).toBe(1);
  });
});

describe('cells', () => {
  it('locates cells and rejects positions outside the envelope', () => {
    expect(cellAt(CONTENT.world, 150, 340)).toEqual({ col: 2, row: 5 });
    expect(cellAt(CONTENT.world, -1, 10)).toBeNull();
    expect(cellAt(CONTENT.world, 10, 10_000)).toBeNull();
  });

  it('applies version overlays: hide + add; floors only for greybox worlds', () => {
    const ids = (v: 'timetable' | 'backstage') =>
      resolveCell(CONTENT.world, CONTENT.versions, 4, 4, v).map((o) => o.id);
    expect(ids('timetable')).toContain('quay.stall.crate');
    expect(ids('timetable')).not.toContain('backstage.quay.gangway');
    expect(ids('backstage')).not.toContain('quay.stall.crate');
    expect(ids('backstage')).toContain('backstage.quay.gangway');
    // The island city provides terrain, so no auto floor slab…
    expect(ids('backstage')).not.toContain('cell.4.4.floor');
    // …but greybox worlds still get one.
    const greybox = { ...CONTENT.world, autoFloors: true };
    expect(resolveCell(greybox, CONTENT.versions, 4, 4, 'timetable').map((o) => o.id)).toContain(
      'cell.4.4.floor',
    );
  });
});
