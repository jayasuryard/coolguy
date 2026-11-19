# Art pipeline

Art follows the **coolguy Art Direction and Storyboard** document. Its palette is used as
starting swatches: salt stone `CFC0AA`, tram enamel `315B5B`, brick `A65037`, Kit jacket `C18A39`,
guitar cobalt `315CA9`, bounty crimson `D84C54`.

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
