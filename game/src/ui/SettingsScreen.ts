import { DEFAULT_BINDINGS, type Action } from '../input/actions';
import { DEFAULT_SETTINGS, saveSettings, type Settings } from '../platform/settings';

type Tab = 'display' | 'audio' | 'controls' | 'accessibility';

/** UI sound hooks (see ShellAudio). */
export interface SettingsSounds {
  move(index: number): void;
  tab(): void;
  slide(value: number): void;
  toggle(on: boolean): void;
  select(): void;
  confirm(): void;
  back(): void;
}
type Key = keyof Settings;

type Field =
  | {
      kind: 'range';
      key: Key;
      label: string;
      min: number;
      max: number;
      step: number;
      fmt: (v: number) => string;
    }
  | {
      kind: 'choice';
      key: Key;
      label: string;
      options: Array<{ value: string | boolean; label: string }>;
    }
  | { kind: 'binding'; action: Action; label: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const onOff = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' },
];

const TABS: Record<Tab, Field[]> = {
  display: [
    {
      kind: 'range',
      key: 'renderScale',
      label: 'Render scale',
      min: 0.5,
      max: 1,
      step: 0.05,
      fmt: pct,
    },
    {
      kind: 'choice',
      key: 'shadows',
      label: 'Shadows',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
    },
    {
      kind: 'range',
      key: 'fov',
      label: 'Field of view',
      min: 50,
      max: 80,
      step: 1,
      fmt: (v) => `${v}°`,
    },
  ],
  audio: [
    {
      kind: 'range',
      key: 'masterVolume',
      label: 'Master volume',
      min: 0,
      max: 1,
      step: 0.05,
      fmt: pct,
    },
    {
      kind: 'range',
      key: 'musicVolume',
      label: 'Music volume',
      min: 0,
      max: 1,
      step: 0.05,
      fmt: pct,
    },
    {
      kind: 'range',
      key: 'effectsVolume',
      label: 'Effects volume',
      min: 0,
      max: 1,
      step: 0.05,
      fmt: pct,
    },
    {
      kind: 'range',
      key: 'dialogueVolume',
      label: 'Dialogue volume',
      min: 0,
      max: 1,
      step: 0.05,
      fmt: pct,
    },
    {
      kind: 'choice',
      key: 'audioOutput',
      label: 'Audio output',
      options: [
        { value: 'stereo', label: 'Stereo' },
        { value: 'mono', label: 'Mono' },
      ],
    },
  ],
  controls: [
    {
      kind: 'range',
      key: 'mouseSensitivity',
      label: 'Look sensitivity',
      min: 0.25,
      max: 2,
      step: 0.05,
      fmt: (v) => `${v.toFixed(2)}×`,
    },
    { kind: 'choice', key: 'invertY', label: 'Invert look Y', options: onOff },
    { kind: 'choice', key: 'holdAsTwoTaps', label: 'Hold → two taps', options: onOff },
    { kind: 'binding', action: 'play', label: 'Play phrase' },
    { kind: 'binding', action: 'listen', label: 'Listen and copy' },
    { kind: 'binding', action: 'interact', label: 'Speak, board, use' },
    { kind: 'binding', action: 'jog', label: 'Jog' },
    { kind: 'binding', action: 'recenter', label: 'Recenter camera' },
  ],
  accessibility: [
    { kind: 'choice', key: 'assistedRelease', label: 'Assisted release', options: onOff },
    {
      kind: 'range',
      key: 'calibrationMs',
      label: 'Audio latency offset',
      min: -150,
      max: 150,
      step: 5,
      fmt: (v) => `${v > 0 ? '+' : ''}${v} ms`,
    },
    { kind: 'choice', key: 'captions', label: 'Captions', options: onOff },
    {
      kind: 'range',
      key: 'captionScale',
      label: 'Caption size',
      min: 0.75,
      max: 2,
      step: 0.05,
      fmt: pct,
    },
    { kind: 'choice', key: 'reducedMotion', label: 'Reduced motion', options: onOff },
    { kind: 'choice', key: 'highContrast', label: 'High contrast', options: onOff },
  ],
};
const TAB_ORDER: Tab[] = ['display', 'audio', 'controls', 'accessibility'];

const keyName = (code: string) =>
  code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/Left$|Right$/, '')
    .replace('Mouse0', 'Left click')
    .replace('Mouse2', 'Right click');

/**
 * Settings screen with live tabs. Edits go to a draft; Apply persists and applies them,
 * Reset defaults restores the defaults into the draft, Esc goes back without applying.
 */
export class SettingsScreen {
  private draft: Settings;
  private tab: Tab = 'audio';
  private rows: HTMLElement[] = [];
  private focus = 0;
  private listening: { action: Action; el: HTMLButtonElement } | null = null;
  private readonly host = document.getElementById('settings-rows')!;
  private readonly note = document.getElementById('settings-note')!;
  private readonly tabButtons = [
    ...document.querySelectorAll<HTMLButtonElement>('#screen-settings [role=tab]'),
  ];

  constructor(
    private current: Settings,
    private readonly onApply: (s: Settings) => void,
    private readonly onBack: () => void,
    private readonly sounds?: SettingsSounds,
  ) {
    this.draft = structuredClone(current);
    this.tabButtons.forEach((b) =>
      b.addEventListener('click', () => {
        this.sounds?.tab();
        this.showTab(b.dataset.tab as Tab);
      }),
    );
    document.getElementById('btn-apply')!.addEventListener('click', () => this.apply());
    document.getElementById('btn-reset')!.addEventListener('click', () => this.reset());
  }

  open(settings: Settings): void {
    this.current = settings;
    this.draft = structuredClone(settings);
    this.note.textContent = '';
    this.showTab(this.tab);
  }

  /** Keyboard handling while the screen is visible. Returns true when handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.listening) {
      e.preventDefault();
      if (e.key !== 'Escape') {
        this.bind(this.listening.action, e.code);
        this.sounds?.confirm();
      } else this.sounds?.back();
      this.listening.el.classList.remove('listening');
      this.listening = null;
      this.render();
      return true;
    }
    if (e.key === 'Escape') {
      this.sounds?.back();
      this.onBack();
    } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
      const i = TAB_ORDER.indexOf(this.tab) + (e.code === 'KeyE' ? 1 : -1);
      this.sounds?.tab();
      this.showTab(TAB_ORDER[(i + TAB_ORDER.length) % TAB_ORDER.length]!);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const before = this.focus;
      this.setFocus(this.focus + (e.key === 'ArrowDown' ? 1 : -1));
      if (this.focus !== before) this.sounds?.move(this.focus);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const row = this.rows[this.focus];
      if (row?.dataset.index !== undefined)
        this.adjust(Number(row.dataset.index), e.key === 'ArrowRight' ? 1 : -1);
      else return false;
    } else if (e.key === 'Enter') {
      const row = this.rows[this.focus];
      if (!row) return false;
      if (row.dataset.index === undefined) (row as HTMLButtonElement).click();
      else this.adjust(Number(row.dataset.index), 1, true);
    } else return false;
    e.preventDefault();
    return true;
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    this.tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    this.render();
    this.setFocus(0);
  }

  private render(): void {
    this.host.replaceChildren();
    TABS[this.tab].forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.tabIndex = -1;
      row.dataset.index = String(i);
      row.addEventListener('mouseenter', () => this.setFocus(i, false));
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = f.label;
      row.append(label);

      if (f.kind === 'range') {
        const v = this.draft[f.key] as number;
        const input = document.createElement('input');
        Object.assign(input, {
          type: 'range',
          min: String(f.min),
          max: String(f.max),
          step: String(f.step),
        });
        input.value = String(v);
        input.setAttribute('aria-label', f.label);
        const out = document.createElement('span');
        out.className = 'value';
        const paint = () => {
          const n = Number(input.value);
          input.style.setProperty('--pct', `${((n - f.min) / (f.max - f.min)) * 100}%`);
          out.textContent = f.fmt(n);
        };
        let lastTick = 0;
        input.addEventListener('input', () => {
          (this.draft as unknown as Record<string, unknown>)[f.key] = Number(input.value);
          paint();
          if (performance.now() - lastTick > 60) {
            lastTick = performance.now();
            this.sounds?.slide((Number(input.value) - f.min) / (f.max - f.min));
          }
        });
        paint();
        row.append(input, out);
      } else if (f.kind === 'choice') {
        const wrap = document.createElement('div');
        wrap.className = 'choice';
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.textContent = '‹';
        prev.setAttribute('aria-label', `Previous ${f.label}`);
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = '›';
        next.setAttribute('aria-label', `Next ${f.label}`);
        const out = document.createElement('output');
        out.textContent = f.options.find((o) => o.value === this.draft[f.key])?.label ?? '';
        prev.addEventListener('click', () => this.adjust(i, -1));
        next.addEventListener('click', () => this.adjust(i, 1));
        wrap.append(prev, out, next);
        row.append(wrap);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'binding';
        btn.textContent = this.keyboardCodes(f.action).map(keyName).join(' / ') || '—';
        btn.addEventListener('click', () => {
          this.sounds?.select();
          this.listening = { action: f.action, el: btn };
          btn.classList.add('listening');
          btn.textContent = 'Press a key…';
        });
        row.append(btn);
      }
      this.host.append(row);
    });
    const actions = [...document.querySelectorAll<HTMLElement>('#btn-apply, #btn-reset')];
    this.rows = [...this.host.querySelectorAll<HTMLElement>('.row'), ...actions];
  }

  private setFocus(i: number, focusEl = true): void {
    this.focus = Math.max(0, Math.min(this.rows.length - 1, i));
    this.rows.forEach((r, k) => r.classList.toggle('active', k === this.focus));
    if (focusEl) this.rows[this.focus]?.focus({ preventScroll: false });
  }

  private adjust(i: number, dir: number, cycle = false): void {
    const f = TABS[this.tab][i];
    if (!f) return;
    const d = this.draft as unknown as Record<string, unknown>;
    if (f.kind === 'range') {
      const v = Math.min(f.max, Math.max(f.min, (d[f.key] as number) + dir * f.step));
      d[f.key] = Math.round(v / f.step) * f.step;
      this.sounds?.slide(((d[f.key] as number) - f.min) / (f.max - f.min));
    } else if (f.kind === 'choice') {
      const idx = f.options.findIndex((o) => o.value === d[f.key]);
      const n = f.options.length;
      const next = cycle ? (idx + 1) % n : Math.min(n - 1, Math.max(0, idx + dir));
      d[f.key] = f.options[next]!.value;
      this.sounds?.toggle(next >= idx);
    } else {
      this.rows[i]?.querySelector('button')?.click();
      return;
    }
    const keep = this.focus;
    this.render();
    this.setFocus(keep);
  }

  private keyboardCodes(action: Action): string[] {
    const codes = this.draft.bindings[action] ?? DEFAULT_BINDINGS.exploration[action] ?? [];
    return codes.filter((c) => !c.startsWith('Pad') && !c.startsWith('Wheel'));
  }

  /** Rebind an action's keyboard key, keeping its controller and mouse bindings. */
  private bind(action: Action, code: string): void {
    const defaults = this.draft.bindings[action] ?? DEFAULT_BINDINGS.exploration[action] ?? [];
    const keep = defaults.filter(
      (c) => c.startsWith('Pad') || c.startsWith('Mouse') || c.startsWith('Wheel'),
    );
    this.draft.bindings = { ...this.draft.bindings, [action]: [code, ...keep] };
  }

  private apply(): void {
    this.current = structuredClone(this.draft);
    const ok = saveSettings(this.current);
    this.sounds?.confirm();
    this.onApply(this.current);
    this.note.textContent = ok ? 'Saved.' : 'Applied for this session (storage unavailable).';
  }

  private reset(): void {
    this.draft = structuredClone(DEFAULT_SETTINGS);
    this.sounds?.toggle(false);
    this.render();
    this.note.textContent = 'Defaults restored — Apply to keep them.';
  }
}
