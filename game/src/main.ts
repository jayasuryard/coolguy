import './style.css';
import { setupSettingsDialog } from './boot/settingsDialog';
import { CONTENT, CONTENT_VERSION } from './content';
import { probeCapabilities } from './platform/capabilities';
import { newGameSave, type SaveData } from './platform/saveData';
import { SaveStore } from './platform/SaveStore';
import { loadSettings } from './platform/settings';

/**
 * Boot path (Developer doc): serve shell + settings first, probe WebGL 2 and storage
 * independently, and only build the world after a Start gesture (which also unlocks audio).
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (t: string) => ($('boot-status').textContent = t);

const settings = loadSettings();
$('btn-settings').addEventListener('click', setupSettingsDialog(settings));

const caps = await probeCapabilities();
const coarseOnly =
  matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

if (!caps.webgl2 || coarseOnly) {
  $('compat').hidden = false;
  $('menu').hidden = true;
  $('compat-reason').textContent = !caps.webgl2
    ? 'WebGL 2 is unavailable. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration on.'
    : 'coolguy is desktop-first. Touch controls are not ready yet — please use a laptop or desktop.';
  status('');
} else {
  let store: SaveStore | null = null;
  let existing: SaveData | null = null;
  const notes: string[] = [];

  if (caps.indexedDB) {
    try {
      store = await SaveStore.open();
      const loaded = await store.loadLatest();
      existing = loaded?.save ?? null;
      if (loaded?.recoveredFromPrevious)
        notes.push('Latest save was damaged; restored the previous checkpoint.');
    } catch (err) {
      console.error(err);
      notes.push('Couldn’t read saves. You can still play a temporary session and export it.');
    }
  } else {
    notes.push('Storage is unavailable: this will be a temporary session (use Export save).');
  }
  if (!caps.webAudio) notes.push('Audio is unavailable: playing with captions and silent timing.');

  $<HTMLButtonElement>('btn-new').disabled = false;
  $<HTMLButtonElement>('btn-continue').disabled = !existing;
  status(notes.join(' ') || 'Ready.');

  const startGame = async (save: SaveData) => {
    $<HTMLButtonElement>('btn-new').disabled = $<HTMLButtonElement>('btn-continue').disabled = true;
    status('Loading the quay…');

    // The click is the gesture that unlocks audio.
    let audio: AudioContext | null = null;
    if (caps.webAudio) {
      try {
        audio = new AudioContext({ latencyHint: 'interactive' });
        await audio.resume();
      } catch {
        audio = null;
        status('Audio failed to start: continuing with captions and silent timing.');
      }
    }

    try {
      const { Game } = await import('./Game');
      const game = await Game.create($('app'), { audio, settings, saveStore: store, save });
      $('shell').hidden = true;
      game.start();
      if (import.meta.env.DEV) {
        const { installDevPanel } = await import('./debug/DevPanel');
        installDevPanel(game, settings);
        (window as unknown as { game: unknown }).game = game;
      } else {
        $('dev-line').hidden = true;
      }
      import.meta.hot?.dispose(() => game.stop());
    } catch (err) {
      console.error(err);
      status(`Failed to start: ${(err as Error).message}. Reload to retry.`);
    }
  };

  $('btn-continue').addEventListener('click', () => existing && void startGame(existing));
  $('btn-new').addEventListener('click', async () => {
    let save = newGameSave(CONTENT_VERSION, CONTENT.world.spawnPad);
    if (store) {
      try {
        save = await store.commit(save, await store.currentRevision());
      } catch (err) {
        console.error(err);
        status('Couldn’t create a save; playing a temporary session.');
        store = null;
      }
    }
    await startGame(save);
  });
}
