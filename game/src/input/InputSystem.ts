import { resolveBindings, type Action, type InputContext } from './actions';

/** A timestamped action edge. `time` is performance.now()-based milliseconds. */
export interface ActionEvent {
  action: Action;
  type: 'pressed' | 'released';
  time: number;
  /** True when the release came from focus loss rather than the player. */
  cancelled: boolean;
}

const DEADZONE = 0.18;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);

/**
 * Maps devices to actions stamped with input time. Edges are latched until consumed,
 * so fixed-step code never misses a press that happened between steps.
 */
export class InputSystem {
  private context: InputContext = 'exploration';
  private byCode = resolveBindings('exploration');
  private readonly downCodes = new Set<string>();
  private readonly latched = new Map<string, ActionEvent>();
  private readonly padPrev: boolean[] = [];
  private mouseDX = 0;
  private mouseDY = 0;
  pointerLocked = false;
  /** Left stick / right stick, after deadzone. */
  readonly leftStick = { x: 0, y: 0 };
  readonly rightStick = { x: 0, y: 0 };

  constructor(
    private readonly target: HTMLElement,
    private overrides: Record<string, string[]> = {},
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Tab' || (this.pointerLocked && e.code === 'Space')) e.preventDefault();
      this.codeDown(e.code, e.timeStamp);
    });
    window.addEventListener('keyup', (e) => this.codeUp(e.code, e.timeStamp, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());

    target.addEventListener('mousedown', (e) => this.codeDown(`Mouse${e.button}`, e.timeStamp));
    window.addEventListener('mouseup', (e) => this.codeUp(`Mouse${e.button}`, e.timeStamp, false));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
        this.codeDown(code, e.timeStamp);
        this.codeUp(code, e.timeStamp, false);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === target;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  requestPointerLock(): void {
    if (!this.pointerLocked) this.target.requestPointerLock?.()?.catch?.(() => {});
  }

  setContext(ctx: InputContext): void {
    this.context = ctx;
    this.byCode = resolveBindings(ctx, this.overrides);
  }

  get activeContext(): InputContext {
    return this.context;
  }

  setOverrides(o: Record<string, string[]>): void {
    this.overrides = o;
    this.byCode = resolveBindings(this.context, o);
  }

  isDown(action: Action): boolean {
    for (const code of this.downCodes) if (this.byCode.get(code)?.includes(action)) return true;
    return false;
  }

  /** Returns and clears the latched edge for an action, if any. */
  consume(action: Action, type: 'pressed' | 'released'): ActionEvent | null {
    const key = `${action}:${type}`;
    const e = this.latched.get(key) ?? null;
    this.latched.delete(key);
    return e;
  }

  /** Movement intent: x = right, y = forward, length ≤ 1. */
  moveAxis(): { x: number; y: number } {
    let x =
      (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0) + this.leftStick.x;
    let y =
      (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBack') ? 1 : 0) - this.leftStick.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Mouse pixels since last frame. */
  takeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  /** Poll controllers once per rendered frame (the Gamepad API has no events for buttons). */
  pollGamepads(): void {
    const pad = navigator.getGamepads?.().find((p) => p && p.connected) ?? null;
    if (!pad) {
      this.leftStick.x = this.leftStick.y = this.rightStick.x = this.rightStick.y = 0;
      return;
    }
    this.leftStick.x = dz(pad.axes[0] ?? 0);
    this.leftStick.y = dz(pad.axes[1] ?? 0);
    this.rightStick.x = dz(pad.axes[2] ?? 0);
    this.rightStick.y = dz(pad.axes[3] ?? 0);
    const t = pad.timestamp || performance.now();
    pad.buttons.forEach((b, i) => {
      const pressed = b.pressed || b.value > 0.5;
      if (pressed !== !!this.padPrev[i]) {
        if (pressed) this.codeDown(`Pad${i}`, t);
        else this.codeUp(`Pad${i}`, t, false);
      }
      this.padPrev[i] = pressed;
    });
  }

  private codeDown(code: string, time: number): void {
    if (this.downCodes.has(code)) return;
    this.downCodes.add(code);
    for (const action of this.byCode.get(code) ?? []) {
      this.latched.set(`${action}:pressed`, { action, type: 'pressed', time, cancelled: false });
    }
  }

  private codeUp(code: string, time: number, cancelled: boolean): void {
    if (!this.downCodes.delete(code)) return;
    for (const action of this.byCode.get(code) ?? []) {
      this.latched.set(`${action}:released`, { action, type: 'released', time, cancelled });
    }
  }

  /** Focus loss: release everything, flagged so held notes are cancelled rather than judged. */
  private releaseAll(): void {
    const now = performance.now();
    for (const code of [...this.downCodes]) this.codeUp(code, now, true);
    this.padPrev.length = 0;
  }
}
