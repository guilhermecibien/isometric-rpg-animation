# Choosing a production path

`recommendPaths()` (src/providers/index.ts) ranks them from facts; use it as a starting point, then explain the choice to the user.

| Path | Use when | Strength | Cost / risk | Command |
|---|---|---|---|---|
| 1 Existing spritesheets | Sheets exist | Exact original art | Needs clean grids, direction map, alignment | `isoanim process --spec spec.json --out dir` |
| 2 Articulated 2D | Art can be cut into parts (head, torso, limbs, weapon) | High fidelity, full control, foot markers from tagged points | Cutting and pivots take time; angle-only legs arc, so the validator reports slide: add root motion/IK-like keys | `isoanim articulated --rig rig.json --out dir` |
| 3 Blender | A rigged model exists or is worth building | 8 directions free; consistent volume | Look differs from hand-drawn art; needs Blender | `blender -b m.blend -P scripts/blender_render_sprites.py -- ...` then `isoanim from-frames` |
| 4 Image model (optional) | User has a provider | Fast drafts | Identity drift between frames: needs heavy validation and manual correction | implement `AnimationProvider`, then `from-frames` |

Spec formats: `process` spec → `examples/spritesheet-spec/spec.json`; rig → `examples/articulated-rig/rig.json`.
Never assume provider availability: call `ProviderRegistry.available()` and report reasons.
