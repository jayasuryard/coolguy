import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chooseState, pickClips } from './KitAnimator';

const clip = (name: string) => new THREE.AnimationClip(name, 1, []);

describe('KitAnimator clip mapping', () => {
  it('maps common export names onto states', () => {
    const p = pickClips([
      clip('Armature|Idle_Breathing'),
      clip('Walk_Loop'),
      clip('Jog'),
      clip('Guitar_Strum'),
    ]);
    expect(p.idle?.name).toBe('Armature|Idle_Breathing');
    expect(p.walk?.name).toBe('Walk_Loop');
    expect(p.run?.name).toBe('Jog');
    expect(p.play?.name).toBe('Guitar_Strum');
  });

  it('treats a lone unnamed clip as idle', () => {
    expect(pickClips([clip('Take 001')]).idle?.name).toBe('Take 001');
  });

  it('chooses by speed and strumming, falling back to clips that exist', () => {
    const all = { idle: 1, walk: 1, run: 1, play: 1 };
    expect(chooseState(0, false, all)).toBe('idle');
    expect(chooseState(2, false, all)).toBe('walk');
    expect(chooseState(4.5, false, all)).toBe('run');
    expect(chooseState(4.5, true, all)).toBe('play');
    expect(chooseState(4.5, false, { idle: 1, walk: 1 })).toBe('walk');
    expect(chooseState(1, true, { idle: 1 })).toBe('idle');
    expect(chooseState(1, false, {})).toBeNull();
  });
});
