# Isometric conventions

## Projection (src/core/iso.ts, python/isoanim/common.py)
World (x, y, z) → screen, camera rotation 0:

    sx = originX + (x - y) * tileWidth / 2
    sy = originY + (x + y) * tileHeight / 2 - z * heightScale

`cellSize` scales world units to cells; `cameraRotation` (0–3) rotates the world 90° steps before projecting. `screenToWorld` is the exact inverse on a plane of constant z. Both TypeScript and Python use the same maths; tests assert the generated `cycleTravel` equals the runtime projection.

## Directions
Names are SCREEN compass directions: S is toward the bottom of the screen, E toward the right.
With camera rotation 0 the world headings are:

| screen | world (x,y) | | screen | world (x,y) |
|---|---|---|---|---|
| S | (1, 1) | | N | (-1,-1) |
| SW | (0, 1) | | NE | (0,-1) |
| W | (-1, 1) | | E | (1,-1) |
| NW | (-1, 0) | | SE | (1, 0) |

Consequences: +x on the grid is **SE**, not E. WASD is mapped in screen space (`W` = up on screen = world (-1,-1)). Never compare a sprite direction with a cartesian vector; call `DirectionResolver.fromWorldVector` which projects first and applies hysteresis.

Sheets authored with another convention: pass `spriteConvention` (e.g. `{ S: 'N', N: 'S' }`) to `DirectionResolver`, or remap rows in the `process` spec (`rows`). 4-direction sheets: provide `S W N E`; diagonals resolve through mirror/nearest fallback, or reduce explicitly with `DirectionResolver.reduceTo4`.

## Mirroring
If only E-side directions exist, the registry resolves W/SW/NW by mirroring (`flipX`), around the pivot column. Keep the pivot on the vertical axis of symmetry of the sprite or mirrored frames will jump.

## Depth sorting
`IsoProjection.depthOf(world, {z, layer})` = ground-plane order `(x+y)` (after camera rotation) × 100 + small z term; `layer` is a coarse override. Sort by the point where an object touches the ground, not its sprite centre. Large/tall props should be sorted by their front-most ground cell and may need to be split into parts. `PhaserDepthManager` tracks props and moving objects with getters.

## Heights
`z` lifts the sprite (`heightScale` px per unit) but ground-plane depth and the shadow stay on the ground point.

## Pivot and anchors
`pivot` in the manifest is the ground contact point in frame pixels. `FootAnchorController` sets the sprite origin to `pivot / frameSize` and rounds sprite positions to whole pixels to prevent shimmer. The shadow is placed on the ground point independent of animation.
