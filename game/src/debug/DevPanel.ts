import { VERSION_IDS, type VersionId } from '@content/types';
import GUI from 'lil-gui';
import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { CONFIG } from '../config';
import { CONTENT } from '../content';
import type { Game } from '../Game';
import type { Settings } from '../platform/settings';

/**
 * Dev-only tools (loaded only when import.meta.env.DEV): FPS, live tuning, fact granting,
 * version swapping, collider wireframes. Toggle with the backquote key.
 */
export function installDevPanel(game: Game, settings: Settings): void {
  const gui = new GUI({ title: 'Dev  ( ` )' });
  const stats = new Stats();
  document.body.appendChild(stats.dom);

  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
  );
  lines.frustumCulled = false;
  lines.renderOrder = 999;
  game.scene.add(lines);

  const state = {
    version: game.story.activeVersion as VersionId,
    fact: CONTENT.facts[0]!.id,
    colliders: false,
    info: '',
  };

  const world = gui.addFolder('World');
  world
    .add(state, 'version', [...VERSION_IDS])
    .name('version (force)')
    .listen()
    .onChange((v: VersionId) => game.setActiveVersion(v, true));
  const pads = CONTENT.world.cells.flatMap((c) =>
    c.objects.filter((o) => o.kind === 'pad').map((o) => o.id),
  );
  const tp = { pad: pads[0]! };
  world
    .add(tp, 'pad', pads)
    .name('teleport to pad')
    .onChange((id: string) => game.teleportToPad(id));
  world.add(game, 'noclip').name('noclip (E up / Q down)').listen();
  world.add(state, 'colliders').name('show colliders');

  const story = gui.addFolder('Story');
  story
    .add(
      state,
      'fact',
      CONTENT.facts.map((f) => f.id),
    )
    .name('fact');
  story.add(
    {
      grant: () => {
        const before = game.story.activeVersion;
        game.story.grant(state.fact);
        game.afterStoryChange(before);
      },
    },
    'grant',
  );
  story
    .add(
      {
        punchClockReady: () => {
          const before = game.story.activeVersion;
          ['rescue.tram', 'defeated.collector', 'key.quay.lower', 'phrase.closing'].forEach((f) =>
            game.story.grant(f),
          );
          game.afterStoryChange(before);
          game.teleportToPad('pad.quay.lower');
        },
      },
      'punchClockReady',
    )
    .name('Punch Clock prerequisites + go');
  story.add({ skip: () => game.director.skip() }, 'skip').name('skip current step');
  story.add({ save: () => void game.checkpoint() }, 'save').name('save checkpoint');
  story.add(state, 'info').name('rank / facts').listen().disable();

  const music = gui.addFolder('Music & timing');
  music.add(game, 'metronome');
  music.add(settings, 'assistedRelease');
  music.add(settings, 'holdAsTwoTaps');
  music.add(settings, 'calibrationMs', -150, 150, 1);
  music.add(CONFIG.music, 'windowMs', 40, 300, 5).name('window ±ms');

  const kit = gui.addFolder('Kit');
  kit.add(CONFIG.kit, 'walkSpeed', 0.5, 10, 0.1);
  kit.add(CONFIG.kit, 'jogSpeed', 0.5, 20, 0.1);
  kit.add(CONFIG.camera, 'armLength', 1, 10, 0.1);

  const statusLine = document.getElementById('dev-line');
  let visible = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote') return;
    visible = !visible;
    gui.show(visible);
    stats.dom.style.display = visible ? '' : 'none';
    if (statusLine) statusLine.hidden = !visible;
  });

  const tick = () => {
    stats.update();
    lines.visible = state.colliders;
    if (state.colliders) {
      const { vertices, colors } = game.sim.world.debugRender();
      lines.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      lines.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    }
    state.version = game.story.activeVersion;
    const r = game.story.rank;
    state.info = `${r.rank} ${r.title} · ${game.story.facts.size} facts`;
    if (statusLine) {
      const k = game.sim.kit.curr;
      const info = game.renderer.info.render;
      statusLine.textContent =
        `pos ${k.x.toFixed(1)}, ${k.y.toFixed(1)}, ${k.z.toFixed(1)} · ${game.sim.kit.speed.toFixed(1)} m/s · ` +
        `cells ${game.streamer.residentCount} · draws ${info.calls} · tris ${(info.triangles / 1000).toFixed(1)}k · ` +
        `clock ${game.transport.source.kind} · beat ${game.transport.heardBeat().toFixed(2)}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
