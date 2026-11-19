import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../content';
import { findObject } from '../story/cells';
import { migrateSave, newGameSave, validateSave } from './saveData';
import { SaveStore, StaleRevisionError, exportSave, importSave } from './SaveStore';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/saves', import.meta.url));
let dbCounter = 0;
const freshStore = () => SaveStore.open(`test-${dbCounter++}`);

describe('save fixtures', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));

  it('has fixtures', () => expect(files.length).toBeGreaterThan(0));

  for (const file of files) {
    it(`${file} migrates, validates and has a walkable pad`, () => {
      const save = migrateSave(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')));
      expect(validateSave(save)).toEqual([]);
      expect(findObject(CONTENT.world, CONTENT.versions, save.lastSafePad)?.kind).toBe('pad');
    });
  }
});

describe('saveData', () => {
  it('rejects saves from a newer build and broken shapes', () => {
    const s = newGameSave('0.1.0', 'pad.quay.home');
    expect(() => migrateSave({ ...s, schemaVersion: 99 })).toThrow(/newer build/);
    expect(() => migrateSave({ ...s, activeVersion: 'backstage' })).toThrow(/not unlocked/);
  });

  it('export → import round-trips', () => {
    const s = { ...newGameSave('0.1.0', 'pad.quay.home'), revision: 3 };
    expect(importSave(exportSave(s))).toEqual(s);
  });
});

describe('SaveStore (IndexedDB)', () => {
  it('commits revisions and keeps the previous one', async () => {
    const store = await freshStore();
    expect(await store.loadLatest()).toBeNull();
    const base = newGameSave('0.1.0', 'pad.quay.home');
    const r1 = await store.commit(base, 0);
    const r2 = await store.commit({ ...base, questFacts: ['job.1.complete'] }, r1.revision);
    expect(r2.revision).toBe(2);
    const latest = await store.loadLatest();
    expect(latest?.save.questFacts).toEqual(['job.1.complete']);
    expect(latest?.recoveredFromPrevious).toBe(false);
    store.close();
  });

  it('detects a stale second tab instead of overwriting', async () => {
    const store = await freshStore();
    const base = newGameSave('0.1.0', 'pad.quay.home');
    await store.commit(base, 0); // tab A → revision 1
    await store.commit(base, 1); // tab A → revision 2
    await expect(store.commit(base, 1)).rejects.toBeInstanceOf(StaleRevisionError); // tab B is behind
    expect(await store.currentRevision()).toBe(2);
    store.close();
  });
});
