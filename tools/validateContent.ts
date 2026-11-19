/**
 * Content validation ("builder checks"). Pure function over a ContentBundle so it runs both
 * from the CLI (tools/validate-content.ts) and from unit tests.
 * Written in erasable TypeScript only, so Node can run it directly.
 */
import type { ContentBundle, Vec3, WorldObject } from '../content/types.ts';
import { VERSION_IDS } from '../content/types.ts';

const CELL_ID = /^cell\.(\d+)\.(\d+)$/;

function anchorOf(o: WorldObject): Vec3 {
  switch (o.kind) {
    case 'block':
      return o.center;
    case 'ramp':
      return o.from;
    default:
      return o.position;
  }
}

export function validateContent(c: ContentBundle): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);
  const { world } = c;

  // ---- world grid & objects ----
  const objects = new Map<string, { obj: WorldObject; cell: string }>();
  const cellIds = new Set<string>();
  const floorForRow = new Map<number, number>();
  for (const d of world.districts) {
    for (const r of d.rows) {
      if (floorForRow.has(r)) err(`row ${r} belongs to more than one district`);
      floorForRow.set(r, d.floorY);
    }
  }
  for (let r = 0; r < world.rows; r++) {
    if (!floorForRow.has(r)) err(`row ${r} has no district`);
  }

  const checkObject = (o: WorldObject, cellId: string, col: number, row: number) => {
    if (objects.has(o.id)) err(`duplicate object id "${o.id}"`);
    objects.set(o.id, { obj: o, cell: cellId });

    const [x, , z] = anchorOf(o);
    const s = world.cellSize;
    if (Math.floor(x / s) !== col || Math.floor(z / s) !== row) {
      err(`"${o.id}" anchor (${x}, ${z}) is outside ${cellId}`);
    }
    if (o.kind === 'block' && o.size.some((v) => v <= 0))
      err(`block "${o.id}" has a non-positive size`);
    if (o.kind === 'ramp' && o.width <= 0) err(`ramp "${o.id}" has no width`);
    if (o.kind === 'model' && c.modelNames && !c.modelNames.includes(o.model)) {
      err(`model "${o.id}" uses unknown kit piece "${o.model}"`);
    }
    if (o.kind === 'pad' && world.autoFloors !== false) {
      const floor = floorForRow.get(row) ?? 0;
      if (o.position[1] < floor) err(`pad "${o.id}" is below its district floor (unreachable)`);
    }
  };

  for (const cell of world.cells) {
    const m = CELL_ID.exec(cell.id);
    if (!m) {
      err(`bad cell id "${cell.id}" (expected cell.<col>.<row>)`);
      continue;
    }
    const col = Number(m[1]);
    const row = Number(m[2]);
    if (col >= world.cols || row >= world.rows)
      err(`${cell.id} is outside the ${world.cols}x${world.rows} grid`);
    if (cellIds.has(cell.id)) err(`duplicate cell "${cell.id}"`);
    cellIds.add(cell.id);
    for (const o of cell.objects) checkObject(o, cell.id, col, row);
  }

  // ---- versions ----
  const seenVersions = new Set<string>();
  for (const v of c.versions) {
    if (!VERSION_IDS.includes(v.id)) err(`unknown version id "${v.id}"`);
    if (seenVersions.has(v.id)) err(`duplicate version "${v.id}"`);
    seenVersions.add(v.id);
    for (const ov of v.overlays) {
      const m = CELL_ID.exec(ov.cell);
      if (!m) {
        err(`version ${v.id}: bad overlay cell "${ov.cell}"`);
        continue;
      }
      for (const id of ov.hide ?? []) {
        const hit = objects.get(id);
        if (!hit) err(`version ${v.id}: hides unknown object "${id}"`);
        else if (hit.cell !== ov.cell) err(`version ${v.id}: "${id}" is not in ${ov.cell}`);
      }
      for (const o of ov.add ?? []) checkObject(o, ov.cell, Number(m[1]), Number(m[2]));
    }
  }
  for (const id of VERSION_IDS) if (!seenVersions.has(id)) err(`version "${id}" is not defined`);

  const isKind = (id: string, kind: WorldObject['kind']) => objects.get(id)?.obj.kind === kind;
  if (!isKind(world.spawnPad, 'pad')) err(`spawnPad "${world.spawnPad}" is not a pad`);

  // ---- story ----
  const facts = new Set<string>();
  for (const f of c.facts) {
    if (facts.has(f.id)) err(`duplicate fact "${f.id}"`);
    facts.add(f.id);
  }
  const needFact = (where: string, id: string) => {
    if (!facts.has(id)) err(`${where}: undefined fact "${id}"`);
  };
  c.ranks.forEach((r, i) => {
    if (r.rank !== i + 1) err(`ranks must be ordered 1..n (got ${r.rank} at index ${i})`);
    r.requires.forEach((f) => needFact(`rank ${r.rank}`, f));
  });
  const phraseIds = new Set(c.phrases.map((p) => p.id));
  c.phrases.forEach((p) => needFact(`phrase ${p.id}`, p.fact));

  const districtIds = new Set(world.districts.map((d) => d.id));
  for (const ch of c.chapters) {
    needFact(ch.id, ch.completeFact);
    if (!districtIds.has(ch.district)) err(`${ch.id}: unknown district "${ch.district}"`);
  }

  const missionIds = new Set<string>();
  for (const m of c.missions) {
    if (missionIds.has(m.id)) err(`duplicate mission "${m.id}"`);
    missionIds.add(m.id);
    m.requires.forEach((f) => needFact(m.id, f));
    m.effects.facts.forEach((f) => needFact(m.id, f));
    if (!isKind(m.pad, 'pad')) err(`${m.id}: pad "${m.pad}" is not a pad`);
    if (m.effects.returnPad && !isKind(m.effects.returnPad, 'pad')) {
      err(`${m.id}: returnPad "${m.effects.returnPad}" is not a pad`);
    }
    if (!isKind(m.trigger.receiver, 'receiver')) {
      err(`${m.id}: trigger receiver "${m.trigger.receiver}" is not a receiver`);
    }
    if (!phraseIds.has(m.trigger.phrase)) err(`${m.id}: unknown phrase "${m.trigger.phrase}"`);
    for (const v of [...m.effects.unlockVersions, m.effects.activateVersion, m.version]) {
      if (v && !VERSION_IDS.includes(v)) err(`${m.id}: unknown version "${v}"`);
    }
    if (
      m.effects.activateVersion &&
      !m.effects.unlockVersions.includes(m.effects.activateVersion)
    ) {
      err(`${m.id}: activates "${m.effects.activateVersion}" without unlocking it`);
    }
  }

  return errors;
}
