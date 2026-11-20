import RAPIER from '@dimforge/rapier3d-compat';
import type { PadDef, StepDef, VersionId } from '@content/types';
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
import { Environment } from './presentation/Environment';
import { Hud } from './presentation/Hud';
import { KitView } from './presentation/KitView';
import { Stage } from './presentation/Stage';
import { EventBus, type DomainEvent } from './sim/events';
import { FixedStepLoop } from './sim/FixedStepLoop';
import type { KitIntent } from './sim/Kit';
import { PhrasePerformer } from './sim/PhrasePerformer';
import { Simulation } from './sim/Simulation';
import { CellStreamer } from './story/CellStreamer';
import { findObject } from './story/cells';
import { Director } from './story/Director';
import { StoryState } from './story/StoryState';
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
  metronome = true;

  private readonly loop = new FixedStepLoop(CONFIG.sim.dt, CONFIG.sim.maxCatchUpSteps);
  private readonly env: Environment;
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
    const assets = AssetLibrary.load(undefined, (f) => {
      parts.kit = f;
      report('Tuning Kit’s guitar…');
    });
    const city =
      CONTENT.world.autoFloors === false
        ? CityModel.load(undefined, (f) => {
            parts.city = f;
            report('Loading the quay…');
          })
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
    this.renderer.toneMappingExposure = 1.05;
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
    this.sim = new Simulation(
      RAPIER,
      { x: pad.x, y: pad.y + 1, z: pad.z },
      { width: world.cols * world.cellSize, depth: world.rows * world.cellSize },
    );

    if (city) {
      this.scene.add(city.root);
      for (const c of city.colliders) this.sim.addStaticMesh(c.vertices, c.indices);
    }
    this.cellView = new CellView(this.scene, assets);
    this.streamer = new CellStreamer(
      CONTENT,
      [this.sim, this.cellView],
      CONFIG.streaming.loadRadius,
      CONFIG.streaming.unloadRadius,
    );
    this.streamer.update(pad.x, pad.z, this.story.activeVersion, Infinity);

    this.env = new Environment(this.scene, CONTENT.world.waterLevel ?? null, {
      width: world.cols * world.cellSize,
      depth: world.rows * world.cellSize,
    });
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
    this.stage = new Stage(this.scene);
    this.director = new Director(CONTENT, this.story, {
      groundY: (x, z, nearY) => this.sim.groundY(x, z, nearY),
      say: (lines) => this.hud.say(lines),
      cue: (kind) => this.guitar?.cue(kind),
      caught: () => this.teleportToPad(this.story.lastSafePad),
      stepCompleted: (step) => this.onStepCompleted(step),
    });
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * s.renderScale);
    this.renderer.shadowMap.enabled = s.shadows !== 'off';
    const size = s.shadows === 'high' ? 2048 : 1024;
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
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;

    this.input.pollGamepads();
    if (this.input.consume('pause', 'pressed') && !this.loop.paused) this.pause('Paused.');

    if (!this.loop.paused) {
      this.handleFrameActions();
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
      this.env.update(this.kitView.position, this.camera);
      this.updatePresentation(dt);
    }

    this.renderer.render(this.scene, this.camera);
  };

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

    this.guitar?.release(phrase, result.judgement === 'hit');
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

  /** A campaign step finished: save, and line up its cut (travel card or ending) if it has one. */
  private onStepCompleted(step: StepDef): void {
    this.hud.setRank(this.story.rank.title);
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
  }
}
