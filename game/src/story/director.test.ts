import { describe, expect, it } from 'vitest';
import { CONTENT } from '../content';
import type { DomainEvent } from '../sim/events';
import { Director, type Cue } from './Director';
import { StoryState } from './StoryState';

type Phrase = Extract<DomainEvent, { type: 'phraseReleased' }>;

function setup() {
  const story = new StoryState(CONTENT);
  const said: string[] = [];
  const cues: Cue[] = [];
  const done: string[] = [];
  let caught = 0;
  const director = new Director(CONTENT, story, {
    groundY: (_x, _z, nearY) => nearY,
    say: (lines) => said.push(...lines),
    cue: (c) => cues.push(c),
    caught: () => caught++,
    stepCompleted: (s) => done.push(s.id),
  });
  const kit = { x: 0, y: 0.9, z: 0 };
  const release = (phrase: string, receiver: string | null = null, hit = true) => {
    const e: Phrase = {
      type: 'phraseReleased',
      phrase,
      receiver,
      judgement: hit ? 'hit' : 'late',
      offsetMs: 0,
    };
    story.handle(e); // missions see the event first, as in Game
    director.onPhrase(e, kit);
  };
  return { story, director, kit, release, said, cues, done, caughtCount: () => caught };
}

/** Play the current step the way a player would. */
function playStep(t: ReturnType<typeof setup>): void {
  const { director, kit, release, story } = t;
  director.update(1 / 60, kit, false);
  const step = director.step!;
  const tr = step.trigger;
  const stand = (x: number, z: number) => Object.assign(kit, { x, z });
  switch (tr.type) {
    case 'talk': {
      const a = director.actors.get(tr.npc)!;
      stand(a.x + 1, a.z);
      director.update(1 / 60, kit, true);
      break;
    }
    case 'use':
      stand(tr.position[0] + 1, tr.position[2]);
      director.update(1 / 60, kit, true);
      break;
    case 'reach':
    case 'collect':
      stand(tr.position[0], tr.position[2]);
      director.update(1 / 60, kit, false);
      break;
    case 'perform':
      stand(tr.position[0], tr.position[2]);
      for (let i = 0; i < tr.hits; i++) release(tr.phrase);
      break;
    case 'play':
      release(tr.phrase, tr.receiver);
      break;
    case 'fact': {
      const m = CONTENT.missions.find((x) => x.effects.facts.includes(tr.fact))!;
      release(m.trigger.phrase, tr.receiver);
      director.update(1 / 60, kit, false);
      break;
    }
    case 'defeat': {
      const e = director.actors.get(tr.enemy)!;
      for (let i = 0; i < 20 && story.currentStep === step; i++) {
        stand(e.x + 8, e.z);
        release('busk');
      }
      break;
    }
    case 'escort': {
      const first = director.actors.get(tr.npcs[0]!)!;
      stand(first.x + 1.5, first.z);
      const [gx, , gz] = tr.position;
      for (let i = 0; i < 4000 && story.currentStep === step; i++) {
        const d = Math.hypot(gx - kit.x, gz - kit.z);
        if (d > 0.05) stand(kit.x + ((gx - kit.x) / d) * 0.03, kit.z + ((gz - kit.z) / d) * 0.03);
        director.update(1 / 60, kit, false);
      }
      break;
    }
  }
}

describe('Director / campaign', () => {
  it('can be played from the first step to the ending', () => {
    const t = setup();
    for (const expected of CONTENT.steps) {
      expect(t.story.currentStep?.id).toBe(expected.id);
      playStep(t);
      expect(t.story.has(`step.${expected.id}`), `step ${expected.id} completes`).toBe(true);
    }
    expect(t.story.currentStep).toBeNull();
    expect(t.done).toEqual(CONTENT.steps.map((s) => s.id));
    for (const f of CONTENT.facts) expect(t.story.has(f.id), f.id).toBe(true);
    expect(t.story.rank).toEqual({ rank: 3, title: 'City Hero' });
    expect(t.story.activeVersion).toBe('openScore');
    for (const ch of CONTENT.chapters) expect(t.story.has(ch.completeFact)).toBe(true);
  });

  it('only counts on-beat releases with the right phrase inside the circle', () => {
    const t = setup();
    ['l1.amp', 'l1.tune'].forEach(() => playStep(t));
    t.director.update(1 / 60, t.kit, false);
    expect(t.director.step?.id).toBe('l1.play');
    Object.assign(t.kit, { x: 130, z: 330 });
    t.release('busk', null, false);
    expect(t.director.hits).toBe(0);
    Object.assign(t.kit, { x: 180, z: 330 });
    t.release('busk');
    expect(t.director.hits).toBe(0);
    Object.assign(t.kit, { x: 130, z: 330 });
    t.release('busk');
    expect(t.director.hits).toBe(1);
  });

  it('resets the fight when an enemy reaches Kit', () => {
    const t = setup();
    while (t.story.currentStep?.id !== 'l4.collector') playStep(t);
    t.director.update(1 / 60, t.kit, false);
    const foe = t.director.actors.get('collector')!;
    Object.assign(t.kit, { x: foe.x + 6, z: foe.z });
    t.release('closing');
    expect(foe.hp).toBe(2);
    for (let i = 0; i < 600 && t.caughtCount() === 0; i++) t.director.update(1 / 60, t.kit, false);
    expect(t.caughtCount()).toBe(1);
    expect(foe.hp).toBe(3);
    expect(t.story.currentStep?.id).toBe('l4.collector');
  });

  it('resumes mid-campaign from a snapshot', () => {
    const a = setup();
    while (a.story.currentStep?.id !== 'l3.mara') playStep(a);
    const b = setup();
    b.story.restore(a.story.snapshot());
    expect(b.story.currentStep?.id).toBe('l3.mara');
    expect(b.story.lastSafePad).toBe('pad.market.terminus');
    expect(b.story.learnedPhrases).toEqual(['busk', 'closing']);
  });
});
