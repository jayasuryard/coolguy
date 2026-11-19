/** Player settings — persisted separately from saves, in localStorage. */
export interface Settings {
  assistedRelease: boolean;
  /** Turn "hold then release" into two taps. */
  holdAsTwoTaps: boolean;
  /** Output-latency calibration added to timing judgement (ms). */
  calibrationMs: number;
  musicVolume: number;
  effectsVolume: number;
  dialogueVolume: number;
  monoMix: boolean;
  captions: boolean;
  captionScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  /** action → list of input codes; overrides the defaults in input/actions.ts. */
  bindings: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  assistedRelease: false,
  holdAsTwoTaps: false,
  calibrationMs: 0,
  musicVolume: 0.8,
  effectsVolume: 0.8,
  dialogueVolume: 1,
  monoMix: false,
  captions: true,
  captionScale: 1,
  reducedMotion: false,
  highContrast: false,
  bindings: {},
};

const KEY = 'coolguy.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
