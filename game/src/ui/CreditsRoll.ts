/**
 * Film-style credits: the logo card holds, the roll climbs at a steady pace, the closing card
 * holds, then it fades and loops. ↓/Space fast-forward, ↑ rewinds, the wheel scrubs.
 * With reduced motion the roll is a still, scrollable list.
 */
const BASE_SPEED = 62; // mockup px per second at 1920×1080
const HOLD_START = 2.6; // s on the logo card
const HOLD_END = 6; // s on the closing card

export class CreditsRoll {
  private readonly screen = document.getElementById('screen-credits')!;
  private readonly viewport = this.screen.querySelector<HTMLElement>('.credits-viewport')!;
  private readonly roll = document.getElementById('credits-roll')!;
  private y = 0;
  private hold = 0;
  private raf = 0;
  private last = 0;
  private fwd = false;
  private back = false;
  private active = false;

  constructor(private readonly reducedMotion: () => boolean) {
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowDown' || e.key === ' ') this.fwd = false;
      if (e.key === 'ArrowUp') this.back = false;
    });
    this.viewport.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || this.isStatic) return;
        this.y = this.clamp(this.y - e.deltaY * 0.8);
        this.hold = 0;
        this.apply();
      },
      { passive: true },
    );
  }

  private get isStatic(): boolean {
    return this.reducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  open(): void {
    this.active = true;
    this.screen.classList.toggle('static', this.isStatic);
    this.screen.classList.remove('open');
    // the title and end cards fill exactly one viewport so the logo sits centred
    this.screen.style.setProperty('--viewport-h', `${this.viewport.clientHeight}px`);
    this.y = 0;
    this.hold = HOLD_START;
    this.apply();
    this.viewport.scrollTop = 0;
    void this.screen.offsetWidth; // restart the letterbox transition
    this.screen.classList.add('open');
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    if (!this.isStatic) this.raf = requestAnimationFrame(this.tick);
  }

  close(): void {
    this.active = false;
    this.fwd = this.back = false;
    cancelAnimationFrame(this.raf);
    this.screen.classList.remove('open');
  }

  /** Returns true when the key was handled (Esc/Enter are left to the caller). */
  handleKey(e: KeyboardEvent): boolean {
    if (this.isStatic) {
      if (e.key === 'ArrowDown' || e.key === ' ') this.viewport.scrollTop += 80;
      else if (e.key === 'ArrowUp') this.viewport.scrollTop -= 80;
      else return false;
    } else if (e.key === 'ArrowDown' || e.key === ' ') this.fwd = true;
    else if (e.key === 'ArrowUp') this.back = true;
    else return false;
    e.preventDefault();
    return true;
  }

  private get end(): number {
    return -(this.roll.offsetHeight - this.viewport.clientHeight);
  }

  private clamp(y: number): number {
    return Math.min(0, Math.max(this.end, y));
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const manual = this.fwd ? 7 : this.back ? -5 : 0;

    if (manual) this.hold = 0;
    else if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0 && this.y <= this.end + 0.5) this.restart();
      return;
    }

    const speed = BASE_SPEED * scale * (manual || 1);
    this.y = this.clamp(this.y - speed * dt);
    if (!manual && this.y <= this.end + 0.5) this.hold = HOLD_END;
    this.apply();
  };

  /** Fade out, jump back to the logo card, fade in. */
  private restart(): void {
    this.roll.style.opacity = '0';
    window.setTimeout(() => {
      if (!this.active) return;
      this.y = 0;
      this.hold = HOLD_START;
      this.apply();
      this.roll.style.opacity = '';
    }, 1400);
  }

  private apply(): void {
    this.roll.style.transform = `translate3d(-50%, ${this.y}px, 0)`;
  }
}
