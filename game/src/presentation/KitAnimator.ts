import * as THREE from 'three';

export type KitState = 'idle' | 'walk' | 'run' | 'play';

/** Clip-name patterns, so any rig export (Hunyuan, Mixamo, Blender) maps without renaming. */
const PATTERNS: Record<KitState, RegExp> = {
  idle: /idle|stand|breath|rest/i,
  walk: /walk/i,
  run: /run|jog|sprint/i,
  play: /play|guitar|strum|perform|dance/i,
};

/** Map exported clips onto Kit's locomotion states (first match wins). */
export function pickClips(
  clips: THREE.AnimationClip[],
): Partial<Record<KitState, THREE.AnimationClip>> {
  const out: Partial<Record<KitState, THREE.AnimationClip>> = {};
  for (const state of Object.keys(PATTERNS) as KitState[]) {
    const clip = clips.find((c) => PATTERNS[state].test(c.name));
    if (clip) out[state] = clip;
  }
  // A single unnamed clip is most likely an idle/loop.
  if (!out.idle && clips.length === 1) out.idle = clips[0];
  return out;
}

/** Which state Kit should show; falls back to the nearest clip that exists. */
export function chooseState(
  speed: number,
  strumming: boolean,
  has: Partial<Record<KitState, unknown>>,
): KitState | null {
  const want: KitState = strumming ? 'play' : speed < 0.3 ? 'idle' : speed < 3.2 ? 'walk' : 'run';
  const fallbacks: Record<KitState, KitState[]> = {
    play: ['play', 'idle'],
    idle: ['idle'],
    walk: ['walk', 'run', 'idle'],
    run: ['run', 'walk', 'idle'],
  };
  return fallbacks[want].find((s) => has[s]) ?? null;
}

/** Crossfading AnimationMixer driver for the rigged Kit model. */
export class KitAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Partial<Record<KitState, THREE.AnimationAction>> = {};
  private current: KitState | null = null;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(model);
    const picked = pickClips(clips);
    for (const [state, clip] of Object.entries(picked) as Array<[KitState, THREE.AnimationClip]>) {
      this.actions[state] = this.mixer.clipAction(clip);
    }
  }

  get states(): KitState[] {
    return Object.keys(this.actions) as KitState[];
  }

  update(dt: number, speed: number, strumming: boolean): void {
    const next = chooseState(speed, strumming, this.actions);
    if (next && next !== this.current) {
      const to = this.actions[next]!;
      to.reset().play();
      const from = this.current ? this.actions[this.current] : undefined;
      if (from) to.crossFadeFrom(from, 0.25, true);
      this.current = next;
    }
    // Keep feet roughly matched to ground speed (clips are authored near 1.4 m/s walk, 3.5 m/s run).
    const a = this.current ? this.actions[this.current] : undefined;
    if (a) {
      if (this.current === 'walk') a.timeScale = THREE.MathUtils.clamp(speed / 1.4, 0.6, 1.8);
      else if (this.current === 'run') a.timeScale = THREE.MathUtils.clamp(speed / 3.5, 0.7, 1.6);
      else a.timeScale = 1;
    }
    this.mixer.update(dt);
  }
}
