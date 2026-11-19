import '@fontsource/saira/600-italic.css';
import '@fontsource/saira/700-italic.css';
import '@fontsource/saira/800-italic.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import './style.css';
import { CONTENT, CONTENT_VERSION } from './content';
import type { Game, Preloaded } from './Game';
import { probeCapabilities } from './platform/capabilities';
import { newGameSave, type SaveData } from './platform/saveData';
import { SaveStore } from './platform/SaveStore';
import { loadSettings, type Settings } from './platform/settings';
import { applySettingsToDocument } from './ui/documentSettings';
import { CreditsMusic } from './ui/CreditsMusic';
import { CreditsRoll } from './ui/CreditsRoll';
import { MenuNav } from './ui/menuNav';
import { SettingsScreen } from './ui/SettingsScreen';

/**
 * Shell flow (Developer doc boot path + UI Screen Instructions):
 *   Loading (real progress, retry) → Main menu → Game ⇄ Pause / Settings.
 * The shell is plain HTML over full-screen backgrounds; the game only reports pause/resume.
 */
type ScreenId = 'loading' | 'menu' | 'credits' | 'pause' | 'settings';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SCREENS: ScreenId[] = ['loading', 'menu', 'credits', 'pause', 'settings'];
let current: ScreenId | null = 'loading';
function show(id: ScreenId | null): void {
  if (current === 'credits' && id !== 'credits') {
    credits.close();
    music.stop();
  }
  current = id;
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== id;
}

let settings: Settings = loadSettings();
const credits = new CreditsRoll(() => settings.reducedMotion);
const music = new CreditsMusic(() => settings);
if (import.meta.env.DEV) (window as unknown as { creditsMusic: unknown }).creditsMusic = music;
applySettingsToDocument(settings);

let store: SaveStore | null = null;
let existing: SaveData | null = null;
let preloaded: Preloaded | null = null;
let game: Game | null = null;
let settingsReturn: ScreenId = 'menu';

// ---------------------------------------------------------------- loading
const TIPS = [
  'Hold Listen to learn a melody from a nearby resident.',
  'Release on the downbeat: the lamp flashes amber on beat one.',
  'Assisted release in Settings gives the same result with gentler timing.',
  'Ione holds the tram doors for exactly four beats.',
];
let tipTimer = 0;
function progress(fraction: number, status: string): void {
  const p = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  $('loading-bar').style.width = `${p}%`;
  $('loading-percent').textContent = `${p}%`;
  $('loading-status').textContent = status;
  document.querySelector('#screen-loading .progress')!.setAttribute('aria-valuenow', String(p));
}

async function boot(): Promise<void> {
  show('loading');
  $('loading-error').hidden = true;
  let tip = 0;
  window.clearInterval(tipTimer);
  tipTimer = window.setInterval(() => {
    tip = (tip + 1) % TIPS.length;
    $('loading-tip').textContent = TIPS[tip]!;
  }, 4500);

  progress(0.01, 'Checking your browser…');
  const caps = await probeCapabilities();
  const coarseOnly =
    matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (!caps.webgl2 || coarseOnly) {
    window.clearInterval(tipTimer);
    show('menu');
    $('compat').hidden = false;
    $('compat-reason').textContent = !caps.webgl2
      ? 'WebGL 2 is unavailable. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration on.'
      : 'coolguy is desktop-first. Touch controls are not ready yet — please use a laptop or desktop.';
    menuButtons.forEach(
      (b) => (b.disabled = b.dataset.action !== 'settings' && b.dataset.action !== 'credits'),
    );
    menuNav.reset();
    return;
  }

  const notes: string[] = [];
  progress(0.03, 'Finding your saves…');
  if (caps.indexedDB) {
    try {
      store ??= await SaveStore.open();
      const loaded = await store.loadLatest();
      existing = loaded?.save ?? null;
      if (loaded?.recoveredFromPrevious)
        notes.push('Latest save was damaged; restored the previous checkpoint.');
    } catch (err) {
      console.error(err);
      notes.push('Couldn’t read saves. You can still play and export a temporary session.');
    }
  } else {
    notes.push(
      'Storage is unavailable: this will be a temporary session (Export save from Pause).',
    );
  }
  if (!caps.webAudio) notes.push('Audio is unavailable: playing with captions and silent timing.');

  try {
    progress(0.06, 'Opening the station…');
    const { Game } = await import('./Game');
    progress(0.15, 'Waking the tram line…');
    preloaded = await Game.preload((f, s) => progress(0.15 + f * 0.85, s));
  } catch (err) {
    console.error(err);
    window.clearInterval(tipTimer);
    $('loading-status').textContent = 'Loading stopped.';
    $('loading-error-text').textContent =
      `Couldn’t load Bellweather (${(err as Error).message}). Check your connection and retry.`;
    $('loading-error').hidden = false;
    $('btn-retry').focus();
    return;
  }

  progress(1, 'Ready.');
  window.clearInterval(tipTimer);
  await new Promise((r) => setTimeout(r, 250));
  ($('menu-status') as HTMLElement).textContent = notes.join(' ');
  menuContinue.disabled = !existing;
  show('menu');
  menuNav.reset();
}
$('btn-retry').addEventListener('click', () => void boot());

// ---------------------------------------------------------------- main menu
const menuButtons = [
  ...document.querySelectorAll<HTMLButtonElement>('#screen-menu .menu-list button'),
];
const menuContinue = menuButtons.find((b) => b.dataset.action === 'continue')!;
const menuNav = new MenuNav(menuButtons, (action) => {
  if (action === 'new') void startNewGame();
  else if (action === 'continue' && existing) void startGame(existing);
  else if (action === 'settings') openSettings('menu');
  else if (action === 'credits') {
    show('credits');
    credits.open();
    void music.start(); // the click/Enter that opened Credits unlocks audio
  }
});

async function startNewGame(): Promise<void> {
  let save = newGameSave(CONTENT_VERSION, CONTENT.world.spawnPad);
  if (store) {
    try {
      save = await store.commit(save, await store.currentRevision());
    } catch (err) {
      console.error(err);
      $('menu-status').textContent = 'Couldn’t create a save; playing a temporary session.';
      store = null;
    }
  }
  await startGame(save);
}

async function startGame(save: SaveData): Promise<void> {
  if (!preloaded || game) return;
  // The menu click/Enter is the gesture that unlocks audio.
  let audio: AudioContext | null = null;
  if (typeof AudioContext !== 'undefined') {
    try {
      audio = new AudioContext({ latencyHint: 'interactive' });
      await audio.resume();
    } catch {
      audio = null;
    }
  }
  const { Game } = await import('./Game');
  game = Game.create(
    $('app'),
    {
      audio,
      settings,
      saveStore: store,
      save,
      ui: { onPause: showPause, onResume: () => show(null) },
    },
    preloaded,
  );
  show(null);
  game.start();
  if (import.meta.env.DEV) {
    const { installDevPanel } = await import('./debug/DevPanel');
    installDevPanel(game, settings);
    (window as unknown as { game: unknown }).game = game;
  } else {
    $('dev-line').hidden = true;
  }
  import.meta.hot?.dispose(() => game?.stop());
}

// ---------------------------------------------------------------- pause
const pauseButtons = [
  ...document.querySelectorAll<HTMLButtonElement>('#screen-pause .menu-list button'),
];
const pauseNav = new MenuNav(pauseButtons, (action) => {
  if (!game) return;
  if (action === 'resume') game.resume();
  else if (action === 'restart') {
    void game.restartCheckpoint().then((ok) => {
      if (ok) game?.resume();
      else $('pause-reason').textContent = 'No checkpoint saved yet.';
    });
  } else if (action === 'settings') openSettings('pause');
  else if (action === 'menu') location.reload(); // progress is kept at checkpoints
});
pauseButtons.find((b) => b.dataset.action === 'restart')!.disabled = false;

function showPause(reason: string): void {
  if (!game) return;
  const st = game.status();
  $('pause-district').textContent = st.district;
  $('pause-chapter').textContent = st.chapter;
  $('pause-objective').textContent = st.objective;
  $('pause-reason').textContent = reason === 'Paused.' ? '' : reason;
  $('screen-pause').classList.add('live');
  if (current !== 'settings') {
    show('pause');
    pauseNav.reset();
  }
}

// ---------------------------------------------------------------- settings
const settingsScreen = new SettingsScreen(
  settings,
  (s) => {
    settings = s;
    applySettingsToDocument(s);
    music.refreshVolume();
    game?.applySettings(s);
  },
  () => {
    show(settingsReturn);
    (settingsReturn === 'pause' ? pauseNav : menuNav).reset();
  },
);
function openSettings(from: ScreenId): void {
  settingsReturn = from;
  settingsScreen.open(settings);
  show('settings');
}

// ---------------------------------------------------------------- keyboard router
// Capture phase: when a menu screen is up, keys stop here and never reach gameplay input.
window.addEventListener(
  'keydown',
  (e) => {
    if (!current) return;
    let handled = false;
    if (current === 'menu') handled = menuNav.handleKey(e);
    else if (current === 'credits') {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Backspace') {
        show('menu');
        menuNav.reset();
        handled = true;
      } else handled = credits.handleKey(e);
    } else if (current === 'pause') {
      if (e.key === 'Escape') {
        game?.resume();
        handled = true;
      } else handled = pauseNav.handleKey(e);
    } else if (current === 'settings') handled = settingsScreen.handleKey(e);
    if (handled || current) e.stopPropagation();
  },
  { capture: true },
);

// Dev/QA: ?screen=pause|settings|menu|loading shows one screen standalone (supplied image backgrounds).
const qa = new URLSearchParams(location.search).get('screen') as ScreenId | null;
if (import.meta.env.DEV && qa && SCREENS.includes(qa)) {
  show(qa);
  if (qa === 'pause') {
    $('pause-district').textContent = 'Switchback Market';
    $('pause-chapter').textContent = 'Market Under Glass';
    $('pause-objective').textContent = 'Escort the vendors to the service stairs.';
    pauseNav.reset();
  } else if (qa === 'settings') openSettings('menu');
  else if (qa === 'menu') menuNav.reset();
  else if (qa === 'loading') progress(0.68, 'Loading the quay…');
  else if (qa === 'credits') {
    credits.open();
    void music.start(); // without a prior gesture this begins on the first key/click
  }
} else {
  void boot();
}
