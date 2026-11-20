/** Node-side loader for content/ (the game uses Vite imports instead). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBundle } from '../content/types.ts';

/** KIT_* root node names from every .glb in a directory (reads only the JSON chunk). */
export function readKitNames(modelDir: string): string[] {
  const names: string[] = [];
  let files: string[];
  try {
    files = readdirSync(modelDir).filter((f) => f.endsWith('.glb'));
  } catch {
    return names;
  }
  for (const f of files) {
    const b = readFileSync(join(modelDir, f));
    if (b.toString('utf8', 0, 4) !== 'glTF') continue;
    const jsonLen = b.readUInt32LE(12);
    const gltf = JSON.parse(b.toString('utf8', 20, 20 + jsonLen)) as {
      nodes?: { name?: string }[];
    };
    for (const n of gltf.nodes ?? []) if (n.name?.startsWith('KIT_')) names.push(n.name);
  }
  return names;
}

export function loadContent(root: string, modelDir?: string): ContentBundle {
  const read = <T>(...p: string[]): T => JSON.parse(readFileSync(join(root, ...p), 'utf8')) as T;
  const missionDir = join(root, 'missions');
  return {
    world: read('world', 'world.json'),
    versions: read('world', 'versions.json'),
    facts: read('story', 'facts.json'),
    ranks: read('story', 'ranks.json'),
    phrases: read('story', 'phrases.json'),
    chapters: read('story', 'chapters.json'),
    actors: read('story', 'actors.json'),
    steps: read('story', 'steps.json'),
    missions: readdirSync(missionDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => read('missions', f)),
    ...(modelDir ? { modelNames: readKitNames(modelDir) } : {}),
  };
}
