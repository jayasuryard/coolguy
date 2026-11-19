/**
 * Action map from the Design document. Codes:
 *  - keyboard: KeyboardEvent.code ("KeyW", "ShiftLeft", "Digit1", …)
 *  - mouse: "Mouse0" (left) / "Mouse2" (right), "WheelUp" / "WheelDown"
 *  - controller (standard mapping): "Pad0" A · "Pad1" B · "Pad2" X · "Pad3" Y · "Pad4" LB · "Pad5" RB
 *    "Pad6" LT · "Pad7" RT · "Pad8" View · "Pad9" Menu · "Pad10" LS · "Pad11" RS · "Pad12–15" D-pad U/D/L/R
 * Sticks are read as axes (move = left, look = right).
 */
export type InputContext = 'exploration' | 'combat';

export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'jog'
  | 'interact'
  | 'listen'
  | 'play'
  | 'phrasePrev'
  | 'phraseNext'
  | 'phrase1'
  | 'phrase2'
  | 'phrase3'
  | 'songbook'
  | 'pause'
  | 'recenter'
  | 'goggles'
  | 'strike'
  | 'guard'
  | 'dodge';

export type Bindings = Partial<Record<Action, string[]>>;

const shared: Bindings = {
  moveForward: ['KeyW'],
  moveBack: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  songbook: ['Tab', 'Pad8'],
  pause: ['Escape', 'Pad9'],
  recenter: ['KeyR', 'Pad11'],
  goggles: ['KeyG', 'Pad12'],
};

export const DEFAULT_BINDINGS: Record<InputContext, Bindings> = {
  exploration: {
    ...shared,
    jog: ['ShiftLeft', 'ShiftRight', 'Space', 'Pad10', 'Pad0'],
    interact: ['KeyE', 'Pad2'],
    listen: ['KeyQ', 'Pad6'],
    play: ['KeyF', 'Pad7'],
    phrasePrev: ['WheelUp', 'Pad14'],
    phraseNext: ['WheelDown', 'Pad15'],
    phrase1: ['Digit1'],
    phrase2: ['Digit2'],
    phrase3: ['Digit3'],
  },
  combat: {
    ...shared,
    jog: ['ShiftLeft', 'ShiftRight', 'Pad10'],
    interact: ['KeyE', 'Pad3'],
    strike: ['Mouse0', 'Pad2'],
    guard: ['Mouse2', 'Pad6'],
    dodge: ['Space', 'Pad0'],
    play: ['KeyF', 'Pad7'],
  },
};

/** Merge user overrides (from settings) over the defaults for one context. */
export function resolveBindings(
  ctx: InputContext,
  overrides: Record<string, string[]> = {},
): Map<string, Action[]> {
  const merged: Bindings = { ...DEFAULT_BINDINGS[ctx] };
  for (const [action, codes] of Object.entries(overrides)) merged[action as Action] = codes;
  const byCode = new Map<string, Action[]>();
  for (const [action, codes] of Object.entries(merged) as Array<[Action, string[]]>) {
    for (const code of codes) byCode.set(code, [...(byCode.get(code) ?? []), action]);
  }
  return byCode;
}
