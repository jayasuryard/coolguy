/**
 * Authored-content contract. Shared by the game runtime and the tools (type-only imports),
 * so every JSON file under content/ is checked against the same shapes.
 * IDs are stable strings, never scene-node names.
 */

export type Vec3 = [number, number, number];

export type VersionId = 'timetable' | 'backstage' | 'keepsake' | 'openScore';
export const VERSION_IDS: readonly VersionId[] = [
  'timetable',
  'backstage',
  'keepsake',
  'openScore',
];

export interface BlockDef {
  id: string;
  kind: 'block';
  center: Vec3;
  size: Vec3;
  color?: string;
  /** Defaults to true. Every walkable or blocking surface needs a collider. */
  collide?: boolean;
  /** Defaults to true. false = collider only (the art comes from a `model`). */
  visual?: boolean;
}

/** A walkable incline whose top surface runs from `from` to `to`. */
export interface RampDef {
  id: string;
  kind: 'ramp';
  from: Vec3;
  to: Vec3;
  width: number;
  color?: string;
  /** Defaults to true. false = collider only (e.g. under a stair model). */
  visual?: boolean;
}

/**
 * An instance of a kit piece from game/public/assets/models (a GLB root named `KIT_*`).
 * Purely visual: pair it with collider-only blocks/ramps where it must be solid.
 */
export interface ModelDef {
  id: string;
  kind: 'model';
  model: string;
  position: Vec3;
  /** Degrees around +Y. */
  rotationY?: number;
}

/** Safe standing pad: respawn, booth and return-point anchor. */
export interface PadDef {
  id: string;
  kind: 'pad';
  position: Vec3;
}

/** Municipal speaker / machine input that a released phrase can hit. */
export interface ReceiverDef {
  id: string;
  kind: 'receiver';
  position: Vec3;
}

export type WorldObject = BlockDef | RampDef | PadDef | ReceiverDef | ModelDef;

export interface DistrictDef {
  id: string;
  name: string;
  /** Grid rows (z) belonging to this district. */
  rows: number[];
  floorY: number;
  color: string;
}

export interface CellDef {
  /** `cell.<col>.<row>` */
  id: string;
  objects: WorldObject[];
}

export interface WorldDef {
  cellSize: number;
  cols: number;
  rows: number;
  spawnPad: string;
  /**
   * Defaults to true: every cell gets a flat district floor slab. Set false when the city model
   * (game/public/assets/models/bellweather_city.glb) provides terrain and collision.
   */
  autoFloors?: boolean;
  /** Sea surface height when the city model is used (falling below it recovers Kit). */
  waterLevel?: number;
  districts: DistrictDef[];
  /** Only cells with authored objects need listing; floors are derived from districts. */
  cells: CellDef[];
}

export interface VersionOverlay {
  cell: string;
  hide?: string[];
  add?: WorldObject[];
}

export interface VersionDef {
  id: VersionId;
  name: string;
  icon: string;
  description: string;
  overlays: VersionOverlay[];
}

export interface FactDef {
  id: string;
  description: string;
}

export interface RankDef {
  rank: number;
  title: string;
  requires: string[];
}

export interface PhraseDef {
  id: string;
  name: string;
  /** Fact that marks the phrase as learned. */
  fact: string;
}

export interface MissionDef {
  id: string;
  version: VersionId;
  pad: string;
  requires: string[];
  trigger: { event: 'phraseReleased'; receiver: string; phrase: string };
  effects: {
    facts: string[];
    unlockVersions: VersionId[];
    activateVersion?: VersionId;
    returnPad?: string;
  };
  feedback: string[];
}

/** A campaign level as shown on the pause screen. */
export interface ChapterDef {
  id: string;
  title: string;
  /** District id (see WorldDef.districts). */
  district: string;
  objective: string;
  /** The chapter is complete once this fact is granted. */
  completeFact: string;
}

/** A character on the street: a resident to talk to or escort, or a machine to out-play. */
export interface ActorDef {
  id: string;
  name: string;
  kind: 'npc' | 'enemy';
  /** Where the actor stands when a step brings it on stage (y is snapped to the ground). */
  position: Vec3;
  color: string;
  /** Enemies: on-beat hits needed to shut it down. */
  hp?: number;
  /** Enemies: chase speed in m/s. */
  speed?: number;
  /** Visual size multiplier (1 = person-sized). */
  scale?: number;
}

export type StepTrigger =
  /** Press Interact next to a resident. */
  | { type: 'talk'; npc: string }
  /** Press Interact at a spot (an amp, a lever). */
  | { type: 'use'; position: Vec3; label: string }
  /** Walk into a radius. */
  | { type: 'reach'; position: Vec3; radius: number }
  /** Walk over a pickup. */
  | { type: 'collect'; position: Vec3; item: string }
  /** Land `hits` on-beat releases of a phrase while standing inside the radius. */
  | { type: 'perform'; position: Vec3; radius: number; phrase: string; hits: number }
  /** One on-beat release of a phrase into a receiver. */
  | { type: 'play'; receiver: string; phrase: string }
  /** Out-play an enemy: every on-beat release in range staggers it. */
  | { type: 'defeat'; enemy: string }
  /** Lead residents to a spot; they follow while Kit stays close. */
  | { type: 'escort'; npcs: string[]; position: Vec3; radius: number }
  /** Completed by a mission granting this fact; `receiver` is the waypoint. */
  | { type: 'fact'; fact: string; receiver: string };

/**
 * One objective of the campaign. Steps run strictly in order; finishing one grants the implicit
 * fact `step.<id>` (so progress lives in the save's quest facts) plus `effects.facts`.
 */
export interface StepDef {
  id: string;
  objective: string;
  trigger: StepTrigger;
  /** Actors on stage while this step is current. */
  actors?: string[];
  /** Captions when the step becomes current ("Speaker: line"). */
  intro?: string[];
  /** Captions when the step completes. */
  lines?: string[];
  effects?: {
    facts?: string[];
    /** Fade out, show the card, and put Kit on this pad (also the new safe pad). */
    travelTo?: string;
    /** Title card: "Title|subtitle". */
    card?: string;
    /** Roll the credits after this step. */
    ending?: boolean;
  };
}

/** Everything the runtime and the validator load. */
export interface ContentBundle {
  world: WorldDef;
  versions: VersionDef[];
  facts: FactDef[];
  ranks: RankDef[];
  phrases: PhraseDef[];
  missions: MissionDef[];
  chapters: ChapterDef[];
  actors: ActorDef[];
  steps: StepDef[];
  /** KIT_* roots available in the model library (filled by tools; absent in the runtime). */
  modelNames?: string[];
}
