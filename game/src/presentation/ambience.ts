import type * as THREE from 'three';

/**
 * World state every surface shader reads: how wet things are, how much snow lies, how far into
 * the night it is. Owned by the Environment; shared here so materials built anywhere pick it up.
 */
export const AMBIENCE = {
  wet: { value: 0 },
  snow: { value: 0 },
  night: { value: 0 },
};

/** Lamp materials that come on at night (their daytime glow is a fraction of `base`). */
export const NIGHT_LAMPS: Array<{ material: THREE.MeshStandardMaterial; base: number }> = [];

export function registerLamp(material: THREE.MeshStandardMaterial): void {
  if (NIGHT_LAMPS.some((l) => l.material === material)) return;
  NIGHT_LAMPS.push({ material, base: material.emissiveIntensity });
}
