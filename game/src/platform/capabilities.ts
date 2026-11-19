/** Independent capability probes run before Start (Developer doc: boot path). */
export interface Capabilities {
  webgl2: boolean;
  indexedDB: boolean;
  webAudio: boolean;
}

export function probeWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const ok = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

export async function probeIndexedDB(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') return false;
    return await new Promise<boolean>((resolve) => {
      const req = indexedDB.open('coolguy-probe');
      req.onsuccess = () => {
        req.result.close();
        indexedDB.deleteDatabase('coolguy-probe');
        resolve(true);
      };
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function probeCapabilities(): Promise<Capabilities> {
  return {
    webgl2: probeWebGL2(),
    indexedDB: await probeIndexedDB(),
    webAudio: typeof AudioContext !== 'undefined',
  };
}
