import type { RampDef, Vec3 } from '@content/types';

export const RAMP_THICKNESS = 0.5;

export interface BoxTransform {
  center: Vec3;
  halfExtents: Vec3;
  /** Quaternion x, y, z, w. */
  rotation: [number, number, number, number];
}

/**
 * Oriented box whose top face runs from ramp.from to ramp.to.
 * Shared by physics and rendering so both always agree.
 */
export function rampTransform(r: RampDef): BoxTransform {
  const dx = r.to[0] - r.from[0];
  const dy = r.to[1] - r.from[1];
  const dz = r.to[2] - r.from[2];
  const horiz = Math.hypot(dx, dz);
  const length = Math.hypot(horiz, dy);
  const yaw = Math.atan2(dx, dz);
  const slope = Math.atan2(dy, horiz);
  const pitch = -slope; // rotation about local X that lifts local +Z by `slope`

  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const sp = Math.sin(pitch / 2);
  const cp = Math.cos(pitch / 2);
  // q = qYaw * qPitch
  const rotation: [number, number, number, number] = [cy * sp, sy * cp, -sy * sp, cy * cp];

  // Top-face normal after rotation; shift the centre down by half the thickness.
  const up: Vec3 = [
    -Math.sin(yaw) * Math.sin(slope),
    Math.cos(slope),
    -Math.cos(yaw) * Math.sin(slope),
  ];
  const h = RAMP_THICKNESS / 2;
  return {
    center: [
      (r.from[0] + r.to[0]) / 2 - up[0] * h,
      (r.from[1] + r.to[1]) / 2 - up[1] * h,
      (r.from[2] + r.to[2]) / 2 - up[2] * h,
    ],
    halfExtents: [r.width / 2, h, length / 2],
    rotation,
  };
}
