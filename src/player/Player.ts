import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Config } from '../config';
import type { Input } from '../core/Input';

/**
 * Kinematic capsule driven by Rapier's character controller (slopes, steps, ground snap).
 * Simulated at a fixed rate; the visual mesh is interpolated between physics states.
 */
export class Player {
  readonly mesh: THREE.Group;
  /** Interpolated, render-time position (feet-to-centre of the capsule). */
  readonly position = new THREE.Vector3();
  flying = false;
  grounded = false;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private readonly moveDir = new THREE.Vector3();
  private velocityY = 0;
  private facing = 0;

  constructor(
    rapier: typeof RAPIER,
    world: RAPIER.World,
    private readonly cfg: Config['player'],
    spawn: THREE.Vector3,
  ) {
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(cfg.halfHeight, cfg.radius),
      this.body,
    );

    this.controller = world.createCharacterController(0.05);
    this.controller.enableAutostep(0.6, 0.2, true);
    this.controller.enableSnapToGround(0.6);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(50));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(35));

    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(cfg.radius, cfg.halfHeight * 2, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0xe0673a, roughness: 0.6 }),
    );
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.2 }),
    );
    visor.position.set(0, cfg.halfHeight * 0.8, cfg.radius - 0.02);
    body.castShadow = visor.castShadow = true;
    this.mesh.add(body, visor);

    this.curr.copy(spawn);
    this.prev.copy(spawn);
    this.position.copy(spawn);
  }

  /** Runs at CONFIG.physics.fixedDt, before world.step(). */
  fixedUpdate(dt: number, input: Input, cameraYaw: number): void {
    // Camera-relative input. forward = -Z rotated by yaw.
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const r = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    this.moveDir.set(-sin * f + cos * r, 0, -cos * f - sin * r);
    if (this.moveDir.lengthSq() > 0) {
      this.moveDir.normalize();
      this.facing = Math.atan2(this.moveDir.x, this.moveDir.z);
    }

    const jump = input.consumePressed('Space');
    const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const t = this.body.translation();

    if (this.flying) {
      const speed = this.cfg.flySpeed * (sprint ? 3 : 1) * dt;
      const up = (input.isDown('Space') ? 1 : 0) - (input.isDown('KeyC') ? 1 : 0);
      this.velocityY = 0;
      this.body.setNextKinematicTranslation({
        x: t.x + this.moveDir.x * speed,
        y: t.y + up * speed,
        z: t.z + this.moveDir.z * speed,
      });
      return;
    }

    const speed = (sprint ? this.cfg.sprintSpeed : this.cfg.walkSpeed) * dt;
    if (this.grounded && jump) this.velocityY = this.cfg.jumpSpeed;
    this.velocityY = Math.max(this.velocityY + this.cfg.gravity * dt, -60);

    this.controller.computeColliderMovement(this.collider, {
      x: this.moveDir.x * speed,
      y: this.velocityY * dt,
      z: this.moveDir.z * speed,
    });
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocityY < 0) this.velocityY = 0;

    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  }

  /** Runs right after world.step(). */
  postStep(): void {
    this.prev.copy(this.curr);
    const t = this.body.translation();
    this.curr.set(t.x, t.y, t.z);
  }

  /** Runs once per rendered frame. alpha = leftover fraction of a fixed step. */
  render(alpha: number, dt: number): void {
    this.position.lerpVectors(this.prev, this.curr, alpha);
    this.mesh.position.copy(this.position);
    const diff = Math.atan2(
      Math.sin(this.facing - this.mesh.rotation.y),
      Math.cos(this.facing - this.mesh.rotation.y),
    );
    this.mesh.rotation.y += diff * (1 - Math.exp(-dt * 12));
  }

  teleport(p: THREE.Vector3): void {
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.velocityY = 0;
    this.curr.copy(p);
    this.prev.copy(p);
  }
}
