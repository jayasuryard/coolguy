import type { MapSheet, WorldDef } from '@content/types';

export interface MapBlip {
  x: number;
  z: number;
  kind: 'objective' | 'enemy' | 'resident';
  label?: string;
}

export interface MapState {
  /** Kit's world position and facing (radians, 0 = +Z). */
  x: number;
  z: number;
  facing: number;
  /** Camera yaw (radians); the minimap turns so the camera's forward is up. */
  yaw: number;
  blips: MapBlip[];
  objective: string;
  district: string;
  time: number;
}

const COLORS = { objective: '#ffc45a', enemy: '#ff5a36', resident: '#7fd6c9' } as const;
/** Metres of world shown from the centre of the round tracker to its rim. */
const MINI_RANGE = 60;

/**
 * The painted map of Bellweather, two ways: the round tracker in the corner of the HUD (turns
 * with the camera, objective pinned to the rim when it is out of range) and the full-screen
 * map (M) with pan and zoom. World metres map to image pixels through `world.map`.
 */
export class MapView {
  private readonly image = new Image();
  private readonly mini = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly screen = document.getElementById('map-screen')!;
  private readonly full = document.getElementById('map-canvas') as HTMLCanvasElement;
  private readonly cfg: MapSheet;
  /** The whole city, if its image loaded; the full-screen map prefers it. */
  private readonly city = new Image();
  private readonly cityCfg: MapSheet | null;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: { x: number; y: number } | null = null;
  open = false;
  /** Centre the next full-map frame on Kit (the city sheet opens zoomed in on him). */
  private centre = false;

  constructor(world: WorldDef) {
    this.cfg = world.map ?? { image: '', size: [1, 1], scale: [1, 1], offset: [0, 0] };
    if (world.map) this.image.src = import.meta.env.BASE_URL + world.map.image;
    this.cityCfg = world.map?.overview ?? null;
    if (this.cityCfg) this.city.src = import.meta.env.BASE_URL + this.cityCfg.image;

    this.full.addEventListener(
      'wheel',
      (e) => {
        this.zoom = Math.min(5, Math.max(1, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        if (this.zoom === 1) this.panX = this.panY = 0;
      },
      { passive: true },
    );
    this.full.addEventListener('pointerdown', (e) => (this.drag = { x: e.clientX, y: e.clientY }));
    window.addEventListener('pointerup', () => (this.drag = null));
    window.addEventListener('pointermove', (e) => {
      if (!this.drag || !this.open) return;
      this.panX += e.clientX - this.drag.x;
      this.panY += e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
    });
  }

  get available(): boolean {
    return this.image.complete && this.image.naturalWidth > 0;
  }

  private get hasCity(): boolean {
    return !!this.cityCfg && this.city.complete && this.city.naturalWidth > 0;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.screen.hidden = !open;
    if (open) {
      this.zoom = this.hasCity ? 2.6 : 1;
      this.panX = this.panY = 0;
      this.centre = this.hasCity;
    }
  }

  /** World metres → image pixels. */
  private px(x: number, z: number): [number, number] {
    const { scale, offset } = this.cfg;
    return [x * scale[0] + offset[0], z * scale[1] + offset[1]];
  }

  draw(s: MapState): void {
    if (!this.available) return;
    this.drawMini(s);
    if (this.open) this.drawFull(s);
  }

  // ---------------------------------------------------------------- round tracker
  private drawMini(s: MapState): void {
    const c = this.mini;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(c.clientWidth * dpr);
    if (!size) return;
    if (c.width !== size) c.width = c.height = size;
    const g = c.getContext('2d')!;
    const r = size / 2;
    // on the island use its detailed sheet; beyond it, the city sheet (when present)
    const [ix, iy] = this.px(s.x, s.z);
    const onIsland = ix >= 0 && iy >= 0 && ix <= this.cfg.size[0] && iy <= this.cfg.size[1];
    const sheet = !onIsland && this.hasCity ? this.cityCfg! : this.cfg;
    const image = sheet === this.cfg ? this.image : this.city;
    const cx = s.x * sheet.scale[0] + sheet.offset[0];
    const cy = s.z * sheet.scale[1] + sheet.offset[1];
    const k = r / (MINI_RANGE * sheet.scale[0]); // screen px per image px

    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 2 * dpr, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#0d3d55';
    g.fillRect(0, 0, size, size);
    // rotate the world so the camera's forward (−sin yaw, −cos yaw) points up the screen
    g.translate(r, r);
    g.rotate(s.yaw);
    g.scale(k, k * (sheet.scale[0] / sheet.scale[1]));
    g.drawImage(image, -cx, -cy);
    g.restore();

    // soft inner shade so markers read over the painting
    const shade = g.createRadialGradient(r, r, r * 0.55, r, r, r);
    shade.addColorStop(0, 'rgba(8,12,18,0)');
    shade.addColorStop(1, 'rgba(8,12,18,0.5)');
    g.fillStyle = shade;
    g.beginPath();
    g.arc(r, r, r - 2 * dpr, 0, Math.PI * 2);
    g.fill();

    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    const toScreen = (x: number, z: number): [number, number, boolean] => {
      const dx = x - s.x;
      const dz = z - s.z;
      let sx = (dx * cos - dz * sin) * (r / MINI_RANGE);
      let sy = (dx * sin + dz * cos) * (r / MINI_RANGE);
      const d = Math.hypot(sx, sy);
      const rim = r - 9 * dpr;
      const out = d > rim;
      if (out) {
        sx *= rim / d;
        sy *= rim / d;
      }
      return [r + sx, r + sy, out];
    };
    for (const b of s.blips) {
      const [x, y, out] = toScreen(b.x, b.z);
      if (out && b.kind !== 'objective') continue;
      this.blip(g, x, y, b.kind, dpr, s.time);
    }

    // Kit: arrow at the centre, turned relative to the camera
    g.save();
    g.translate(r, r);
    g.rotate(s.yaw - s.facing + Math.PI);
    this.arrow(g, 7 * dpr);
    g.restore();

    // rim and north tick
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(255,244,220,0.9)';
    g.beginPath();
    g.arc(r, r, r - 2 * dpr, 0, Math.PI * 2);
    g.stroke();
    const nx = r + Math.sin(-s.yaw) * (r - 2 * dpr) * -1;
    const ny = r - Math.cos(-s.yaw) * (r - 2 * dpr);
    g.fillStyle = '#10141a';
    g.beginPath();
    g.arc(nx, ny, 8 * dpr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff4dc';
    g.font = `700 ${10 * dpr}px Saira, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + dpr * 0.5);
  }

  // ---------------------------------------------------------------- full map
  private drawFull(s: MapState): void {
    const c = this.full;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d')!;
    const sheet = this.hasCity ? this.cityCfg! : this.cfg;
    const image = this.hasCity ? this.city : this.image;
    const [iw, ih] = sheet.size;
    const fit = Math.max(w / iw, h / ih) * this.zoom; // cover the screen, like a pause map
    if (this.centre) {
      this.centre = false;
      this.panX = ((iw / 2 - (s.x * sheet.scale[0] + sheet.offset[0])) * fit) / dpr;
      this.panY = ((ih / 2 - (s.z * sheet.scale[1] + sheet.offset[1])) * fit) / dpr;
    }
    const maxX = Math.max(0, (iw * fit - w) / 2);
    const maxY = Math.max(0, (ih * fit - h) / 2);
    this.panX = Math.min(maxX / dpr, Math.max(-maxX / dpr, this.panX));
    this.panY = Math.min(maxY / dpr, Math.max(-maxY / dpr, this.panY));
    const ox = (w - iw * fit) / 2 + this.panX * dpr;
    const oy = (h - ih * fit) / 2 + this.panY * dpr;
    const at = (x: number, z: number): [number, number] => [
      ox + (x * sheet.scale[0] + sheet.offset[0]) * fit,
      oy + (z * sheet.scale[1] + sheet.offset[1]) * fit,
    ];

    g.fillStyle = '#0d3d55';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, ox, oy, iw * fit, ih * fit);
    const shade = g.createLinearGradient(0, 0, w * 0.45, 0);
    shade.addColorStop(0, 'rgba(8,12,18,0.82)');
    shade.addColorStop(1, 'rgba(8,12,18,0)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);

    for (const b of s.blips) {
      const [x, y] = at(b.x, b.z);
      this.blip(g, x, y, b.kind, dpr * 1.5, s.time);
      if (b.label) {
        g.font = `italic 700 ${14 * dpr}px Saira, sans-serif`;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.lineWidth = 4 * dpr;
        g.strokeStyle = 'rgba(8,12,18,0.85)';
        g.strokeText(b.label, x + 14 * dpr, y);
        g.fillStyle = '#fff4dc';
        g.fillText(b.label, x + 14 * dpr, y);
      }
    }
    const [kx, ky] = at(s.x, s.z);
    g.save();
    g.translate(kx, ky);
    g.rotate(Math.PI - s.facing);
    this.arrow(g, 11 * dpr);
    g.restore();
  }

  private blip(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    kind: MapBlip['kind'],
    dpr: number,
    time: number,
  ): void {
    const pulse = kind === 'objective' ? 1 + 0.18 * Math.sin(time * 5) : 1;
    const size = (kind === 'resident' ? 4 : 6.5) * dpr * pulse;
    g.save();
    g.translate(x, y);
    g.fillStyle = COLORS[kind];
    g.strokeStyle = '#10141a';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    if (kind === 'objective') {
      g.rotate(Math.PI / 4);
      g.rect(-size, -size, size * 2, size * 2);
    } else g.arc(0, 0, size, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }

  /** Player arrow pointing up (−y) in local space. */
  private arrow(g: CanvasRenderingContext2D, size: number): void {
    g.beginPath();
    g.moveTo(0, -size * 1.3);
    g.lineTo(size * 0.9, size);
    g.lineTo(0, size * 0.45);
    g.lineTo(-size * 0.9, size);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#10141a';
    g.lineWidth = Math.max(2, size * 0.28);
    g.stroke();
    g.fill();
  }
}
