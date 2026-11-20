import RAPIER from '@dimforge/rapier3d-compat';
import type { DistrictSheet, PadDef, StepDef, VersionId } from '@content/types';
import * as THREE from 'three';
import { Guitar } from './audio/Guitar';
import { CONFIG } from './config';
import { CONTENT, CONTENT_VERSION } from './content';
import { InputSystem } from './input/InputSystem';
import type { SaveData } from './platform/saveData';
import { SCHEMA_VERSION } from './platform/saveData';
import { SaveStore, StaleRevisionError, exportSave } from './platform/SaveStore';
import type { Settings } from './platform/settings';
import { AssetLibrary } from './presentation/AssetLibrary';
import { CameraRig } from './presentation/CameraRig';
import { CityModel } from './presentation/CityModel';
import { CellView } from './presentation/CellView';
import { DistrictModel } from './presentation/DistrictModel';
import { dressIsland } from './presentation/IslandDressing';
import { Scatter } from './presentation/Scatter';
import { Environment, FOG_FAR } from './presentation/Environment';
import { Hud } from './presentation/Hud';
import { KitView } from './presentation/KitView';
import { buildMachines } from './presentation/Machines';
import { Fx } from './presentation/Fx';
import { PostFx } from './presentation/PostFx';
import { Stage } from './presentation/Stage';
import { Tram } from './presentation/Tram';
import { EventBus, type DomainEvent } from './sim/events';
import { FixedStepLoop } from './sim/FixedStepLoop';
import type { KitIntent } from './sim/Kit';
import { PhrasePerformer } from './sim/PhrasePerformer';
import { Simulation } from './sim/Simulation';
import { CellStreamer } from './story/CellStreamer';
import { districtAt, findObject, worldBounds } from './story/cells';
import { Director } from './story/Director';
import { StoryState } from './story/StoryState';
import { MapView, type MapBlip } from './ui/MapView';
import { AudioTimeSource, SilentTimeSource, Transport, scheduleClick } from './transport/Transport';

/** Shell callbacks: the HTML UI owns the pause screen; the game only reports state changes. */
export interface GameUi {
  onPause(reason: string): void;
  onResume(): void;
  /** The campaign is finished: roll the credits. */
  onEnding(): void;
}

export interface GameOptions {
  audio: AudioContext | null;
  settings: Settings;
  saveStore: SaveStore | null;
  save: SaveData;
  ui: GameUi;
}

/** Heavy assets fetched (with progress) before the player presses New Game / Continue. */
export interface Preloaded {
  assets: AssetLibrary | null;
  city: CityModel | null;
}

/** Progress callback: fraction 0–1 and a short status line. */
export type LoadProgress = (fraction: number, status: string) => void;

const FREE_PLAY = 'Bellweather keeps its own time now. Play anywhere.';
const INTERACT_RANGE = 5;
const INTERACT_CONE = Math.cos((70 * Math.PI) / 180);

/**
 * Wires the five runtime modules together:
 *   Input & transport → Simulation → Story & world → Presentation, with Platform at the edges.
 * Simulation runs on a fixed 60 Hz step; presentation interpolates and reads snapshots.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: InputSystem;
  readonly transport: Transport;
  readonly sim: Simulation;
  readonly story: StoryState;
  readonly streamer: CellStreamer;
  readonly cellView: CellView;
  readonly hud = new Hud();
  readonly bus = new EventBus();
  readonly director: Director;

  /** Dev toggles. */
  noclip = false;
  /** Audible click on every beat. Off by default: the beat lamp shows the pulse silently. */
  metronome = false;

  private readonly loop = new FixedStepLoop(CONFIG.sim.dt, CONFIG.sim.maxCatchUpSteps);
  private readonly env: Environment;
  private readonly post: PostFx;
  private readonly kitView: KitView;
  private readonly rig: CameraRig;
  private readonly performer: PhrasePerformer;
  private readonly stage: Stage;
  private readonly guitar: Guitar | null;
  /** A finished step waiting for its lines to play out before the cut. */
  private pendingCut: StepDef | null = null;
  private quiet = 0;
  private lastStepId: string | null = null;
  private ended = false;
  private scatter: Scatter | null = null;
  private tram: Tram | null = null;
  private tramBox: { move(c: { x: number; y: number; z: number }, yaw: number): void } | null =
    null;
  private districts: Array<{
    sheet: DistrictSheet;
    x: number;
    z: number;
    radius: number;
    root: THREE.Object3D | null;
  }> = [];
  private streamTimer = 0;
  private frameCount = 0;
  /** Adaptive resolution: 1 = full, lowered while frames run long. */
  private dynScale = 1;
  private slowFor = 0;
  private fastFor = 0;
  private lastReal = 0;
  private readonly fx: Fx;
  private readonly map: MapView;
  private hearts = CONFIG.kitHearts;
  private coins = 0;
  private lensOn = false;
  private clock = 0;
  private readonly aim = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();
  private saving: Promise<void> = Promise.resolve();
  private learnedCount = 0;
  private settings: Settings;
  private readonly ui: GameUi;
  private readonly saveStore: SaveStore | null;
  private revision: number;
  private selectedPhrase = 0;
  private consecutiveMisses = 0;
  private focusedReceiver: string | null = null;
  private last = 0;
  private rafId = 0;
  private wasLocked = false;
  private readonly tmp = new THREE.Vector3();

  /**
   * Fetch physics and models, reporting real progress (bytes for models, steps otherwise).
   * Throws if a required piece fails, so the loading screen can offer a retry.
   */
  static async preload(onProgress: LoadProgress): Promise<Preloaded> {
    const parts = { physics: 0, kit: 0, city: 0 };
    const weights = { physics: 0.15, kit: 0.25, city: 0.6 };
    const report = (status: string) =>
      onProgress(
        parts.physics * weights.physics + parts.kit * weights.kit + parts.city * weights.city,
        status,
      );
    report('Waking the tram line…');
    const physics = RAPIER.init().then(() => {
      parts.physics = 1;
      report('Laying the paving stones…');
    });
    const cast = [...new Set(CONTENT.actors.flatMap((a) => (a.model ? [a.model] : [])))];
    const assets = AssetLibrary.load(
      undefined,
      (f) => {
        parts.kit = f;
        report(f < 0.3 ? 'Tuning Kit’s guitar…' : 'Waking the neighbours…');
      },
      cast,
    );
    const city =
      CONTENT.world.autoFloors === false
        ? assets.then((lib) =>
            CityModel.load(
              undefined,
              (f) => {
                parts.city = f;
                report('Loading the quay…');
              },
              lib.scatter.has('tree_island'),
            ),
          )
        : Promise.resolve(null);
    const [, a, c] = await Promise.all([physics, assets, city]);
    if (CONTENT.world.autoFloors === false && !c) throw new Error('the city model failed to load');
    parts.physics = parts.kit = parts.city = 1;
    report('Ready.');
    return { assets: a, city: c };
  }

  static create(container: HTMLElement, opts: GameOptions, pre: Preloaded): Game {
    return new Game(container, opts, pre.assets, pre.city);
  }

  private constructor(
    private readonly container: HTMLElement,
    opts: GameOptions,
    readonly assets: AssetLibrary | null,
    readonly city: CityModel | null = null,
  ) {
    this.settings = opts.settings;
    this.ui = opts.ui;
    this.saveStore = opts.saveStore;
    this.revision = opts.save.revision;

    // ---- presentation: renderer ----
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92; // evening light
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      2000,
    );

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.pause('Graphics context lost — waiting for the browser to restore it.');
    });
    canvas.addEventListener('webglcontextrestored', () => this.ui.onPause('Graphics restored.'));

    // ---- story & world ----
    this.story = new StoryState(CONTENT);
    this.story.restore({
      facts: opts.save.questFacts,
      unlockedVersions: opts.save.unlockedVersions,
      activeVersion: opts.save.activeVersion,
      lastSafePad: opts.save.lastSafePad,
    });

    // ---- simulation ----
    const { world } = CONTENT;
    const pad = this.padPosition(this.story.lastSafePad);
    this.sim = new Simulation(RAPIER, { x: pad.x, y: pad.y + 1, z: pad.z }, worldBounds(world));

    if (city) {
      this.scene.add(city.root);
      for (const c of city.colliders) this.sim.addStaticMesh(c.vertices, c.indices);
    }
    // nature models, instanced: trees, shore rock, cliffs, grass
    if (city && assets?.scatter.size) {
      this.sim.refreshQueries();
      const scatter = new Scatter(assets.scatter);
      this.scatter = scatter;
      const boxes = dressIsland(scatter, city.treeSpots, (x, z) => this.sim.heightAt(x, z));
      this.scene.add(scatter.root);
      for (const b of boxes) {
        this.sim.addStaticBox(
          { x: b.center[0], y: b.center[1], z: b.center[2] },
          { x: b.half[0], y: b.half[1], z: b.half[2] },
          b.yaw,
        );
      }
    }
    // the mainland arrives district by district as Kit gets near (see streamDistricts)
    this.districts = CONTENT.sheets.map((sheet) => {
      const pts = sheet.lands.flatMap((l) => l.outline);
      const xs = pts.map((q) => q[0]);
      const zs = pts.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      return {
        sheet,
        x: cx,
        z: cz,
        radius: Math.hypot(Math.max(...xs) - cx, Math.max(...zs) - cz),
        root: null,
      };
    });
    this.streamDistricts(pad.x, pad.z);
    this.scene.add(buildMachines(CONTENT.world));
    this.cellView = new CellView(this.scene, assets);
    this.streamer = new CellStreamer(
      CONTENT,
      [this.sim, this.cellView],
      CONFIG.streaming.loadRadius,
      CONFIG.streaming.unloadRadius,
    );
    this.streamer.update(pad.x, pad.z, this.story.activeVersion, Infinity);

    this.env = new Environment(this.scene, CONTENT.world.waterLevel ?? null, {
      width: 8 * world.cellSize,
      depth: 6 * world.cellSize,
    });
    this.env.bakeLighting(this.renderer);
    this.env.loadSky();
    this.post = new PostFx(this.renderer, this.scene, this.camera);
    this.kitView = new KitView(this.scene, assets);
    this.rig = new CameraRig(this.camera, (o, d, m) => this.sim.rayDistance(o, d, m));

    // ---- input & transport ----
    this.input = new InputSystem(canvas, this.settings.bindings);
    const source = opts.audio ? new AudioTimeSource(opts.audio) : new SilentTimeSource();
    this.transport = new Transport(
      source,
      CONFIG.music.bpm,
      CONFIG.music.beatsPerBar,
      CONFIG.music.schedulerIntervalMs,
      CONFIG.music.scheduleAheadS,
    );
    if (opts.audio) {
      const ctx = opts.audio;
      this.transport.onBeat((beat, time) => {
        if (this.metronome) {
          scheduleClick(
            ctx,
            time,
            beat % CONFIG.music.beatsPerBar === 0,
            this.settings.effectsVolume * this.settings.masterVolume,
          );
        }
      });
    }
    this.performer = new PhrasePerformer(this.transport);
    this.guitar = opts.audio
      ? new Guitar(opts.audio, () => this.settings.musicVolume * this.settings.masterVolume)
      : null;
    this.stage = new Stage(this.scene, assets);
    this.director = new Director(CONTENT, this.story, {
      groundY: (x, z, nearY) => this.sim.groundY(x, z, nearY),
      say: (lines) => this.hud.say(lines),
      cue: (kind) => {
        this.guitar?.cue(kind);
        const earned = { coin: 3, enemyDown: 15, pickup: 5 }[kind as string] ?? 0;
        if (earned) this.coins += earned;
      },
      caught: (by) => this.onCaught(by),
      stepCompleted: (step) => this.onStepCompleted(step),
    });
    this.fx = new Fx(this.scene);
    if (assets?.has('KIT_tram_hunyuan')) {
      this.tram = new Tram(assets.instance('KIT_tram_hunyuan'), () => {
        // the bell carries a fair way along the quay, then fades
        const k = this.sim.kit.curr;
        if (this.tram && Math.hypot(this.tram.position.x - k.x, this.tram.position.z - k.z) < 90) {
          this.guitar?.bell();
        }
      });
      this.scene.add(this.tram.root);
      this.tramBox = this.sim.addKinematicBox({ x: 4.5, y: 1.6, z: 1.16 });
      this.tramBox.move(this.tram.position, this.tram.yaw);
    }
    this.map = new MapView(CONTENT.world);
    this.coins = opts.save.coins ?? 0;
    this.bus.on((e) => this.onDomainEvent(e));

    // ---- platform: focus / visibility ----
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause('Paused while the tab was hidden.');
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (this.wasLocked && !locked && !this.loop.paused) this.pause('Paused.');
      this.wasLocked = locked;
    });
    canvas.addEventListener('click', () => {
      if (!this.loop.paused) this.input.requestPointerLock();
    });
    window.addEventListener('resize', () => this.onResize());

    this.hud.setVersion(this.versionDef(this.story.activeVersion));
    this.hud.setRank(this.story.rank.title);
    if (!this.saveStore)
      this.setSaveStatus('Temporary session: progress is not saved. Use Export.');
    this.applySettings(this.settings);
  }

  /** Apply (possibly changed) settings live: display, camera, controls. */
  applySettings(s: Settings): void {
    this.settings = s;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2) * s.renderScale * this.dynScale,
    );
    this.post.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
      this.renderer.getPixelRatio(),
    );
    this.renderer.shadowMap.enabled = s.shadows !== 'off';
    const size = s.shadows === 'high' ? 4096 : 2048;
    if (this.env.sun.shadow.mapSize.x !== size) {
      this.env.sun.shadow.mapSize.set(size, size);
      this.env.sun.shadow.map?.dispose();
      this.env.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.rig.lookScale = s.mouseSensitivity;
    this.rig.invertY = s.invertY;
    this.input.setOverrides(s.bindings);
  }

  /** District, chapter and objective for the pause screen. */
  status(): { district: string; chapter: string; objective: string } {
    const ch = this.story.currentChapter;
    const step = this.story.currentStep;
    const district = CONTENT.world.districts.find((d) => d.id === ch?.district)?.name ?? '';
    return { district, chapter: ch?.title ?? '', objective: step?.objective ?? FREE_PLAY };
  }

  /** Reload the last committed checkpoint (story + position). */
  async restartCheckpoint(): Promise<boolean> {
    const loaded = await this.saveStore?.loadLatest().catch(() => null);
    if (!loaded) return false;
    const before = this.story.activeVersion;
    this.story.restore({
      facts: loaded.save.questFacts,
      unlockedVersions: loaded.save.unlockedVersions,
      activeVersion: loaded.save.activeVersion,
      lastSafePad: loaded.save.lastSafePad,
    });
    this.revision = loaded.save.revision;
    this.afterStoryChange(before);
    this.pendingCut = null;
    this.coins = loaded.save.coins ?? 0;
    this.hearts = CONFIG.kitHearts;
    this.director.reset();
    this.teleportToPad(this.story.lastSafePad);
    return true;
  }

  start(): void {
    this.hud.show(true);
    this.transport.start(1);
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
    this.input.requestPointerLock();
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.transport.dispose();
  }

  // ---------------------------------------------------------------- frame

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.25));
    this.last = now;

    this.input.pollGamepads();
    const esc = !!this.input.consume('pause', 'pressed');
    if (!this.loop.paused && !this.pendingCut) {
      if (this.input.consume('map', 'pressed')) this.setMapOpen(!this.map.open);
      else if (esc && this.map.open) this.setMapOpen(false);
      else if (esc) this.pause('Paused.');
    } else if (esc && !this.loop.paused) this.pause('Paused.');

    if (!this.loop.paused && this.map.open) {
      // the world holds still while the map is up; only the map redraws
      this.input.takeMouseDelta();
      this.clock += dt;
      this.drawMap();
    } else if (!this.loop.paused) {
      this.clock += dt;
      this.handleFrameActions();
      if (this.tram && this.tramBox) {
        // the story scenes at the stop need the tram standing there
        const id = this.story.currentStep?.id ?? '';
        const hold = id.startsWith('l2.') || ['l4.doors', 'l4.collector', 'l4.key'].includes(id);
        this.tram.update(dt, this.sim.kit.curr, hold);
        this.tramBox.move(this.tram.position, this.tram.yaw);
      }
      const { steps, alpha } = this.loop.advance(dt);
      const intent = this.intent();
      for (let i = 0; i < steps; i++) this.sim.step(intent);
      if (this.sim.kit.recoverIfFallen(CONTENT.world.waterLevel)) {
        this.hud.caption('Back to the last safe landing.');
      }

      const k = this.sim.kit.curr;
      this.streamer.update(k.x, k.z, this.story.activeVersion);
      const interact = !this.noclip && !!this.input.consume('interact', 'pressed');
      if (this.pendingCut) this.advanceCut(dt);
      else this.director.update(dt, k, interact);
      this.kitView.update(this.sim.kit, alpha, dt, this.performer.strumming);
      const mouse = this.input.takeMouseDelta();
      this.rig.update(dt, this.kitView.position, {
        dx: mouse.dx,
        dy: mouse.dy,
        padX: this.input.rightStick.x,
        padY: this.input.rightStick.y,
      });
      this.env.update(this.kitView.position, this.camera, dt);
      this.updatePresentation(dt);
    }

    this.cullAndPace(dt);
    this.post.render();
  };

  /**
   * Build mainland districts when Kit comes within sight of them — the haze ends at FOG_FAR, so
   * a district appears out of the fog rather than popping in — and add their colliders then.
   */
  private streamDistricts(x: number, z: number): void {
    for (const d of this.districts) {
      if (d.root || Math.hypot(d.x - x, d.z - z) - d.radius > FOG_FAR + 60) continue;
      const model = new DistrictModel([d.sheet]);
      d.root = model.root;
      this.scene.add(model.root);
      for (const c of model.meshes) this.sim.addStaticMesh(c.vertices, c.indices);
      for (const b of model.boxes) {
        this.sim.addStaticBox(
          { x: b.center[0], y: b.center[1], z: b.center[2] },
          { x: b.half[0], y: b.half[1], z: b.half[2] },
          b.yaw,
        );
      }
    }
  }

  /** Per frame: load what is coming into view, hide what the haze covers, keep the frame rate. */
  private cullAndPace(dt: number): void {
    const cam = this.camera.position;
    const k = this.sim.kit.curr;
    if ((this.streamTimer -= dt) <= 0) {
      this.streamTimer = 0.5;
      this.streamDistricts(k.x, k.z);
    }
    // anything wholly beyond the haze is not drawn at all
    const w = CONTENT.world;
    if (this.city) {
      const ix = 4 * w.cellSize;
      const iz = 3 * w.cellSize;
      this.city.root.visible = Math.hypot(cam.x - ix, cam.z - iz) < FOG_FAR + 340;
    }
    for (const d of this.districts) {
      if (d.root) d.root.visible = Math.hypot(cam.x - d.x, cam.z - d.z) - d.radius < FOG_FAR;
    }
    this.scatter?.cull(cam);

    // the big sun shadow is redrawn every other frame; nothing in it moves fast enough to show
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = this.frameCount++ % 2 === 0;

    // adaptive resolution: trade sharpness for smoothness when frames run long, and back again
    const now = performance.now();
    const real = now - this.lastReal;
    this.lastReal = now;
    if (real <= 0 || real > 250 || this.loop.paused) return;
    this.slowFor = real > 21 ? this.slowFor + real : 0;
    this.fastFor = real < 14 ? this.fastFor + real : 0;
    let next = this.dynScale;
    if (this.slowFor > 1200) next = Math.max(0.55, this.dynScale - 0.1);
    else if (this.fastFor > 4000) next = Math.min(1, this.dynScale + 0.1);
    if (next === this.dynScale) return;
    this.dynScale = next;
    this.slowFor = this.fastFor = 0;
    this.post.contactShading = next > 0.7;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2) * this.settings.renderScale * next,
    );
    this.post.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
      this.renderer.getPixelRatio(),
    );
  }

  /** Camera-relative movement intent for this frame's fixed steps. */
  private intent(): KitIntent {
    const m = this.input.moveAxis();
    const s = Math.sin(this.rig.yaw);
    const c = Math.cos(this.rig.yaw);
    return {
      moveX: -s * m.y + c * m.x,
      moveZ: -c * m.y - s * m.x,
      jog: this.input.isDown('jog'),
      noclip: this.noclip,
      // Noclip only: E up, Q down.
      rise: (this.input.isDown('interact') ? 1 : 0) - (this.input.isDown('listen') ? 1 : 0),
    };
  }

  private handleFrameActions(): void {
    const learned = this.story.learnedPhrases;
    if (this.input.consume('phraseNext', 'pressed')) this.selectedPhrase++;
    if (this.input.consume('phrasePrev', 'pressed')) this.selectedPhrase--;
    (['phrase1', 'phrase2', 'phrase3'] as const).forEach((a, i) => {
      if (this.input.consume(a, 'pressed')) this.selectedPhrase = i;
    });
    if (learned.length) {
      this.selectedPhrase =
        ((this.selectedPhrase % learned.length) + learned.length) % learned.length;
    }
    if (this.input.consume('recenter', 'pressed')) this.rig.recenterBehind(this.sim.kit.facing);

    this.focusedReceiver = this.findFocusedReceiver();

    if (this.input.consume('timeSkip', 'pressed')) this.env.setHour(Math.floor(this.env.hour) + 1);
    if (this.input.consume('weatherNext', 'pressed')) this.env.nextWeather();
    if (this.input.consume('goggles', 'pressed')) {
      if (this.story.has('goggles.collected')) this.lensOn = !this.lensOn;
      else this.hud.caption('Kit has nothing to look through yet.');
    }

    const press = this.input.consume('play', 'pressed');
    const release = this.input.consume('play', 'released');
    const phrase = learned[this.selectedPhrase];
    if (press && phrase && !this.performer.strumming) this.guitar?.mute();
    if (!phrase) {
      if (press) this.hud.caption('Kit hasn’t learned a phrase yet.');
      return;
    }
    const result = this.performer.handle(press, release, {
      windowMs: CONFIG.music.windowMs,
      calibrationMs: this.settings.calibrationMs,
      assisted: this.settings.assistedRelease,
      holdAsTwoTaps: this.settings.holdAsTwoTaps,
    });
    if (!result) return;

    const hit = result.judgement === 'hit';
    this.guitar?.release(phrase, hit);
    // rings leave the guitar towards whatever the phrase was aimed at
    const kc = this.sim.kit.curr;
    this.mouth.set(kc.x, kc.y + 0.25, kc.z);
    const receiver = this.focusedReceiver && this.cellView.receivers.get(this.focusedReceiver);
    const foe = this.director.enemy;
    let target: THREE.Vector3 | null = null;
    if (receiver) target = this.aim.copy(receiver.position);
    else if (foe && Math.hypot(foe.x - kc.x, foe.z - kc.z) <= 14)
      target = this.aim.set(foe.x, foe.y + (foe.def.height ?? 1.7) * 0.6, foe.z);
    this.fx.phrase(this.mouth, target, hit);
    const ms = Math.round(Math.abs(result.offsetMs));
    this.hud.flashJudgement(
      result.judgement === 'hit'
        ? `On the beat (${ms} ms)`
        : `${result.judgement === 'early' ? 'Early' : 'Late'} by ${ms} ms`,
    );
    this.consecutiveMisses = result.judgement === 'hit' ? 0 : this.consecutiveMisses + 1;
    if (this.consecutiveMisses === 2 && !this.settings.assistedRelease) {
      this.hud.caption(
        'Tip: assisted release is available in Settings — same outcome, gentler timing.',
      );
    }
    this.bus.emit({
      type: 'phraseReleased',
      phrase,
      receiver: this.focusedReceiver,
      judgement: result.judgement,
      offsetMs: result.offsetMs,
    });
  }

  /** Nearest receiver in range inside the camera's forward cone. */
  private findFocusedReceiver(): string | null {
    const k = this.sim.kit.curr;
    const fx = -Math.sin(this.rig.yaw);
    const fz = -Math.cos(this.rig.yaw);
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, mesh] of this.cellView.receivers) {
      const dx = mesh.position.x - k.x;
      const dz = mesh.position.z - k.z;
      const d = Math.hypot(dx, dz, mesh.position.y - k.y);
      if (d > INTERACT_RANGE || d >= bestD) continue;
      const h = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / h < INTERACT_CONE && d > 1.5) continue;
      best = id;
      bestD = d;
    }
    return best;
  }

  private updatePresentation(dt: number): void {
    const beat = this.transport.heardBeat();
    this.hud.setBeat(beat, CONFIG.music.beatsPerBar, this.settings.reducedMotion);
    const phase = beat - Math.floor(beat);
    this.cellView.pulseMaterial.emissiveIntensity = 0.3 + Math.max(0, 1 - phase * 2) * 0.9;

    const learned = this.story.learnedPhrases;
    const phraseId = learned[this.selectedPhrase];
    const phrase = CONTENT.phrases.find((p) => p.id === phraseId);
    this.hud.setPhrase(phrase?.name ?? null, this.performer.strumming);

    const k = this.sim.kit.curr;
    const step = this.pendingCut ? null : this.director.step;
    const tgt = this.director.target;
    this.hud.setObjective(
      this.story.currentChapter?.title ?? '',
      this.pendingCut ? null : (step?.objective ?? FREE_PLAY),
      step && tgt ? Math.hypot(tgt.x - k.x, tgt.z - k.z) : null,
    );
    const foe = this.pendingCut ? null : this.director.enemy;
    this.hud.setEnemy(foe ? foe.def.name : null, foe?.hp, foe?.def.hp);
    this.stage.sync(this.director, dt, beat, this.kitView.position);
    this.fx.update(dt, this.camera);
    this.hud.setVitals(this.hearts, CONFIG.kitHearts, this.coins, this.districtAt(k.z));
    this.hud.setClock(this.env.label);
    this.updateLens(dt);
    this.drawMap();
    this.followStepPhrase();

    if (this.director.prompt && !this.pendingCut) {
      this.hud.setPrompt(this.director.prompt);
    } else if (this.focusedReceiver) {
      const name = this.focusedReceiver.split('.').slice(1).join(' ');
      this.hud.setPrompt(
        phrase
          ? `Hold F, release on the downbeat — play ${phrase.name} into the ${name}`
          : `A receiver (${name}) — learn a phrase first`,
      );
    } else {
      this.hud.setPrompt(null);
    }
    this.hud.tick(dt);
  }

  // ---------------------------------------------------------------- story

  private onDomainEvent(e: DomainEvent): void {
    const versionBefore = this.story.activeVersion;
    const completed = this.story.handle(e);
    if (completed.length) {
      for (const m of completed) this.hud.say(m.feedback);
      this.afterStoryChange(versionBefore);
      void this.checkpoint();
    }
    if (e.type === 'phraseReleased') this.director.onPhrase(e, this.sim.kit.curr);
  }

  /** An enemy reached Kit: lose a heart and get thrown clear, or go back to the pad at zero. */
  private onCaught(by: { x: number; z: number }): boolean {
    this.hearts--;
    this.hud.hurt();
    if (this.hearts <= 0) {
      this.hearts = CONFIG.kitHearts;
      this.teleportToPad(this.story.lastSafePad);
      return true;
    }
    const k = this.sim.kit.curr;
    const d = Math.hypot(k.x - by.x, k.z - by.z) || 1;
    const x = k.x + ((k.x - by.x) / d) * 6;
    const z = k.z + ((k.z - by.z) / d) * 6;
    const feet = k.y - 0.9;
    const ground = this.sim.groundY(x, z, feet);
    // only throw him somewhere he can stand
    if (Math.abs(ground - feet) < 1.2) this.sim.kit.teleport({ x, y: ground + 0.95, z });
    return false;
  }

  private districtAt(z: number): string {
    return districtAt(CONTENT.world, this.sim.kit.curr.x, z)?.name ?? 'Bellweather Bay';
  }

  private setMapOpen(open: boolean): void {
    if (open && !this.map.available) return;
    this.map.setOpen(open);
    this.performer.cancel();
    if (open) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.wasLocked = false;
      const st = this.status();
      this.hud.setMapPanel(this.districtAt(this.sim.kit.curr.z), st.chapter, st.objective);
    } else this.input.requestPointerLock();
    this.hud.show(!open);
  }

  private drawMap(): void {
    const k = this.sim.kit.curr;
    const blips: MapBlip[] = [];
    for (const a of this.director.actors.values()) {
      blips.push({
        x: a.x,
        z: a.z,
        kind: a.def.kind === 'enemy' ? 'enemy' : 'resident',
        label: a.def.name,
      });
    }
    const t = this.pendingCut ? null : this.director.target;
    if (t) {
      // an objective that is a person or machine already has a name on the map
      const named = blips.some((b) => Math.hypot(b.x - t.x, b.z - t.z) < 2);
      blips.push({ x: t.x, z: t.z, kind: 'objective', label: named ? undefined : 'Objective' });
    }
    this.map.draw({
      x: k.x,
      z: k.z,
      facing: this.sim.kit.facing,
      yaw: this.rig.yaw,
      blips,
      objective: this.director.step?.objective ?? '',
      district: this.districtAt(k.z),
      time: this.clock,
    });
  }

  /** Goggles: tint the frame and pin a reticle on the objective, wherever it is. */
  private updateLens(dt: number): void {
    const on = this.lensOn && !this.pendingCut;
    this.post.lens = THREE.MathUtils.clamp(
      this.post.lens + ((on ? 1 : 0) - this.post.lens) * (1 - Math.exp(-dt * 10)),
      0,
      1,
    );
    const t = this.director.target;
    if (!on || !t) return this.hud.setLens(on, null);
    const k = this.sim.kit.curr;
    const foe = this.director.enemy;
    this.aim.set(t.x, t.y + (foe ? (foe.def.height ?? 1.7) * 0.55 : 1.2), t.z);
    const behind = this.aim.clone().applyMatrix4(this.camera.matrixWorldInverse).z > 0;
    this.aim.project(this.camera);
    let x = this.aim.x;
    let y = this.aim.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const edge = behind || Math.abs(x) > 0.86 || Math.abs(y) > 0.8;
    if (edge) {
      const m = Math.max(Math.abs(x) / 0.86, Math.abs(y) / 0.8, 1e-3);
      x /= m;
      y /= m;
    }
    this.hud.setLens(true, {
      x: (x * 0.5 + 0.5) * 100,
      y: (-y * 0.5 + 0.5) * 100,
      edge,
      label: `${foe ? foe.def.name : 'Objective'} · ${Math.round(Math.hypot(t.x - k.x, t.z - k.z))} m`,
    });
  }

  /** A campaign step finished: save, and line up its cut (travel card or ending) if it has one. */
  private onStepCompleted(step: StepDef): void {
    this.hud.setRank(this.story.rank.title);
    this.hearts = CONFIG.kitHearts;
    // the first look through Mara's goggles
    if (step.effects?.facts?.includes('lens.raisedOnce')) this.lensOn = true;
    if (step.effects?.travelTo || step.effects?.ending) {
      this.pendingCut = step;
      this.quiet = 0;
    }
    void this.checkpoint();
  }

  /** Let the step's closing lines finish, then fade to the card and move Kit (or end the game). */
  private advanceCut(dt: number): void {
    this.quiet = this.hud.speaking ? 0 : this.quiet + dt;
    if (this.quiet < 2.4) return;
    const fx = this.pendingCut!.effects!;
    this.quiet = -Infinity; // fire once; cleared when the card is opaque
    if (fx.ending) {
      this.hud.showCard('Bellweather', 'keeps its own time', () => this.ui.onEnding(), 2200);
      return;
    }
    const [title = '', sub = ''] = (fx.card ?? '').split('|');
    this.hud.showCard(title, sub, () => {
      this.teleportToPad(fx.travelTo!);
      this.rig.recenterBehind(this.sim.kit.facing);
      this.pendingCut = null;
    });
  }

  /** Select the phrase the current step asks for, and any phrase Kit has just learned. */
  private followStepPhrase(): void {
    const learned = this.story.learnedPhrases;
    const step = this.director.step;
    if (learned.length !== this.learnedCount) {
      this.learnedCount = learned.length;
      this.selectedPhrase = learned.length - 1;
    }
    if (!step || step.id === this.lastStepId) return;
    this.lastStepId = step.id;
    const t = step.trigger;
    const wanted =
      t.type === 'perform' || t.type === 'play'
        ? t.phrase
        : t.type === 'fact'
          ? CONTENT.missions.find((m) => m.effects.facts.includes(t.fact))?.trigger.phrase
          : undefined;
    const i = wanted ? learned.indexOf(wanted) : -1;
    if (i >= 0) this.selectedPhrase = i;
  }

  /** Stop simulating for good (the credits take over). */
  endSession(): void {
    this.ended = true;
    this.loop.pause();
    this.transport.pause();
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show(false);
  }

  /** Apply a version change and refresh HUD after any story mutation. */
  afterStoryChange(versionBefore: VersionId): void {
    if (this.story.activeVersion !== versionBefore) {
      this.streamer.reloadAll(this.story.activeVersion);
      this.hud.setVersion(this.versionDef(this.story.activeVersion));
    }
    this.hud.setRank(this.story.rank.title);
  }

  setActiveVersion(v: VersionId, force = false): void {
    const before = this.story.activeVersion;
    if (force) this.story.unlockedVersions.add(v);
    if (this.story.setActiveVersion(v)) this.afterStoryChange(before);
  }

  // ---------------------------------------------------------------- saves

  buildSave(): Omit<SaveData, 'revision'> {
    const s = this.story.snapshot();
    return {
      schemaVersion: SCHEMA_VERSION,
      contentVersion: CONTENT_VERSION,
      lastSafePad: s.lastSafePad,
      activeVersion: s.activeVersion,
      unlockedVersions: s.unlockedVersions,
      learnedPhrases: this.story.learnedPhrases,
      questFacts: s.facts,
      coins: this.coins,
      completedStories: [],
      endingChoice: null,
    };
  }

  /** Commit a checkpoint. Calls are queued so two saves never race on the same revision. */
  checkpoint(): Promise<void> {
    this.saving = this.saving.then(() => this.commitCheckpoint());
    return this.saving;
  }

  private async commitCheckpoint(): Promise<void> {
    if (!this.saveStore) return;
    try {
      const saved = await this.saveStore.commit(this.buildSave(), this.revision);
      this.revision = saved.revision;
      this.setSaveStatus(`Saved (revision ${saved.revision}).`);
    } catch (err) {
      if (err instanceof StaleRevisionError) {
        this.setSaveStatus(
          'Another tab saved newer progress. Reload this tab or export before continuing.',
        );
      } else {
        this.setSaveStatus('Unsaved progress — saving failed. Use Export to keep it.');
      }
      console.error(err);
    }
  }

  exportCurrentSave(): void {
    const blob = new Blob([exportSave({ ...this.buildSave(), revision: this.revision })], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'coolguy-save.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private setSaveStatus(text: string): void {
    document.getElementById('save-status')!.textContent = text;
  }

  // ---------------------------------------------------------------- pause

  get paused(): boolean {
    return this.loop.paused;
  }

  pause(reason: string): void {
    if (this.ended) return;
    if (this.loop.paused) return this.ui.onPause(reason);
    if (this.map.open) this.map.setOpen(false);
    this.loop.pause();
    this.transport.pause();
    this.performer.cancel();
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show(false);
    this.ui.onPause(reason);
  }

  /** Resume needs a user gesture (restores audio + pointer). Counts in one bar. */
  resume(): void {
    if (!this.loop.paused || this.ended) return;
    this.input.consume('pause', 'pressed'); // the key that opened Pause must not re-pause
    this.loop.resume();
    void this.transport.resume();
    this.last = performance.now();
    this.hud.show(true);
    this.input.requestPointerLock();
    this.ui.onResume();
  }

  // ---------------------------------------------------------------- helpers

  private padPosition(id: string): THREE.Vector3 {
    const pad = findObject(CONTENT.world, CONTENT.versions, id) as PadDef | undefined;
    const fallback = findObject(CONTENT.world, CONTENT.versions, CONTENT.world.spawnPad) as PadDef;
    const p = (pad?.kind === 'pad' ? pad : fallback).position;
    return this.tmp.set(p[0], p[1], p[2]).clone();
  }

  teleportToPad(id: string): void {
    const p = this.padPosition(id);
    this.streamer.update(p.x, p.z, this.story.activeVersion, Infinity);
    this.streamDistricts(p.x, p.z);
    this.sim.kit.teleport({ x: p.x, y: p.y + 1, z: p.z });
  }

  private versionDef(id: VersionId) {
    return CONTENT.versions.find((v) => v.id === id)!;
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h, this.renderer.getPixelRatio());
  }
}
