import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from './sim/FixedStepLoop';
import { rampTransform } from './story/geometry';
import { beatAt, judgeRelease, nearestMarkedBeat, timeOfBeat } from './transport/timing';

describe('FixedStepLoop', () => {
  const dt = 1 / 60;

  it('runs one step per 60 Hz frame and interpolates the remainder', () => {
    const loop = new FixedStepLoop(dt, 4);
    expect(loop.advance(dt).steps).toBe(1);
    const r = loop.advance(dt * 0.5);
    expect(r.steps).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5, 5);
  });

  it('caps catch-up at 4 steps and discards the backlog', () => {
    const loop = new FixedStepLoop(dt, 4);
    expect(loop.advance(1).steps).toBe(4);
    expect(loop.advance(0).steps).toBe(0); // backlog was dropped, not carried
  });

  it('runs the same number of steps at 30 and 60 rendered fps', () => {
    const at60 = new FixedStepLoop(dt);
    const at30 = new FixedStepLoop(dt);
    let s60 = 0;
    let s30 = 0;
    for (let i = 0; i < 120; i++) s60 += at60.advance(1 / 60).steps;
    for (let i = 0; i < 60; i++) s30 += at30.advance(1 / 30).steps;
    expect(s60).toBe(120);
    expect(s30).toBe(120);
  });

  it('accumulates nothing while paused and discards time on resume', () => {
    const loop = new FixedStepLoop(dt);
    loop.pause();
    expect(loop.advance(5).steps).toBe(0);
    loop.resume();
    expect(loop.advance(dt).steps).toBe(1);
  });
});

describe('timing', () => {
  const grid = { origin: 10, bpm: 120 }; // 0.5 s per beat

  it('maps time ↔ beats', () => {
    expect(beatAt(grid, 11)).toBe(2);
    expect(timeOfBeat(grid, 4)).toBe(12);
    expect(nearestMarkedBeat(grid, 11.9, 4)).toBe(4);
    expect(nearestMarkedBeat(grid, 10.9, 4)).toBe(0);
  });

  it('judges releases on both sides of the ±180 ms window', () => {
    const opts = { windowMs: 180 };
    expect(judgeRelease(12.179, 12, opts).judgement).toBe('hit');
    expect(judgeRelease(11.821, 12, opts).judgement).toBe('hit');
    expect(judgeRelease(12.181, 12, opts).judgement).toBe('late');
    expect(judgeRelease(11.819, 12, opts).judgement).toBe('early');
  });

  it('applies calibration and assisted release', () => {
    expect(judgeRelease(12.25, 12, { windowMs: 180, calibrationMs: 100 }).judgement).toBe('hit');
    const assisted = judgeRelease(12.9, 12, { windowMs: 180, assisted: true });
    expect(assisted.judgement).toBe('hit');
  });
});

describe('rampTransform', () => {
  it('puts the top face on the from→to line', () => {
    const t = rampTransform({ id: 'r', kind: 'ramp', from: [0, 0, 36], to: [0, 6, 0], width: 8 });
    const [hx, hy, hz] = t.halfExtents;
    expect(hx).toBe(4);
    expect(hy).toBeCloseTo(0.25);
    expect(hz * 2).toBeCloseTo(Math.hypot(36, 6));
    // centre sits half a thickness below the midpoint
    expect(t.center[1]).toBeLessThan(3);
    expect(t.center[1]).toBeGreaterThan(2.7);
    const q = t.rotation;
    expect(Math.hypot(...q)).toBeCloseTo(1);
  });
});
