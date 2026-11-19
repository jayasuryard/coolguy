# Art pipeline

## Brand

- **Logo masters** (in `art/brand/`):
  - `coolguy-logo-white-colour.webp`: white lettering with brass pegs and cobalt bolt, for dark
    screens.
  - `coolguy-logo-white.webp`: all-white, single colour.
  - `coolguy-logo-source.png`: the original dark-on-cream artwork, for light surfaces.
- **Game copies** (in `game/public/assets/ui/`): `logo-light.webp` (colour, used for the menu
  title and loading screen), `logo-white.webp` (mono, used for the small header lockups),
  `logo.webp` (original colours, transparent) and the favicons `icon-64.png` and `icon-180.png`.
- **Placement:** the colour logo is the main-menu title and sits above "Bellweather" on the
  loading screen. The mono logo heads the Pause, Settings and Credits screens.
- **Type:**
  - Saira heavy italic for anything that speaks in the logo's voice: headings, menu items, tabs,
    buttons, eyebrows, key hints and the HUD.
  - Nunito Sans for body copy and objectives, for legibility.
  - Monospace for keycaps and values.
- **Colour:** cream `#F4EAD8`, amber `#EDAE5E` for focus and actions, ink `#0B1412`. The cobalt
  `#315CA9` stays reserved for Kit's input, as the Art Direction doc asks.

Art follows the **coolguy Art Direction and Storyboard** document. Its palette is used as
starting swatches: salt stone `CFC0AA`, tram enamel `315B5B`, brick `A65037`, Kit jacket `C18A39`,
guitar cobalt `315CA9`, bounty crimson `D84C54`.

## Bellweather city (Blender → GLB)

- **Source:** the hosted Blender project _coolguy — Bellweather city_ (Higgsfield 3D Jutsu),
  https://higgsfield.ai/3d-jutsu/6f6ae97e-0c00-4f47-847b-0f092e006201
- **Export:** `game/public/assets/models/bellweather_city.glb`, loaded whole by `CityModel`
  whenever `content/world/world.json` sets `"autoFloors": false`.
- **Coordinates:** Blender X is the game's x; Blender −Y is the game's z (south); Blender Z is up.
  Game positions in content can be read straight off the Blender scene.
- **Layout** (built from the island concept and the top-down plan), in metres:

  | Zone             | Where (x, z)                        | Height                             |
  | ---------------- | ----------------------------------- | ---------------------------------- |
  | Punch Quay       | z ≥ 268, x ≤ 340                    | 0 (sea at −1.6)                    |
  | Village terraces | x < 304, bands of z 230/190/150/108 | 9 / 16 / 23 / 30 / 37              |
  | Grand stair      | x 304–320, from z 230 to 108        | 9 → 30 (landing) → 52              |
  | Civic plaza      | x ≥ 228, z ≤ 108                    | 52                                 |
  | Viaduct          | x 320 → 452 at z 181–187            | deck at 30                         |
  | East hill        | x > 320                             | slopes from the sea up to about 50 |

- **Naming contract with the game:**
  - `CITY_*` meshes are rendered.
  - `*__col` meshes are rendered and also used as colliders (the terrain).
  - `COL_*` meshes are collision only: houses, the civic hall, the viaduct deck and bastion, the
    tram, ferry and canopy columns, and the clock-room roof.
  - `REVIEW_*` objects, cameras and lights are ignored.
- **Materials:** a small set of Principled materials driven by vertex colour (`Col`): stone,
  plaster, roof, painted iron, flora, wood and rock, plus glass and the emissive bulbs. This keeps
  the whole island to a few dozen draw calls.

## Environment kit (Blender → GLB)

- **Source:** the hosted Blender project _coolguy — Punch Quay kit_ (Higgsfield 3D Jutsu),
  https://higgsfield.ai/3d-jutsu/63cf698a-072f-4e6a-8a99-ac2eda810568
- **Export:** `game/public/assets/models/punch_quay_kit.glb` (revision 4, ~360 KB).
- **Conventions:**
  - Metres; one root empty per piece, named `KIT_<piece>`, with the origin at the base.
  - Blender +Z up becomes glTF +Y; Blender −Y (the "front") becomes glTF +Z.
  - Materials are plain Principled BSDF only, so they survive glTF.
  - In the GLB the pieces sit in a review row. The game resets each instance to the origin and
    places it from `content/world/world.json` (`kind: "model"`).

| Piece              | Size / notes                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| `KIT_tram`         | 9 × 2.4 m teal tram, length along X, origin at rail level                       |
| `KIT_canopy_bay`   | 6 m platform bay; columns at the bay start, globe bulb mid-bay                  |
| `KIT_arcade_bay`   | 6 m limestone arch bay, front faces +Z, 3.4 m deep                              |
| `KIT_clock_tower`  | 6 × 6 m footprint, ~35 m tall; bent minute hand on all four faces               |
| `KIT_stairs`       | 4 m wide flight, rises 3 m over 6 m toward −Z (uphill)                          |
| `KIT_quay_wall`    | 8 m sea-wall segment with tide stripe and rail                                  |
| `KIT_lamp_post`    | 4.3 m iron lamp, arm toward +X                                                  |
| `KIT_bollard`      | mooring bollard                                                                 |
| `KIT_market_stall` | 3 m stall with striped awning and fruit crates                                  |
| `KIT_punch_clock`  | wall machine with brass drum and four amber lamps (faces +Z)                    |
| `KIT_amp`          | Kit's busking amp                                                               |
| `KIT_guitar`       | cobalt guitar, body centred at the origin, neck +Y, face +Z (Kit's back socket) |

**Rules:**

- Kit pieces are visual only. Collision comes from `visual: false` blocks and ramps in the
  content, which `npm run validate` checks.
- The game merges each cell's static meshes by material, so a cell costs about one draw call per
  material.

**Adding a piece:** build it in the Blender project as a new `KIT_*` root, re-export the GLB into
`game/public/assets/models/`, then reference it from content. `npm run validate` rejects any model
name that isn't in the GLB.

## Kit Vale (Hunyuan 3D)

Turnaround crops of the character sheet are in `art/reference/kit/` (`kit_front.png`,
`kit_side.png`, `kit_back.png`). Hunyuan 3D Studio pipeline:

1. **Geometry Generation:** Image to Geometry, Single Image (`kit_front.png`), with
   **Standardized A-pose** on so the model can be rigged.
2. **Texture Painting**, then **Bone Binding** for the skeleton, then **Animation**
   (walk, jog, idle, play).
3. Export GLB to `game/public/assets/models/kit.glb`. `KitView` will replace the placeholder
   capsule and attach `KIT_guitar` to a strap socket.

The guitar is a separate prop, as the Art Direction doc asks (strap and hand attachment markers),
so the character is generated without it.
