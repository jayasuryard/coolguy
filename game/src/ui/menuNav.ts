export interface MenuSounds {
  move(index: number): void;
  select(): void;
  denied(): void;
}

/**
 * Vertical menu navigation: ↑/↓ (and W/S) move the highlight, Enter/Space activates, the mouse
 * highlights on hover. Disabled items are skipped. Optional sounds tick on every move.
 */
export class MenuNav {
  private index = 0;

  constructor(
    private readonly items: HTMLButtonElement[],
    private readonly onSelect: (action: string) => void,
    private readonly sounds?: MenuSounds,
  ) {
    items.forEach((b, i) => {
      b.addEventListener('mouseenter', () => {
        if (!b.disabled && i !== this.index) {
          this.set(i);
          this.sounds?.move(i);
        }
      });
      b.addEventListener('focus', () => this.set(i, false));
      b.addEventListener('click', () => this.activate(b));
    });
  }

  /** Highlight the first enabled item and give it keyboard focus (silently). */
  reset(): void {
    const first = this.items.findIndex((b) => !b.disabled);
    this.set(Math.max(0, first));
  }

  /** Returns true when the key was handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowDown' || e.code === 'KeyS') this.move(1);
    else if (e.key === 'ArrowUp' || e.code === 'KeyW') this.move(-1);
    else if (e.key === 'Enter' || e.key === ' ') {
      const b = this.items[this.index];
      if (b) this.activate(b);
    } else return false;
    e.preventDefault();
    return true;
  }

  private activate(b: HTMLButtonElement): void {
    if (b.disabled) {
      this.sounds?.denied();
      return;
    }
    this.sounds?.select();
    this.onSelect(b.dataset.action ?? '');
  }

  private move(dir: number): void {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.index + dir * k + n * k) % n;
      if (!this.items[i]!.disabled) {
        this.set(i);
        this.sounds?.move(i);
        return;
      }
    }
  }

  private set(i: number, focus = true): void {
    this.index = i;
    this.items.forEach((b, k) => b.classList.toggle('active', k === i));
    if (focus) this.items[i]?.focus({ preventScroll: true });
  }
}
