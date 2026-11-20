import type { ActorDef, ContentBundle, StepDef, Vec3 } from '@content/types';
import type { DomainEvent } from '../sim/events';
import { findObject } from './cells';
import type { StoryState } from './StoryState';

export interface ActorState {
  def: ActorDef;
  x: number;
  y: number;
  z: number;
  /** Facing (radians around +Y). */
  facing: number;
  hp: number;
  /** Seconds the enemy stays stunned after an on-beat hit. */
  stagger: number;
  moving: boolean;
}

export type Cue = 'coin' | 'step' | 'enemyHit' | 'enemyDown' | 'caught' | 'pickup';

/** What the director needs from the rest of the game. */
export interface DirectorHost {
  groundY(x: number, z: number, nearY: number): number;
  say(lines: string[]): void;
  cue(kind: Cue): void;
  /**
   * An enemy reached Kit. The host takes a heart and knocks him back; it returns true when he
   * is out of hearts and has been sent back to the safe pad (the fight then starts over).
   */
  caught(by: ActorState): boolean;
  stepCompleted(step: StepDef): void;
}

type P3 = { x: number; y: number; z: number };

const TALK_RANGE = 2.6;
const USE_RANGE = 2.2;
const COLLECT_RANGE = 1.3;
const HIT_RANGE = 14;
const FOLLOW_GAP = 1.8;
const FOLLOW_SPEED = 2.7;
const LEASH = 12;
const KNOCKBACK = 3.5;

/**
 * Runs the campaign: brings actors on stage for the current step, evaluates its trigger,
 * drives escorts and enemies, and reports what the HUD should show. Pure logic — no rendering.
 */
export class Director {
  readonly actors = new Map<string, ActorState>();
  step: StepDef | null = null;
  /** On-beat releases landed towards a `perform` step. */
  hits = 0;
  /** Interact prompt for the HUD, if Kit is next to something usable. */
  prompt: string | null = null;
  /** Where the objective is (waypoint beacon). */
  target: P3 | null = null;
  /** The enemy being fought, for the HUD bar. */
  enemy: ActorState | null = null;
  private entered = false;
  private nagTimer = 0;

  constructor(
    private readonly content: ContentBundle,
    private readonly story: StoryState,
    private readonly host: DirectorHost,
  ) {}

  /** Re-stage the current step (after a checkpoint reload). */
  reset(): void {
    this.entered = false;
  }

  update(dt: number, kit: P3, interact: boolean): void {
    const current = this.story.currentStep;
    if (current !== this.step || !this.entered) this.enter(current);
    const step = this.step;
    this.prompt = null;
    if (!step) return;
    const feetY = kit.y - 0.9;
    this.nagTimer = Math.max(0, this.nagTimer - dt);
    for (const a of this.actors.values()) a.moving = false;

    const t = step.trigger;
    switch (t.type) {
      case 'talk': {
        const a = this.actors.get(t.npc)!;
        this.target = a;
        this.face(a, kit);
        if (dist(a, kit) < TALK_RANGE) {
          this.prompt = `Press E — talk to ${a.def.name}`;
          if (interact) this.complete();
        }
        break;
      }
      case 'use':
        this.target = v(t.position);
        if (dist(this.target, kit) < USE_RANGE) {
          this.prompt = `Press E — ${t.label}`;
          if (interact) this.complete();
        }
        break;
      case 'reach':
        this.target = v(t.position);
        if (dist(this.target, kit) < t.radius) this.complete();
        break;
      case 'collect':
        this.target = v(t.position);
        if (dist(this.target, kit) < COLLECT_RANGE) {
          this.host.cue('pickup');
          this.complete();
        }
        break;
      case 'perform':
        this.target = v(t.position);
        if (dist(this.target, kit) < t.radius) {
          this.prompt = `Hold F, release on the downbeat — ${t.hits - this.hits} to go`;
        }
        break;
      case 'play':
      case 'fact': {
        const r = findObject(this.content.world, this.content.versions, t.receiver);
        this.target = r && r.kind === 'receiver' ? v(r.position) : null;
        if (t.type === 'fact' && this.story.has(t.fact)) this.complete();
        break;
      }
      case 'escort': {
        const goal = v(t.position);
        this.target = goal;
        let leader: P3 = kit;
        let allIn = dist(goal, kit) < t.radius;
        for (const id of t.npcs) {
          const a = this.actors.get(id)!;
          const dKit = dist(a, kit);
          if (dKit > LEASH) {
            this.target = a;
            if (this.nagTimer === 0) {
              this.host.say([`${a.def.name}: Wait for me!`]);
              this.nagTimer = 7;
            }
          } else if (dist(a, leader) > FOLLOW_GAP) {
            this.moveTowards(a, leader, FOLLOW_SPEED * dt, feetY);
          } else this.face(a, leader);
          if (dist(a, goal) > t.radius + 3.5) allIn = false;
          leader = a;
        }
        if (allIn) this.complete();
        break;
      }
      case 'defeat': {
        const e = this.actors.get(t.enemy)!;
        this.enemy = e;
        this.target = e;
        const d = dist(e, kit);
        if (e.stagger > 0) e.stagger -= dt;
        else if (d < 45) this.moveTowards(e, kit, (e.def.speed ?? 2.4) * dt, feetY);
        this.prompt =
          d <= HIT_RANGE
            ? `Hold F, release on the downbeat — ${e.hp} to go. Don’t let it reach you.`
            : `Get within range of the ${e.def.name}`;
        if (d < 1.1 + 0.4 * (e.def.scale ?? 1) && e.stagger <= 0) {
          this.host.cue('caught');
          if (this.host.caught(e)) {
            this.host.say([`${e.def.name} resets the count. Back to the landing.`]);
            this.place(e);
          } else e.stagger = 1.8; // it winds up again while Kit gets clear
        }
        break;
      }
    }
  }

  /** Feed every released phrase (after missions have seen it). */
  onPhrase(e: Extract<DomainEvent, { type: 'phraseReleased' }>, kit: P3): void {
    const step = this.step;
    if (!step || this.story.currentStep !== step) return;
    const t = step.trigger;
    const hit = e.judgement === 'hit';
    if (t.type === 'perform') {
      if (dist(v(t.position), kit) >= t.radius) return;
      if (e.phrase !== t.phrase) return this.wrongPhrase(t.phrase);
      if (!hit) return;
      this.hits++;
      this.host.cue('coin');
      if (this.hits >= t.hits) this.complete();
    } else if (t.type === 'play') {
      if (e.receiver !== t.receiver) return;
      if (e.phrase !== t.phrase) return this.wrongPhrase(t.phrase);
      if (hit) this.complete();
    } else if (t.type === 'fact') {
      const m = this.content.missions.find((x) => x.effects.facts.includes(t.fact));
      if (m && e.receiver === t.receiver && e.phrase !== m.trigger.phrase) {
        this.wrongPhrase(m.trigger.phrase);
      }
    } else if (t.type === 'defeat') {
      const a = this.actors.get(t.enemy)!;
      if (!hit || dist(a, kit) > HIT_RANGE) return;
      a.hp--;
      a.stagger = 2.2;
      const d = Math.hypot(a.x - kit.x, a.z - kit.z) || 1;
      const home = v(a.def.position);
      const nx = a.x + ((a.x - kit.x) / d) * KNOCKBACK;
      const nz = a.z + ((a.z - kit.z) / d) * KNOCKBACK;
      if (Math.hypot(nx - home.x, nz - home.z) < 20) {
        const gy = this.host.groundY(nx, nz, a.y);
        if (Math.abs(gy - a.y) < 1) {
          a.x = nx;
          a.z = nz;
          a.y = gy;
        }
      }
      if (a.hp <= 0) {
        this.host.cue('enemyDown');
        this.complete();
      } else this.host.cue('enemyHit');
    }
  }

  /** Dev: finish the current step regardless of its trigger. */
  skip(): void {
    const t = this.step?.trigger;
    if (t?.type === 'fact') {
      const m = this.content.missions.find((x) => x.effects.facts.includes(t.fact));
      m?.effects.facts.forEach((f) => this.story.grant(f));
      m?.effects.unlockVersions.forEach((u) => this.story.unlockedVersions.add(u));
    }
    if (this.step) this.complete();
  }

  private wrongPhrase(id: string): void {
    const name = this.content.phrases.find((p) => p.id === id)?.name ?? id;
    if (this.nagTimer === 0) {
      this.host.say([`This one answers to ${name} (mouse wheel changes phrase).`]);
      this.nagTimer = 4;
    }
  }

  private complete(): void {
    const step = this.step;
    if (!step || !this.story.completeStep(step)) return;
    this.enemy = null;
    if (step.trigger.type !== 'perform' && step.trigger.type !== 'defeat') this.host.cue('step');
    if (step.lines?.length) this.host.say(step.lines);
    this.host.stepCompleted(step);
  }

  private enter(step: StepDef | null): void {
    const previous = new Map(this.actors);
    this.step = step;
    this.entered = true;
    this.hits = 0;
    this.enemy = null;
    this.target = null;
    this.actors.clear();
    for (const id of step?.actors ?? []) {
      const def = this.content.actors.find((a) => a.id === id)!;
      const kept = previous.get(id);
      // Residents stay where the last step left them (an escorted NPC keeps its place).
      if (kept && def.kind === 'npc' && !step?.effects?.travelTo) {
        this.actors.set(id, kept);
        continue;
      }
      const a: ActorState = { def, x: 0, y: 0, z: 0, facing: 0, hp: 0, stagger: 0, moving: false };
      this.place(a);
      this.actors.set(id, a);
    }
    if (step?.intro?.length) this.host.say(step.intro);
  }

  /** Put an actor on its mark with full health. */
  private place(a: ActorState): void {
    const [x, y, z] = a.def.position;
    a.x = x;
    a.z = z;
    a.y = this.host.groundY(x, z, y);
    a.hp = a.def.hp ?? 1;
    a.stagger = 0;
  }

  private moveTowards(a: ActorState, to: P3, stepLen: number, nearY: number): void {
    const dx = to.x - a.x;
    const dz = to.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return;
    const k = Math.min(1, stepLen / d);
    const nx = a.x + dx * k;
    const nz = a.z + dz * k;
    const gy = this.host.groundY(nx, nz, Math.max(a.y, nearY));
    // Don't walk off ledges or up walls.
    if (Math.abs(gy - a.y) > 0.7) return;
    a.x = nx;
    a.z = nz;
    a.y = gy;
    a.facing = Math.atan2(dx, dz);
    a.moving = true;
  }

  private face(a: ActorState, to: P3): void {
    a.facing = Math.atan2(to.x - a.x, to.z - a.z);
  }
}

const v = (p: Vec3): P3 => ({ x: p[0], y: p[1], z: p[2] });
/** Horizontal distance (heights differ by Kit's capsule offset). */
const dist = (a: P3, b: P3): number => Math.hypot(a.x - b.x, a.z - b.z);
