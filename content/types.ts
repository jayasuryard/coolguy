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

/** Everything the runtime and the validator load. */
export interface ContentBundle {
  world: WorldDef;
  versions: VersionDef[];
  facts: FactDef[];
  ranks: RankDef[];
  phrases: PhraseDef[];
  missions: MissionDef[];
  /** KIT_* roots available in the model library (filled by tools; absent in the runtime). */
  modelNames?: string[];
}
