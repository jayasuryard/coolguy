import { saveSettings, type Settings } from '../platform/settings';

type Field =
  | { key: keyof Settings; label: string; type: 'bool' }
  | { key: keyof Settings; label: string; type: 'range'; min: number; max: number; step: number };

const FIELDS: Field[] = [
  { key: 'assistedRelease', label: 'Assisted release', type: 'bool' },
  { key: 'holdAsTwoTaps', label: 'Hold → two taps', type: 'bool' },
  {
    key: 'calibrationMs',
    label: 'Audio latency offset (ms)',
    type: 'range',
    min: -150,
    max: 150,
    step: 1,
  },
  { key: 'musicVolume', label: 'Music volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'effectsVolume', label: 'Effects volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'dialogueVolume', label: 'Dialogue volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'monoMix', label: 'Mono mix', type: 'bool' },
  { key: 'captions', label: 'Captions', type: 'bool' },
  { key: 'captionScale', label: 'Caption size', type: 'range', min: 0.75, max: 2, step: 0.05 },
  { key: 'reducedMotion', label: 'Reduced motion', type: 'bool' },
  { key: 'highContrast', label: 'High contrast', type: 'bool' },
];

export function applySettingsToDocument(s: Settings): void {
  document.documentElement.style.setProperty('--caption-scale', String(s.captionScale));
  document.body.classList.toggle('high-contrast', s.highContrast);
  const captions = document.getElementById('captions');
  if (captions) captions.hidden = !s.captions;
}

/** Builds the settings form once; edits apply live and persist on change. */
export function setupSettingsDialog(settings: Settings): () => void {
  const dialog = document.getElementById('settings-dialog') as HTMLDialogElement;
  const host = document.getElementById('settings-fields')!;
  const record = settings as unknown as Record<string, boolean | number>;

  for (const f of FIELDS) {
    const label = document.createElement('label');
    label.textContent = f.label;
    const input = document.createElement('input');
    if (f.type === 'bool') {
      input.type = 'checkbox';
      input.checked = Boolean(record[f.key]);
    } else {
      input.type = 'range';
      input.min = String(f.min);
      input.max = String(f.max);
      input.step = String(f.step);
      input.value = String(record[f.key]);
    }
    input.addEventListener('input', () => {
      record[f.key] = f.type === 'bool' ? input.checked : Number(input.value);
      applySettingsToDocument(settings);
      saveSettings(settings);
    });
    label.append(input);
    host.append(label);
  }
  applySettingsToDocument(settings);
  return () => dialog.showModal();
}
