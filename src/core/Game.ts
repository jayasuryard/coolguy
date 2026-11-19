import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { DebugTools } from '../debug/DebugTools';
import { Player } from '../player/Player';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { ChunkManager } from '../world/ChunkManager';
import { Environment } from '../world/Environment';
import { TerrainGenerator } from '../world/terrain';
import { Input } from './Input';

/**
 * Owns the renderer, physics world and all systems, and runs the main loop:
 * fixed-timestep simulation + interpolated variable-rate rendering.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: Input;
  private terrain: TerrainGenerator;
  private readonly world: RAPIER.World;
  private readonly chunks: ChunkManager;
  private readonly env: Environment;
  private readonly player: Player;
  private readonly cam: ThirdPersonCamera;
  private readonly debug: DebugTools;
  private readonly hud = document.getElementById('stats-line');

  private accumulator = 0;
  private last = 0;
  private hudTimer = 0;
  private rafId = 0;

  static async create(container: HTMLElement): Promise<Game> {
    await RAPIER.init();
    return new Game(container);
  }

  private constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      65,
      container.clientWidth / container.clientHeight,
      0.1,
      2000,
    );
    this.input = new Input(this.renderer.domElement);

    this.terrain = new TerrainGenerator(CONFIG.terrain, CONFIG.seed);
    this.world = new RAPIER.World({ x: 0, y: CONFIG.player.gravity, z: 0 });
    this.world.timestep = CONFIG.physics.fixedDt;

    this.env = new Environment(this.scene, CONFIG);
    this.chunks = new ChunkManager(this.scene, RAPIER, this.world, this.terrain, CONFIG.chunk);

    const spawn = this.findSpawn();
    this.chunks.update(spawn, 9); // make sure ground exists under the player before frame 1
    this.player = new Player(RAPIER, this.world, CONFIG.player, spawn);
    this.scene.add(this.player.mesh);

    this.cam = new ThirdPersonCamera(this.camera, (x, z) =>
      Math.max(this.terrain.heightAt(x, z), CONFIG.terrain.seaLevel),
    );
    this.debug = new DebugTools(this.scene, this.world);
    this.buildDebugPanel();

    window.addEventListener('resize', () => this.onResize(container));
  }

  start(): void {
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    this.debug.begin();

    const dt = Math.min((now - this.last) / 1000, 0.25); // clamp after tab-switch stalls
    this.last = now;

    if (this.input.consumePressed('Backquote')) this.debug.toggle();
    if (this.input.consumePressed('KeyF')) this.player.flying = !this.player.flying;

    // --- fixed-step simulation ---
    const step = CONFIG.physics.fixedDt;
    this.accumulator += dt;
    while (this.accumulator >= step) {
      this.player.fixedUpdate(step, this.input, this.cam.yaw);
      this.world.step();
      this.player.postStep();
      this.accumulator -= step;
    }

    // --- per-frame systems ---
    this.player.render(this.accumulator / step, dt);
    this.respawnIfFallen();
    this.chunks.update(this.player.position);
    this.cam.update(dt, this.input, this.player.position);
    this.env.update(this.player.position, this.camera);

    this.renderer.render(this.scene, this.camera);
    this.updateHud(dt);
    this.input.endFrame();
    this.debug.end();
  };

  /** Spiral outwards from the origin until we find dry land. */
  private findSpawn(): THREE.Vector3 {
    const minH = CONFIG.terrain.seaLevel + 2;
    for (let r = 0; r < 4000; r += 16) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (h > minH && h < minH + 25) return new THREE.Vector3(x, h + 3, z);
        if (r === 0) break;
      }
    }
    return new THREE.Vector3(0, this.terrain.heightAt(0, 0) + 3, 0);
  }

  private respawnIfFallen(): void {
    const p = this.player.position;
    if (p.y < this.terrain.heightAt(p.x, p.z) - 20) {
      this.player.teleport(new THREE.Vector3(p.x, this.terrain.heightAt(p.x, p.z) + 3, p.z));
    }
  }

  private buildDebugPanel(): void {
    const gui = this.debug.gui;

    const world = gui.addFolder('World');
    world
      .add(CONFIG.chunk, 'viewDistance', 1, 12, 1)
      .name('view distance (chunks)')
      .onChange(() => this.env.updateFog());
    world.add(CONFIG.chunk, 'buildsPerFrame', 1, 8, 1).name('chunk builds / frame');
    const view = { wireframe: false };
    world.add(view, 'wireframe').onChange((v: boolean) => (this.chunks.wireframe = v));
    world
      .add(CONFIG, 'seed')
      .name('seed (regenerates)')
      .onFinishChange(() => this.regenerate());

    const player = gui.addFolder('Player');
    player.add(this.player, 'flying').name('fly mode (F)').listen();
    player.add(CONFIG.player, 'walkSpeed', 1, 30);
    player.add(CONFIG.player, 'sprintSpeed', 1, 60);
    player.add(CONFIG.player, 'jumpSpeed', 1, 30);
    player.add(CONFIG.player, 'gravity', -80, -1);
    player.add(
      {
        respawn: () => {
          const s = this.findSpawn();
          this.chunks.update(s, 9);
          this.player.teleport(s);
        },
      },
      'respawn',
    );

    const dbg = gui.addFolder('Physics');
    dbg.add(this.debug, 'showPhysics').name('show colliders (slow)');
  }

  /** Rebuild the terrain from a new seed without reloading the page. */
  private regenerate(): void {
    this.terrain = new TerrainGenerator(CONFIG.terrain, CONFIG.seed);
    this.chunks.setTerrain(this.terrain);
    const s = this.findSpawn();
    this.chunks.update(s, 9);
    this.player.teleport(s);
  }

  private updateHud(dt: number): void {
    this.hudTimer += dt;
    if (!this.hud || this.hudTimer < 0.2) return;
    this.hudTimer = 0;
    const p = this.player.position;
    const info = this.renderer.info.render;
    this.hud.textContent =
      `pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)} · ` +
      `chunks ${this.chunks.loadedCount} (+${this.chunks.pendingCount}) · ` +
      `draws ${info.calls} · tris ${(info.triangles / 1000).toFixed(0)}k` +
      (this.player.flying ? ' · FLY' : '');
  }

  private onResize(container: HTMLElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
