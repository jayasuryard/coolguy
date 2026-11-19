/** Player settings — persisted separately from saves, in localStorage. */
export type ShadowQuality = 'off' | 'low' | 'high';
export type AudioOutput = 'stereo' | 'mono';

export interface Settings {
  // Display
  renderScale: number; // 0.5–1 of device pixels
  shadows: ShadowQuality;
  fov: number; // degrees
  // Audio (0–1)
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  dialogueVolume: number;
  audioOutput: AudioOutput;
  // Controls
  mouseSensitivity: number; // multiplier, 0.25–2
  invertY: boolean;
  /** Turn "hold then release" into two taps. */
  holdAsTwoTaps: boolean;
  /** action → input codes; overrides the defaults in input/actions.ts. */
  bindings: Record<string, string[]>;
  // Accessibility
  assistedRelease: boolean;
  /** Output-latency calibration added to timing judgement (ms). */
  calibrationMs: number;
  captions: boolean;
  captionScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  renderScale: 1,
  shadows: 'high',
  fov: 60,
  masterVolume: 0.8,
  musicVolume: 0.65,
  effectsVolume: 0.85,
  dialogueVolume: 0.9,
  audioOutput: 'stereo',
  mouseSensitivity: 1,
  invertY: false,
  holdAsTwoTaps: false,
  bindings: {},
  assistedRelease: false,
  calibrationMs: 0,
  captions: true,
  captionScale: 1,
  reducedMotion: false,
  highContrast: false,
};

const KEY = 'coolguy.settings.v1';

/** Defaults merged with whatever valid keys were stored (unknown/legacy keys are dropped). */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    for (const k of Object.keys(out)) {
      if (k in stored && typeof stored[k] === typeof out[k]) out[k] = stored[k];
    }
    if (stored.monoMix === true) out.audioOutput = 'mono'; // pre-v2 setting
    return out as unknown as Settings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
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
