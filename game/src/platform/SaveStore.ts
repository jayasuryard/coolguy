import { migrateSave, type SaveData } from './saveData';

/**
 * IndexedDB save store.
 * Each commit writes the new checkpoint, keeps the previous valid revision, and moves the
 * pointer — all in one transaction. The expected revision is compared inside the transaction,
 * so a stale second tab is detected instead of overwriting newer progress.
 */
export class StaleRevisionError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`save revision is ${actual}, expected ${expected} (another tab saved?)`);
  }
}

interface Pointer {
  current: number;
  previous: number | null;
}

const DB_NAME = 'coolguy';
const SAVES = 'saves';
const META = 'meta';

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

export class SaveStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = DB_NAME): Promise<SaveStore> {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore(SAVES, { keyPath: 'revision' });
      db.createObjectStore(META);
    };
    return new SaveStore(await req(open));
  }

  close(): void {
    this.db.close();
  }

  /** Commit a checkpoint on top of `expectedRevision` (0 when there is no save yet). */
  commit(data: Omit<SaveData, 'revision'>, expectedRevision: number): Promise<SaveData> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([SAVES, META], 'readwrite');
      const saves = tx.objectStore(SAVES);
      const meta = tx.objectStore(META);
      let written: SaveData | null = null;

      const get = meta.get('pointer') as IDBRequest<Pointer | undefined>;
      get.onsuccess = () => {
        const ptr = get.result;
        const actual = ptr?.current ?? 0;
        if (actual !== expectedRevision) {
          tx.abort();
          reject(new StaleRevisionError(expectedRevision, actual));
          return;
        }
        written = { ...data, revision: actual + 1 };
        saves.put(written);
        meta.put(
          { current: written.revision, previous: ptr?.current ?? null } satisfies Pointer,
          'pointer',
        );
        // Keep only current + previous.
        if (ptr?.previous != null) saves.delete(ptr.previous);
      };
      tx.oncomplete = () => (written ? resolve(written) : reject(new Error('commit failed')));
      tx.onerror = () => reject(tx.error ?? new Error('save transaction failed'));
    });
  }

  /** Latest valid checkpoint (migrated), falling back to the previous revision on corruption. */
  async loadLatest(): Promise<{ save: SaveData; recoveredFromPrevious: boolean } | null> {
    const tx = this.db.transaction([SAVES, META], 'readonly');
    const ptr = (await req(tx.objectStore(META).get('pointer'))) as Pointer | undefined;
    if (!ptr) return null;
    const current = await req(tx.objectStore(SAVES).get(ptr.current));
    const previous =
      ptr.previous != null ? await req(tx.objectStore(SAVES).get(ptr.previous)) : null;
    try {
      return { save: migrateSave(current), recoveredFromPrevious: false };
    } catch {
      if (previous) return { save: migrateSave(previous), recoveredFromPrevious: true };
      throw new Error('save is corrupted and no previous revision exists');
    }
  }

  async currentRevision(): Promise<number> {
    const tx = this.db.transaction(META, 'readonly');
    const ptr = (await req(tx.objectStore(META).get('pointer'))) as Pointer | undefined;
    return ptr?.current ?? 0;
  }
}

/** User-initiated export / import for device moves and storage eviction. */
export const exportSave = (s: SaveData): string => JSON.stringify(s, null, 2);
export const importSave = (json: string): SaveData => migrateSave(JSON.parse(json));
