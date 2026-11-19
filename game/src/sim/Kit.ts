import type RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';

export interface KitIntent {
  /** World-space horizontal direction, length ≤ 1. */
  moveX: number;
  moveZ: number;
  jog: boolean;
  /** Dev-only free flight. */
  noclip: boolean;
  /** -1..1 vertical input while noclipping. */
  rise: number;
}

export type V3 = { x: number; y: number; z: number };

/**
 * Kit's capsule: Rapier kinematic character controller (slopes, steps, ground snap), no jump.
 * Records the last safe landing for fall recovery.
 */
export class Kit {
  readonly collider: RAPIER.Collider;
  readonly prev: V3;
  readonly curr: V3;
  facing = Math.PI; // look up the hill (-Z)
  grounded = false;
  speed = 0;

  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private velocityY = 0;
  private lastSafe: V3;
  private safeTimer = 0;

  constructor(rapier: typeof RAPIER, world: RAPIER.World, spawn: V3) {
    const k = CONFIG.kit;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(k.halfHeight, k.radius),
      this.body,
    );
    this.controller = world.createCharacterController(0.03);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);

    this.prev = { ...spawn };
    this.curr = { ...spawn };
    this.lastSafe = { ...spawn };
  }

  fixedUpdate(dt: number, intent: KitIntent): void {
    const t = this.body.translation();
    const len = Math.hypot(intent.moveX, intent.moveZ);
    if (len > 0.01) this.facing = Math.atan2(intent.moveX, intent.moveZ);

    if (intent.noclip) {
      const s = 25 * dt * (intent.jog ? 3 : 1);
      this.velocityY = 0;
      this.body.setNextKinematicTranslation({
        x: t.x + intent.moveX * s,
        y: t.y + intent.rise * s,
        z: t.z + intent.moveZ * s,
      });
      return;
    }

    const speed = (intent.jog ? CONFIG.kit.jogSpeed : CONFIG.kit.walkSpeed) * dt;
    this.velocityY = Math.max(this.velocityY + CONFIG.sim.gravity * dt, -40);
    this.controller.computeColliderMovement(this.collider, {
      x: intent.moveX * speed,
      y: this.velocityY * dt,
      z: intent.moveZ * speed,
    });
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocityY < 0) this.velocityY = 0;
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });

    this.safeTimer += dt;
    if (this.grounded && this.safeTimer > 0.5) {
      this.safeTimer = 0;
      this.lastSafe = { x: t.x, y: t.y + 0.1, z: t.z };
    }
  }

  postStep(dt: number): void {
    Object.assign(this.prev, this.curr);
    const t = this.body.translation();
    this.speed = Math.hypot(t.x - this.prev.x, t.z - this.prev.z) / dt;
    Object.assign(this.curr, { x: t.x, y: t.y, z: t.z });
  }

  /** "A fall returns Kit to his last safe landing." */
  recoverIfFallen(waterLevel = -8): boolean {
    if (this.curr.y > waterLevel - 1.2) return false;
    this.teleport(this.lastSafe);
    return true;
  }

  teleport(p: V3): void {
    this.body.setTranslation(p, true);
    this.velocityY = 0;
    Object.assign(this.prev, p);
    Object.assign(this.curr, p);
    this.lastSafe = { ...p };
  }
}
