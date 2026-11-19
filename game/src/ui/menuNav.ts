/**
 * Vertical menu navigation: ↑/↓ (and W/S, D-pad via keyboard mapping) move the highlight,
 * Enter/Space activates, the mouse highlights on hover. Disabled items are skipped.
 */
export class MenuNav {
  private index = 0;

  constructor(
    private readonly items: HTMLButtonElement[],
    private readonly onSelect: (action: string) => void,
  ) {
    items.forEach((b, i) => {
      b.addEventListener('mouseenter', () => !b.disabled && this.set(i));
      b.addEventListener('focus', () => this.set(i, false));
      b.addEventListener('click', () => !b.disabled && this.onSelect(b.dataset.action ?? ''));
    });
  }

  /** Highlight the first enabled item and give it keyboard focus. */
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
      if (b && !b.disabled) this.onSelect(b.dataset.action ?? '');
    } else return false;
    e.preventDefault();
    return true;
  }

  private move(dir: number): void {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.index + dir * k + n * k) % n;
      if (!this.items[i]!.disabled) return this.set(i);
    }
  }

  private set(i: number, focus = true): void {
    this.index = i;
    this.items.forEach((b, k) => b.classList.toggle('active', k === i));
    if (focus) this.items[i]?.focus({ preventScroll: true });
  }
}
