import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../content/types';
import { loadContent } from './loadContent';
import { validateContent } from './validateContent';

const root = fileURLToPath(new URL('../content', import.meta.url));
const models = fileURLToPath(new URL('../game/public/assets/models', import.meta.url));
const fresh = (): ContentBundle => structuredClone(loadContent(root, models));

describe('validateContent', () => {
  it('accepts the shipped content', () => {
    expect(validateContent(fresh())).toEqual([]);
  });

  it('rejects duplicate object ids', () => {
    const c = fresh();
    c.world.cells[0]!.objects.push({ ...c.world.cells[0]!.objects[0]! });
    expect(validateContent(c).join('\n')).toMatch(/duplicate object id/);
  });

  it('rejects objects placed outside their cell', () => {
    const c = fresh();
    c.world.cells[0]!.objects.push({ id: 'stray', kind: 'pad', position: [0, 0, 0] });
    expect(validateContent(c).join('\n')).toMatch(/outside cell/);
  });

  it('rejects undefined quest facts and missing receivers', () => {
    const c = fresh();
    c.missions[0]!.requires.push('no.such.fact');
    c.missions[0]!.trigger.receiver = 'receiver.nowhere';
    const errors = validateContent(c).join('\n');
    expect(errors).toMatch(/undefined fact "no.such.fact"/);
    expect(errors).toMatch(/not a receiver/);
  });

  it('rejects pads below their district floor', () => {
    const c = fresh();
    c.world.cells
      .find((x) => x.id === 'cell.3.3')!
      .objects.push({
        id: 'pad.sunk',
        kind: 'pad',
        position: [210, 0, 230],
      });
    expect(validateContent(c).join('\n')).toMatch(/unreachable/);
  });

  it('reads kit pieces from the GLB and rejects unknown ones', () => {
    const c = fresh();
    expect(c.modelNames).toContain('KIT_tram');
    c.world.cells[0]!.objects.push({
      id: 'model.bogus',
      kind: 'model',
      model: 'KIT_does_not_exist',
      position: anchorInCell(c, 0),
    });
    expect(validateContent(c).join('\n')).toMatch(/unknown kit piece "KIT_does_not_exist"/);
  });
});

function anchorInCell(c: ContentBundle, index: number): [number, number, number] {
  const m = /^cell\.(\d+)\.(\d+)$/.exec(c.world.cells[index]!.id)!;
  const s = c.world.cellSize;
  return [Number(m[1]) * s + 1, 50, Number(m[2]) * s + 1];
}
