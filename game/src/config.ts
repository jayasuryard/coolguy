/**
 * Engine and feel constants, taken from the Design and Developer documents.
 * Mutable so the dev panel can live-tune them.
 */
export const CONFIG = {
  sim: {
    /** Fixed simulation rate (Developer doc: 60 Hz). */
    dt: 1 / 60,
    /** Max catch-up steps per frame; excess time is discarded. */
    maxCatchUpSteps: 4,
    gravity: -20,
  },
  kit: {
    walkSpeed: 2, // m/s
    jogSpeed: 4.5, // m/s
    mantleHeight: 1.2, // m (marked ledges only — not implemented yet)
    radius: 0.35,
    halfHeight: 0.55,
  },
  camera: {
    armLength: 3, // m spring arm
    lookHeight: 1.5,
    sensitivity: 0.0025,
    padSensitivity: 2.6, // rad/s at full stick
  },
  music: {
    bpm: 96,
    beatsPerBar: 4,
    /** Initial release window either side of the marked beat. */
    windowMs: 180,
    /** Lookahead scheduler (Developer doc: 25 ms timer, 100 ms horizon). */
    schedulerIntervalMs: 25,
    scheduleAheadS: 0.1,
  },
  streaming: {
    /** Cells (Chebyshev distance) kept loaded around Kit. */
    loadRadius: 1,
    /** Unload only beyond this distance, so the trailing cell survives the crossing. */
    unloadRadius: 2,
  },
  kitHearts: 3,
};
