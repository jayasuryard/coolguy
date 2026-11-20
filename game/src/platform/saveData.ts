import { VERSION_IDS, type VersionId } from '@content/types';

/** Save contract (Developer doc). Settings live elsewhere. */
export interface SaveData {
  schemaVersion: number;
  contentVersion: string;
  revision: number;
  lastSafePad: string;
  activeVersion: VersionId;
  unlockedVersions: VersionId[];
  learnedPhrases: string[];
  questFacts: string[];
  completedStories: string[];
  endingChoice: string | null;
  /** Loose change earned busking and fighting. */
  coins: number;
}

export const SCHEMA_VERSION = 2;

const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Structural validation. Returns a list of problems (empty = valid). */
export function validateSave(d: unknown): string[] {
  const p: string[] = [];
  if (typeof d !== 'object' || d === null) return ['not an object'];
  const s = d as Record<string, unknown>;
  if (typeof s.schemaVersion !== 'number') p.push('schemaVersion');
  if (typeof s.contentVersion !== 'string') p.push('contentVersion');
  if (typeof s.revision !== 'number' || s.revision < 0) p.push('revision');
  if (typeof s.lastSafePad !== 'string' || !s.lastSafePad) p.push('lastSafePad');
  if (!VERSION_IDS.includes(s.activeVersion as VersionId)) p.push('activeVersion');
  if (
    !isStrArr(s.unlockedVersions) ||
    !s.unlockedVersions.every((v) => VERSION_IDS.includes(v as VersionId))
  )
    p.push('unlockedVersions');
  else if (!s.unlockedVersions.includes(s.activeVersion as string))
    p.push('activeVersion not unlocked');
  if (!isStrArr(s.learnedPhrases)) p.push('learnedPhrases');
  if (!isStrArr(s.questFacts)) p.push('questFacts');
  if (!isStrArr(s.completedStories)) p.push('completedStories');
  if (s.endingChoice !== null && typeof s.endingChoice !== 'string') p.push('endingChoice');
  if (typeof s.coins !== 'number' || s.coins < 0) p.push('coins');
  return p;
}

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

/**
 * migrations[n] upgrades schema n → n+1. Add one per schema bump; never edit old ones.
 * Fixtures in fixtures/saves/ must keep loading through this chain.
 */
const migrations: Record<number, Migration> = {
  // v2: money
  1: (old) => ({ ...old, schemaVersion: 2, coins: 0 }),
};

export function migrateSave(raw: unknown): SaveData {
  let d = { ...(raw as Record<string, unknown>) };
  let v = Number(d.schemaVersion);
  if (!Number.isInteger(v) || v < 1)
    throw new Error(`unknown schemaVersion ${String(d.schemaVersion)}`);
  if (v > SCHEMA_VERSION) throw new Error(`save is from a newer build (schema ${v})`);
  while (v < SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new Error(`no migration from schema ${v}`);
    d = m(d);
    v = Number(d.schemaVersion);
  }
  const problems = validateSave(d);
  if (problems.length) throw new Error(`invalid save: ${problems.join(', ')}`);
  return d as unknown as SaveData;
}

export function newGameSave(contentVersion: string, spawnPad: string): SaveData {
  return {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    revision: 0,
    lastSafePad: spawnPad,
    activeVersion: 'timetable',
    unlockedVersions: ['timetable'],
    learnedPhrases: [],
    questFacts: [],
    completedStories: [],
    endingChoice: null,
    coins: 0,
  };
}
